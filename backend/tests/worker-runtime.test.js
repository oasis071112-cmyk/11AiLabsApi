import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createWorkerRuntime } from '../src/worker.js';

const require = createRequire(import.meta.url);
const { readPostgresMigrationManifest } = require('../src/infrastructure/postgres.js');
const migrationDirectory = path.resolve(import.meta.dirname, '../migrations/postgres');

function environment(overrides = {}) {
  return {
    DATABASE_URL: 'postgresql://worker-test',
    REDIS_URL: 'redis://worker-test',
    INFRA_SECRET_ACTIVE_VERSION: 'v1',
    INFRA_SECRET_KEYRING: JSON.stringify({ v1: Buffer.alloc(32, 9).toString('base64url') }),
    ...overrides,
  };
}

function postgresDriver(schemaRows = readPostgresMigrationManifest(migrationDirectory)) {
  const instances = [];
  class Pool {
    constructor(options) { this.options = options; this.queries = []; this.ended = false; instances.push(this); }
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (sql.includes('FROM schema_migrations')) return { rows: schemaRows };
      if (sql.includes('ensure_api_request_logs_partition')) return { rows: [] };
      if (sql.includes('SELECT 1 AS ok')) return { rows: [{ ok: 1 }] };
      throw new Error(`unexpected worker query: ${sql}`);
    }
    async end() { this.ended = true; }
  }
  return { driver: { Pool }, instances };
}

function redisDriver() {
  const client = {
    isOpen: false,
    async connect() { this.isOpen = true; },
    async ping() { return 'PONG'; },
    set: vi.fn(async () => 'OK'),
    async eval() { return [1, 30_000]; },
    async quit() { this.isOpen = false; },
  };
  return { driver: { createClient: () => client }, client };
}

describe('PostgreSQL worker startup safety', () => {
  it('checks checksums and provisions partitions before exposing a heartbeat', async () => {
    const pg = postgresDriver();
    const redis = redisDriver();

    const runtime = await createWorkerRuntime({
      env: environment(), pg: pg.driver, redis: redis.driver, logger: { error: vi.fn() },
    });

    const sql = pg.instances[0].queries.map(query => query.sql).join('\n');
    expect(sql.indexOf('FROM schema_migrations')).toBeLessThan(sql.indexOf('ensure_api_request_logs_partition'));
    expect(runtime.heartbeat).toBeTruthy();
    expect(runtime.reconciliationWorker.tasks.map(task => task.name)).toEqual(['pending-reconciliation']);
    expect(runtime.worker.tasks.map(task => task.name)).not.toContain('pending-reconciliation');
    expect(redis.client.set).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('refuses startup and closes PostgreSQL when a migration is missing', async () => {
    const manifest = readPostgresMigrationManifest(migrationDirectory);
    const pg = postgresDriver(manifest.slice(0, -1));

    await expect(createWorkerRuntime({
      env: environment(), pg: pg.driver, redis: redisDriver().driver, logger: { error: vi.fn() },
    })).rejects.toThrow(/missing versions/i);
    expect(pg.instances[0].ended).toBe(true);
  });

  it('rejects conflicting database URLs and unsafe retention before connecting', async () => {
    const conflicting = postgresDriver();
    await expect(createWorkerRuntime({
      env: environment({ POSTGRES_URL: 'postgresql://different' }),
      pg: conflicting.driver,
      redis: redisDriver().driver,
    })).rejects.toThrow(/both set but different/i);
    expect(conflicting.instances).toHaveLength(0);

    const unsafeRetention = postgresDriver();
    await expect(createWorkerRuntime({
      env: environment({ REQUEST_LOG_RETENTION_DAYS: '-1' }),
      pg: unsafeRetention.driver,
      redis: redisDriver().driver,
    })).rejects.toThrow(/retention/i);
    expect(unsafeRetention.instances).toHaveLength(0);
  });
});
