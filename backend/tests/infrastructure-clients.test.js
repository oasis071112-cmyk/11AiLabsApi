import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createPostgresPool,
  withTransaction,
  checkPostgres,
  resolveDatabaseUrl,
  readPostgresMigrationManifest,
  inspectPostgresSchema,
  ensureApiRequestLogPartitions,
} = require('../src/infrastructure/postgres.js');
const { createRedisClient, checkRedis } = require('../src/infrastructure/redis.js');

describe('infrastructure client seams', () => {
  it('creates injected Postgres and Redis clients without importing application routes', async () => {
    const redisOn = vi.fn();
    const pool = createPostgresPool({
      connectionString: 'postgresql://pool-test',
      pg: { Pool: class { constructor(options) { this.options = options; } } },
    });
    const redis = createRedisClient({
      url: 'redis://redis-test',
      redis: { createClient: options => ({ options, on: redisOn }) },
    });

    expect(pool.options.connectionString).toBe('postgresql://pool-test');
    expect(redis.options.url).toBe('redis://redis-test');
    expect(redis.options.disableOfflineQueue).toBe(true);
    expect(redisOn).toHaveBeenCalledWith('error', expect.any(Function));

    const queries = [];
    const client = { query: async sql => { queries.push(sql); return { rows: [{ ok: 1 }] }; }, release: () => queries.push('release') };
    const transactionResult = await withTransaction({ connect: async () => client }, activeClient => activeClient.query('SELECT 42'));
    expect(transactionResult.rows).toEqual([{ ok: 1 }]);
    expect(queries).toEqual(['BEGIN', 'SELECT 42', 'COMMIT', 'release']);
    expect(await checkPostgres({ query: async () => ({ rows: [{ ok: 1 }] }) })).toMatchObject({ status: 'ok' });
    expect(await checkRedis({ ping: async () => 'PONG' })).toMatchObject({ status: 'ok' });
  });

  it('uses DATABASE_URL as the canonical setting and rejects conflicting legacy POSTGRES_URL values', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://primary' })).toBe('postgresql://primary');
    expect(resolveDatabaseUrl({ POSTGRES_URL: 'postgresql://legacy' })).toBe('postgresql://legacy');
    expect(resolveDatabaseUrl({
      DATABASE_URL: 'postgresql://shared',
      POSTGRES_URL: 'postgresql://shared',
    })).toBe('postgresql://shared');
    expect(() => resolveDatabaseUrl({
      DATABASE_URL: 'postgresql://primary',
      POSTGRES_URL: 'postgresql://different',
    })).toThrow(/DATABASE_URL and POSTGRES_URL.*different/i);
  });

  it('hashes every migration file as raw bytes and reports missing or drifted schema versions', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-runtime-schema-'));
    try {
      const first = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('SELECT 1;\r\n')]);
      const second = Buffer.from('SELECT 2;\n');
      fs.writeFileSync(path.join(directory, '000_bootstrap.sql'), first);
      fs.writeFileSync(path.join(directory, '001_feature.sql'), second);
      fs.writeFileSync(path.join(directory, 'README.md'), 'ignored');

      const manifest = readPostgresMigrationManifest(directory);
      expect(manifest).toEqual([
        { version: '000_bootstrap', checksum: crypto.createHash('sha256').update(first).digest('hex') },
        { version: '001_feature', checksum: crypto.createHash('sha256').update(second).digest('hex') },
      ]);

      const pool = {
        query: async sql => {
          if (sql.includes('FROM schema_migrations')) {
            return { rows: [
              { version: '000_bootstrap', checksum: manifest[0].checksum },
              { version: '001_feature', checksum: 'drifted' },
            ] };
          }
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      await expect(inspectPostgresSchema(pool, { migrationDirectory: directory })).resolves.toMatchObject({
        status: 'drift',
        missing: [],
        mismatched: [{ version: '001_feature', expected: manifest[1].checksum, actual: 'drifted' }],
      });

      pool.query = async () => ({ rows: [{ version: '000_bootstrap', checksum: manifest[0].checksum }] });
      await expect(inspectPostgresSchema(pool, { migrationDirectory: directory })).resolves.toMatchObject({
        status: 'drift',
        missing: ['001_feature'],
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('pre-creates the current request-log partition plus three future months in one bounded call', async () => {
    const calls = [];
    const result = await ensureApiRequestLogPartitions({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ partition_name: 'api_request_logs_2026_08' }] };
      },
    }, { monthsAhead: 3 });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('ensure_api_request_logs_partition');
    expect(calls[0].sql).toContain('generate_series');
    expect(calls[0].values).toEqual([3]);
    expect(result.monthsProvisioned).toBe(4);
  });
});
