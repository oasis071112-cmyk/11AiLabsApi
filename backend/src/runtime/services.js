const path = require('node:path');
const {
  assertPostgresSchemaCurrent,
  checkPostgres,
  checkPostgresSchema,
  createPostgresPool,
  ensureApiRequestLogPartitions,
  resolveDatabaseUrl,
} = require('../infrastructure/postgres');
const { createRedisClient, checkRedis } = require('../infrastructure/redis');
const { createSecretBox } = require('../infrastructure/versioned-secret');
const { ControlPlane } = require('../modules/control-plane');
const { LegacyControlPlaneRepository } = require('../modules/control-plane/legacy-repository');
const { PostgresControlPlaneRepository } = require('../modules/control-plane/postgres-repository');
const { DashboardReadModel } = require('../modules/dashboard-read-model');
const { LegacyDashboardRepository } = require('../modules/dashboard-read-model/legacy-repository');
const { PostgresDashboardRepository } = require('../modules/dashboard-read-model/postgres-repository');
const { RedisSnapshotCache } = require('../modules/dashboard-read-model/redis-cache');
const { createGatewayScheduler, PostgresAccountRepository } = require('../modules/gateway-scheduler');
const { UsageSettlement } = require('../modules/usage-settlement');
const { PostgresSettlementRepository } = require('../modules/usage-settlement/postgres-repository');
const { createPostgresIdentity } = require('../modules/identity');

function secretBoxFromEnvironment(env) {
  const activeVersion = env.INFRA_SECRET_ACTIVE_VERSION;
  const rawKeyring = env.INFRA_SECRET_KEYRING;
  if (!activeVersion || !rawKeyring) {
    throw new Error('PostgreSQL runtime requires INFRA_SECRET_ACTIVE_VERSION and INFRA_SECRET_KEYRING');
  }
  let keys;
  try { keys = JSON.parse(rawKeyring); }
  catch (_error) { throw new Error('INFRA_SECRET_KEYRING must be valid JSON'); }
  return createSecretBox({ activeVersion, keys });
}

async function connectRedis(client, logger) {
  if (client?.isOpen === false && typeof client.connect === 'function') {
    try { await client.connect(); }
    catch (error) { logger.warn?.(`Redis 启动连接失败，服务将以降级状态启动: ${error.message}`); }
  }
}

function legacyRuntime(legacyDb) {
  if (!legacyDb) throw new Error('legacy SQL.js runtime requires a database');
  const dashboardReadModel = new DashboardReadModel({
    repository: new LegacyDashboardRepository(legacyDb),
  });
  const controlPlane = new ControlPlane({
    repository: new LegacyControlPlaneRepository(legacyDb),
    // 旧库只作为本地兼容与回滚路径；其渠道字段仍要求原始凭证。
    secretCipher: { encrypt: value => value },
  });
  return {
    mode: 'legacy_sqljs',
    dashboardReadModel,
    controlPlane,
    identity: null,
    gatewayScheduler: null,
    usageSettlement: null,
    async health() {
      try {
        legacyDb.prepare('SELECT 1 AS ok').get();
        return {
          status: 'ok', ready: true,
          database: { status: 'ok', driver: 'sql.js' },
          redis: { status: 'disabled' },
        };
      } catch (_error) {
        return {
          status: 'degraded', ready: false,
          database: { status: 'down', driver: 'sql.js' },
          redis: { status: 'disabled' },
        };
      }
    },
    async close() {},
  };
}

