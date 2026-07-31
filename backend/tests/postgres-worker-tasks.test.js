import { describe, expect, it, vi } from 'vitest';
import {
  createPostgresWorkerTasks,
  validateRetentionDays,
} from '../src/modules/background-worker/postgres-tasks.js';

describe('PostgreSQL worker tasks', () => {
  it('probes encrypted upstream accounts without persisting or logging the plaintext secret', async () => {
    const queries = [];
    const pool = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM upstream_accounts') && sql.includes('api_key_envelope')) {
          return { rows: [{
            id: 5, account_key: 'primary', base_url: 'https://upstream.example/v1',
            protocol_type: 'openai_compatible', api_key_envelope: 'v1.envelope',
            health_score: 80, cooldown_seconds: 30,
          }] };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const secretBox = { open: vi.fn(() => 'sk-plain-secret') };
    const http = { get: vi.fn(async () => ({ status: 200 })) };
    const logger = { error: vi.fn(), info: vi.fn() };
    const tasks = createPostgresWorkerTasks({ pool, secretBox, http, logger, redis: null });

    await tasks.find(task => task.name === 'account-monitor').run();

    expect(secretBox.open).toHaveBeenCalledWith('v1.envelope', { aad: 'upstream_accounts:primary' });
    expect(http.get).toHaveBeenCalledWith('https://upstream.example/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer sk-plain-secret' }),
    }));
    expect(JSON.stringify(queries)).not.toContain('sk-plain-secret');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-plain-secret');
    expect(queries.some(query => query.sql.includes('INSERT INTO upstream_account_probes'))).toBe(true);
    expect(queries.find(query => query.sql.includes('UPDATE upstream_accounts')).sql)
      .toContain('cooldown_until<=');
  });

  it('marks authentication failures unhealthy and stores only a sanitized probe result', async () => {
    const queries = [];
    const pool = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM upstream_accounts') && sql.includes('api_key_envelope')) {
          return { rows: [{
            id: 9, account_key: 'bad-auth', base_url: 'https://upstream.example/v1',
            protocol_type: 'openai_compatible', api_key_envelope: 'v1.envelope',
            health_score: 80, cooldown_seconds: 30,
          }] };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const tasks = createPostgresWorkerTasks({
      pool,
      secretBox: { open: () => 'sk-do-not-store' },
      http: { get: async () => ({ status: 401 }) },
      redis: { eval: vi.fn(async () => [1, 30_000]) },
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });

    const result = await tasks.find(task => task.name === 'account-monitor').run();

    expect(result).toEqual({ checked: 1, healthy: 0 });
    const probe = queries.find(query => query.sql.includes('INSERT INTO upstream_account_probes'));
    expect(probe.params).toEqual([9, 'failed', expect.any(Number), 401, 'http_401']);
    expect(queries.find(query => query.sql.includes('UPDATE upstream_accounts')).sql)
      .toContain('GREATEST(COALESCE(cooldown_until');
    expect(JSON.stringify(queries)).not.toContain('sk-do-not-store');
  });

  it('backfills every missing daily aggregate in one transaction before advancing its watermark', async () => {
    const queries = [];
    const query = vi.fn(async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("config_key='worker_daily_aggregate_watermark'")) {
        return { rows: [{ watermark: '2026-07-28' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn(async () => client) };
    const tasks = createPostgresWorkerTasks({
      pool,
      secretBox: { open: () => '' },
      http: { get: async () => ({ status: 200 }) },
      retentionDays: 90,
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });

    await tasks.find(task => task.name === 'daily-aggregation').run();
    await tasks.find(task => task.name === 'log-retention').run();

    const sql = queries.map(query => query.sql).join('\n');
    expect(queries.map(item => item.sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    expect(sql).toContain('DELETE FROM user_daily_usage');
    expect(sql).toContain('DELETE FROM user_api_key_daily_usage');
    expect(sql).toContain('DELETE FROM platform_daily_usage');
    expect(sql).toContain('ON CONFLICT (usage_date,user_id,model_code) DO UPDATE');
    expect(sql).toContain('ON CONFLICT (usage_date,user_id,api_key_id,model_code) DO UPDATE');
    expect(sql).toContain('ON CONFLICT (usage_date,model_code) DO UPDATE');
    expect(sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(sql).toContain('worker_daily_aggregate_watermark');
    expect(sql).toContain('DELETE FROM api_request_logs');
    expect(queries.find(item => item.sql.includes('INSERT INTO user_daily_usage')).params)
      .toEqual(['2026-07-29', '2026-08-01']);
    expect(queries.at(-1).params).toContain(90);
  });

  it('recomputes the current day even when the watermark already equals today', async () => {
    const queries = [];
    const query = vi.fn(async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("config_key='worker_daily_aggregate_watermark'")) {
        return { rows: [{ watermark: '2026-08-01' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = { query, connect: async () => ({ query, release() {} }) };
    const tasks = createPostgresWorkerTasks({
      pool,
      secretBox: { open: () => '' },
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });

    await tasks.find(task => task.name === 'daily-aggregation').run();

    expect(queries.find(item => item.sql.includes('INSERT INTO user_daily_usage')).params)
      .toEqual(['2026-08-01', '2026-08-01']);
  });

  it.each([0, -1, 29, 366, Number.NaN, 90.5])('rejects unsafe log retention: %s', value => {
    expect(() => validateRetentionDays(value)).toThrow(/retention/i);
  });

  it('creates current and three future request-log partitions', async () => {
    const queries = [];
    const pool = { query: vi.fn(async (sql, params = []) => { queries.push({ sql, params }); return { rows: [], rowCount: 0 }; }) };
    const tasks = createPostgresWorkerTasks({
      pool,
      secretBox: { open: () => '' },
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
      partitionHorizonMonths: 3,
    });

    const result = await tasks.find(task => task.name === 'partition-maintenance').run();

    expect(result.months).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    expect(queries.map(item => item.params[0])).toEqual(result.months);
  });

  it('marks account monitoring degraded when an individual probe crashes', async () => {
    const pool = {
      async query(sql) {
        if (sql.includes('FROM upstream_accounts')) return { rows: [{
          id: 1, account_key: 'broken', base_url: 'https://upstream.example/v1',
          protocol_type: 'openai_compatible', api_key_envelope: 'bad', cooldown_seconds: 60,
        }] };
        if (sql.includes('INSERT INTO upstream_account_probes')) throw new Error('probe history unavailable');
        return { rows: [], rowCount: 0 };
      },
    };
    const tasks = createPostgresWorkerTasks({ pool, secretBox: { open: () => { throw new Error('decrypt failed'); } } });

    await expect(tasks.find(task => task.name === 'account-monitor').run())
      .rejects.toThrow(/1 of 1 account probes failed/i);
  });
});
