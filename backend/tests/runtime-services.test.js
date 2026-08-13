import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApplicationRuntime } from '../src/runtime/services.js';

function legacyDb() {
  return {
    prepare: () => ({ get: () => ({ ok: 1 }), all: () => [], run: () => ({ changes: 1 }) }),
    transaction: work => work(),
  };
}

class FakePool {
  static schemaRows = null;
  constructor(options) { this.options = options; this.queries = []; FakePool.instance = this; }
  async query(sql, values) {
    this.queries.push({ sql, values });
    if (sql.includes('FROM schema_migrations')) {
      return { rows: FakePool.schemaRows || repositoryMigrationRows(), rowCount: 4 };
    }
    if (sql.includes('pg_inherits')) {
      return { rows: [{ attached: true, partition_name: 'api_request_logs_2026_08' }], rowCount: 1 };
    }
    return { rows: [{ ok: 1 }], rowCount: 1 };
  }
  async connect() {
    return { query: sql => this.query(sql), release: vi.fn() };
  }
  async end() { this.ended = true; }
}

function repositoryMigrationRows() {
  const directory = path.resolve(import.meta.dirname, '../migrations/postgres');
  return fs.readdirSync(directory)
    .filter(filename => /^\d{3,}_[a-z0-9_]+\.sql$/.test(filename))
    .sort()
    .map(filename => ({
      version: filename.replace(/\.sql$/, ''),
      checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, filename))).digest('hex'),
    }));
}

function fakeRedisDriver({ connectError = null } = {}) {
  const client = {
    isOpen: false,
    async connect() { if (connectError) throw connectError; this.isOpen = true; },
    async ping() { if (connectError) throw connectError; return 'PONG'; },
    async get() { return new Date().toISOString(); },
    async set() { return 'OK'; },
    async incr() { return 1; },
    async eval() { return [1, 'acquired', Date.now() + 1000]; },
    async quit() { this.isOpen = false; },
  };
  return { driver: { createClient: () => client }, client };
}

function postgresEnvironment() {
  return {
    DATABASE_URL: 'postgresql://runtime-test',
    REDIS_URL: 'redis://runtime-test',
    JWT_SECRET: 'runtime-test-secret-with-32-bytes!',
    INFRA_SECRET_ACTIVE_VERSION: 'v1',
    INFRA_SECRET_KEYRING: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64url') }),
  };
}

describe('application runtime services', () => {
  it('keeps an explicit SQL.js compatibility runtime for local tests and rollback only', async () => {
    const runtime = await createApplicationRuntime({ env: {}, legacyDb: legacyDb() });

    expect(runtime.mode).toBe('legacy_sqljs');
    expect(runtime.dashboardReadModel).toBeTruthy();
    expect(runtime.controlPlane).toBeTruthy();
    expect(runtime.identity).toBeNull();
    expect(await runtime.health()).toMatchObject({ status: 'ok', database: { status: 'ok', driver: 'sql.js' } });
  });

  it('creates PostgreSQL, Redis, scheduler, settlement, and read-model services as one runtime', async () => {
    const redis = fakeRedisDriver();
    const runtime = await createApplicationRuntime({
      env: postgresEnvironment(),
      pg: { Pool: FakePool },
      redis: redis.driver,
    });

    expect(runtime.mode).toBe('postgres_redis');
    expect(runtime.gatewayScheduler).toBeTruthy();
    expect(runtime.usageSettlement).toBeTruthy();
    expect(runtime.dashboardReadModel).toBeTruthy();
    expect(runtime.controlPlane).toBeTruthy();
    expect(runtime.identity).toBeTruthy();
    expect(runtime.identity.authenticateApiKey).toBeTypeOf('function');
    expect(await runtime.health()).toMatchObject({
      status: 'ok', ready: true,
      database: { status: 'ok', driver: 'postgresql' },
      schema: {
        status: 'ok',
        missing: [],
        mismatched: [],
        currentPartition: { status: 'ok', attached: true },
      },
      redis: { status: 'ok' },
      worker: { status: 'ok' },
    });
    const partitionProvision = FakePool.instance.queries.find(call => call.sql.includes('ensure_api_request_logs_partition'));
    expect(partitionProvision.values).toEqual([3]);
    await runtime.close();
    expect(redis.client.isOpen).toBe(false);
  });

  it('rejects startup when an expected migration is missing or has checksum drift', async () => {
    const redis = fakeRedisDriver();
    const expected = repositoryMigrationRows();
    FakePool.schemaRows = expected.slice(0, -1);
    await expect(createApplicationRuntime({
      env: postgresEnvironment(), pg: { Pool: FakePool }, redis: redis.driver,
    })).rejects.toThrow(/PostgreSQL schema.*missing/i);
    expect(FakePool.instance.ended).toBe(true);

    FakePool.schemaRows = expected.map((row, index) => index === 0 ? { ...row, checksum: 'drifted' } : row);
    await expect(createApplicationRuntime({
      env: postgresEnvironment(), pg: { Pool: FakePool }, redis: redis.driver,
    })).rejects.toThrow(/PostgreSQL schema.*checksum/i);
    expect(FakePool.instance.ended).toBe(true);
    FakePool.schemaRows = null;
  });

  it('rejects conflicting DATABASE_URL and legacy POSTGRES_URL before opening PostgreSQL', async () => {
    await expect(createApplicationRuntime({
      env: {
        ...postgresEnvironment(),
        POSTGRES_URL: 'postgresql://different-runtime',
      },
      pg: { Pool: FakePool },
      redis: fakeRedisDriver().driver,
    })).rejects.toThrow(/DATABASE_URL and POSTGRES_URL.*different/i);
  });

  it('starts management reads in degraded mode when Redis is down while proxy readiness stays false', async () => {
    const redis = fakeRedisDriver({ connectError: new Error('redis down') });
    const runtime = await createApplicationRuntime({
      env: postgresEnvironment(), pg: { Pool: FakePool }, redis: redis.driver,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(await runtime.health()).toMatchObject({ status: 'degraded', ready: false, redis: { status: 'down' } });
    expect(runtime.dashboardReadModel).toBeTruthy();
    await runtime.close();
  });

  it('rejects a lease TTL that can expire before the stream-idle timeout', async () => {
    const redis = fakeRedisDriver();
    await expect(createApplicationRuntime({
      env: { ...postgresEnvironment(), UPSTREAM_STREAM_IDLE_TIMEOUT_MS: '120000', GATEWAY_LEASE_TTL_MS: '120000' },
      pg: { Pool: FakePool }, redis: redis.driver,
    })).rejects.toThrow(/must exceed UPSTREAM_STREAM_IDLE_TIMEOUT_MS/);
  });

  it('rejects PostgreSQL mode without an explicit strong JWT secret', async () => {
    const redis = fakeRedisDriver();
    const { JWT_SECRET: _removed, ...env } = postgresEnvironment();
    await expect(createApplicationRuntime({ env, pg: { Pool: FakePool }, redis: redis.driver }))
      .rejects.toThrow(/JWT_SECRET with at least 32 bytes/);
  });
});