async function postgresRuntime({ env, pg, redis, logger, databaseUrl }) {
  const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS || 120_000);
  const firstByteTimeoutMs = Number(env.UPSTREAM_FIRST_BYTE_TIMEOUT_MS || upstreamTimeoutMs);
  const streamIdleTimeoutMs = Number(env.UPSTREAM_STREAM_IDLE_TIMEOUT_MS || upstreamTimeoutMs);
  const streamTotalTimeoutMs = Number(env.UPSTREAM_TOTAL_TIMEOUT_MS || 900_000);
  const leaseRenewIntervalMs = Number(env.GATEWAY_LEASE_RENEW_INTERVAL_MS || 30_000);
  const leaseTtlMs = Number(env.GATEWAY_LEASE_TTL_MS || 180_000);
  const timeouts = [upstreamTimeoutMs, firstByteTimeoutMs, streamIdleTimeoutMs, streamTotalTimeoutMs, leaseRenewIntervalMs, leaseTtlMs];
  if (timeouts.some(value => !Number.isFinite(value) || value < 1_000)) {
    throw new Error('Upstream timeout and gateway lease values must be finite and at least 1000ms');
  }
  if (streamTotalTimeoutMs < firstByteTimeoutMs || streamTotalTimeoutMs < streamIdleTimeoutMs) {
    throw new Error('UPSTREAM_TOTAL_TIMEOUT_MS must not be shorter than first-byte or stream-idle timeout');
  }
  if (leaseTtlMs < streamIdleTimeoutMs + 5_000 || leaseRenewIntervalMs >= leaseTtlMs) {
    throw new Error('GATEWAY_LEASE_TTL_MS must exceed UPSTREAM_STREAM_IDLE_TIMEOUT_MS by at least 5000ms and exceed its renewal interval');
  }
  if (env.UPSTREAM_TIMEOUT_MS
      && !env.UPSTREAM_FIRST_BYTE_TIMEOUT_MS
      && !env.UPSTREAM_STREAM_IDLE_TIMEOUT_MS) {
    logger.warn?.('UPSTREAM_TIMEOUT_MS is deprecated for streams; configure first-byte and stream-idle timeouts explicitly');
  }
  if (!env.JWT_SECRET || Buffer.byteLength(String(env.JWT_SECRET), 'utf8') < 32) {
    throw new Error('PostgreSQL runtime requires JWT_SECRET with at least 32 bytes');
  }
  const secretBox = secretBoxFromEnvironment(env);
  const redisClient = createRedisClient({
    url: env.REDIS_URL,
    redis,
    onError: error => logger.warn?.(`[redis] ${error.message}`),
  });
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    pg,
    max: Number(env.POSTGRES_POOL_MAX || 20),
    idleTimeoutMillis: Number(env.POSTGRES_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(env.POSTGRES_CONNECT_TIMEOUT_MS || 5_000),
  });
  const migrationDirectory = path.resolve(__dirname, '../../migrations/postgres');
  try {
    await assertPostgresSchemaCurrent(pool, { migrationDirectory });
    await ensureApiRequestLogPartitions(pool, { monthsAhead: 3 });
  } catch (error) {
    await pool.end();
    throw error;
  }
  await connectRedis(redisClient, logger);
  const cache = new RedisSnapshotCache(redisClient, { prefix: env.REDIS_KEY_PREFIX || 'ionailabs' });
  const dashboardReadModel = new DashboardReadModel({
    repository: new PostgresDashboardRepository(pool),
    cache,
    ttlSeconds: Number(env.DASHBOARD_CACHE_TTL_SECONDS || 30),
  });
  const controlPlane = new ControlPlane({
    repository: new PostgresControlPlaneRepository(pool),
    secretCipher: {
      encrypt: (value, { accountKey } = {}) => secretBox.seal(value, {
        aad: `upstream_accounts:${accountKey || 'unknown'}`,
      }),
    },
    cache,
  });
  const gatewayScheduler = createGatewayScheduler({
    accountRepository: new PostgresAccountRepository(pool),
    redis: redisClient,
    redisKeyPrefix: env.REDIS_KEY_PREFIX || 'ionailabs',
    leaseTtlMs,
    rateWindowMs: Number(env.GATEWAY_RATE_WINDOW_MS || 60_000),
  });
  const usageSettlement = new UsageSettlement({ repository: new PostgresSettlementRepository(pool) });
  const identity = createPostgresIdentity({
    pool,
    secretBox,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  });

  return {
    mode: 'postgres_redis',
    pool,
    redis: redisClient,
    secretBox,
    dashboardReadModel,
    controlPlane,
    identity,
    gatewayScheduler,
    usageSettlement,
    proxyTimeouts: {
      upstreamTimeoutMs,
      streamTimeouts: {
        firstByteTimeoutMs,
        idleTimeoutMs: streamIdleTimeoutMs,
        totalTimeoutMs: streamTotalTimeoutMs,
      },
      leaseRenewIntervalMs,
    },
    async health() {
      const [database, schema, redisHealth] = await Promise.all([
        checkPostgres(pool),
        checkPostgresSchema(pool, { migrationDirectory }),
        checkRedis(redisClient),
      ]);
      const infrastructureReady = database.status === 'ok' && schema.status === 'ok' && redisHealth.status === 'ok';
      let worker = { status: 'unknown', heartbeat: null };
      if (redisHealth.status === 'ok') {
        try {
          const heartbeat = await redisClient.get(`${env.REDIS_KEY_PREFIX || 'ionailabs'}:worker:heartbeat`);
          const ageMs = heartbeat ? Date.now() - new Date(heartbeat).getTime() : Number.POSITIVE_INFINITY;
          worker = { status: ageMs <= 120_000 ? 'ok' : 'stale', heartbeat: heartbeat || null };
        } catch (_error) {
          worker = { status: 'unknown', heartbeat: null };
        }
      }
      const ready = infrastructureReady && worker.status === 'ok';
      return {
        status: ready ? 'ok' : 'degraded',
        ready,
        database: { ...database, driver: 'postgresql' },
        schema,
        redis: redisHealth,
        worker,
      };
    },
    async close() {
      try {
        if (redisClient.isOpen && typeof redisClient.quit === 'function') await redisClient.quit();
      } finally {
        await pool.end();
      }
    },
  };
}

async function createApplicationRuntime({
  env = process.env,
  legacyDb = null,
  pg,
  redis,
  logger = console,
} = {}) {
  const databaseUrl = resolveDatabaseUrl(env, { required: false });
  if (!databaseUrl) return legacyRuntime(legacyDb);
  return postgresRuntime({ env, pg, redis, logger, databaseUrl });
}

module.exports = { createApplicationRuntime, secretBoxFromEnvironment };
