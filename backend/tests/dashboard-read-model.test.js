import { describe, expect, it, vi } from 'vitest';
import { DashboardReadModel } from '../src/modules/dashboard-read-model/index.js';

describe('DashboardReadModel', () => {
  it('returns a user bootstrap snapshot from one repository read and caches it', async () => {
    const snapshot = {
      wallet: { quota_balance: 12, gift_quota: 3, frozen_balance: 1 },
      stats: { calls: 8, cost: 2.5 },
      daily: [{ date: '2026-08-01', calls: 8, cost: 2.5 }],
      keys: [{ id: 7, key_name: 'default' }],
    };
    const repository = {
      getUserDashboardSnapshot: vi.fn(async () => snapshot),
    };
    const values = new Map();
    const cache = {
      get: vi.fn(async key => values.get(key) || null),
      set: vi.fn(async (key, value) => values.set(key, value)),
    };
    const readModel = new DashboardReadModel({ repository, cache, clock: () => new Date('2026-08-01T12:00:00.000Z') });

    const first = await readModel.userBootstrap(42);
    const second = await readModel.userBootstrap(42);

    expect(first).toMatchObject({ ...snapshot, read_model: { source: 'database', cache_status: 'ok' } });
    expect(second).toMatchObject({ ...snapshot, read_model: { source: 'cache', cache_status: 'ok' } });
    expect(repository.getUserDashboardSnapshot).toHaveBeenCalledTimes(1);
  });

  it('falls back to the repository and marks degraded cache state when Redis is unavailable', async () => {
    const repository = {
      getAdminDashboardSnapshot: vi.fn(async () => ({ today_calls: 11, active_accounts: 2 })),
    };
    const cache = {
      get: vi.fn(async () => { throw new Error('redis unavailable'); }),
      set: vi.fn(async () => { throw new Error('redis unavailable'); }),
    };
    const readModel = new DashboardReadModel({ repository, cache });

    const result = await readModel.adminBootstrap();

    expect(result).toMatchObject({
      today_calls: 11,
      active_accounts: 2,
      read_model: { source: 'database', cache_status: 'degraded' },
    });
  });

  it('normalizes logs overview filters before the aggregate repository call', async () => {
    const repository = {
      getUserLogsOverview: vi.fn(async (_userId, query) => ({ query, data: [], summary: { calls: 0 } })),
    };
    const readModel = new DashboardReadModel({ repository });

    const result = await readModel.userLogsOverview(9, {
      page: '-3',
      limit: '9999',
      status: 'success',
      model: ' gpt-image-2 ',
      start_date: '2026-07-01',
      end_date: '2026-08-01',
    });

    expect(repository.getUserLogsOverview).toHaveBeenCalledWith(9, {
      page: 1,
      limit: 100,
      status: 'success',
      model: 'gpt-image-2',
      startDate: '2026-07-01',
      endDate: '2026-08-01',
    });
    expect(result.query.page).toBe(1);
  });
});
