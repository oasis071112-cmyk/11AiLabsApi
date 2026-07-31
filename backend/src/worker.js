require('dotenv').config();

const path = require('node:path');
const {
  assertPostgresSchemaCurrent,
  checkPostgres,
  createPostgresPool,
  ensureApiRequestLogPartitions,
  resolveDatabaseUrl,
} = require('./infrastructure/postgres');
const { createRedisClient, checkRedis } = require('./infrastructure/redis');
const { secretBoxFromEnvironment } = require('./runtime/services');
const { BackgroundWorker } = require('./modules/background-worker');
const { WorkerHeartbeat } = require('./modules/background-worker/heartbeat');
const { createPostgresWorkerTasks, validateRetentionDays } = require('./modules/background-worker/postgres-tasks');
const logger = require('./utils/logger');

async function createWorkerRuntime({
  env = process.env,
  pg,
  redis: redisDriver,
  logger: runtimeLogger = logger,
} = {}) {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!env.REDIS_URL) throw new Error('worker requires REDIS_URL');
  const retentionDays = validateRetentionDays(env.REQUEST_LOG_RETENTION_DAYS || 90);
  const partitionHorizonMonths = Number(env.REQUEST_LOG_PARTITION_HORIZON_MONTHS || 3);
  const secretBox = secretBoxFromEnvironment(env);
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    pg,
    max: Number(env.WORKER_POSTGRES_POOL_MAX || 5),
  });
  let redis;
  try {
    const migrationDirectory = path.resolve(__dirname, '../migrations/postgres');
    await assertPostgresSchemaCurrent(pool, { migrationDirectory });
    await ensureApiRequestLogPartitions(pool, { monthsAhead: partitionHorizonMonths });
    redis = createRedisClient({ url: env.REDIS_URL, redis: redisDriver });
    if (!redis.isOpen) await redis.connect();
    const [databaseHealth, redisHealth] = await Promise.all([checkPostgres(pool), checkRedis(redis)]);
    if (databaseHealth.status !== 'ok' || redisHealth.status !== 'ok') {
      throw new Error('worker infrastructure readiness check failed');
    }
  } catch (error) {
    await Promise.allSettled([
      pool.end(),
      redis?.isOpen ? redis.quit() : Promise.resolve(),
    ]);
    throw error;
  }
  try {
    const tasks = createPostgresWorkerTasks({
      pool,
      redis,
      secretBox,
      logger: runtimeLogger,
      retentionDays,
      partitionHorizonMonths,
      probeConcurrency: Number(env.UPSTREAM_PROBE_CONCURRENCY || 5),
      probeRetentionDays: Number(env.UPSTREAM_PROBE_RETENTION_DAYS || 30),
      redisKeyPrefix: env.REDIS_KEY_PREFIX || 'ionailabs',
    });
    // This timer is deliberately separate from the sequential maintenance loop:
    // a slow probe or aggregate must never make a live worker heartbeat go stale.
    const heartbeat = new WorkerHeartbeat({
      redis,
      key: `${env.REDIS_KEY_PREFIX || 'ionailabs'}:worker:heartbeat`,
      intervalMs: Number(env.WORKER_HEARTBEAT_INTERVAL_MS || 30_000),
      ttlSeconds: Number(env.WORKER_HEARTBEAT_TTL_SECONDS || 90),
      logger: runtimeLogger,
    });
    const worker = new BackgroundWorker({
      tasks,
      intervalMs: Number(env.WORKER_TICK_INTERVAL_MS || 30_000),
      logger: runtimeLogger,
    });
    return {
      pool,
      redis,
      worker,
      heartbeat,
      async close() {
        await Promise.allSettled([worker.stop(), heartbeat.stop()]);
        await Promise.allSettled([
          redis.isOpen ? redis.quit() : Promise.resolve(),
          pool.end(),
        ]);
      },
    };
  } catch (error) {
    await Promise.allSettled([redis.isOpen ? redis.quit() : Promise.resolve(), pool.end()]);
    throw error;
  }
}

async function main() {
  const runtime = await createWorkerRuntime();
  let closing = false;
  const shutdown = async signal => {
    if (closing) return;
    closing = true;
    logger.info(`后台 worker 收到 ${signal}，正在安全退出`);
    await runtime.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  await runtime.heartbeat.start();
  if (typeof process.send === 'function') process.send('ready');
  await runtime.worker.start();
  logger.info('IonAiLabs 后台 worker 已就绪');
  return runtime;
}

if (require.main === module) {
  main().catch(error => {
    logger.error(`后台 worker 启动失败: ${error.message}`, { stack: error.stack });
    process.exitCode = 1;
  });
}

module.exports = { createWorkerRuntime, main };
