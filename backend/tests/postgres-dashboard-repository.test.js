import { describe, expect, it, vi } from 'vitest';
import { PostgresDashboardRepository } from '../src/modules/dashboard-read-model/postgres-repository.js';

function recordingPool(row = {}) {
  return {
    query: vi.fn(async () => ({ rows: [row] })),
  };
}

describe('PostgresDashboardRepository', () => {
  it('orders the admin daily aggregate by the date alias exposed by its subquery', async () => {
    const pool = recordingPool();
    const repository = new PostgresDashboardRepository(pool);

    await repository.getAdminDashboardSnapshot();

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('jsonb_agg(day ORDER BY date)');
    expect(sql).not.toContain('jsonb_agg(day ORDER BY usage_date)');
  });

  it('orders the user daily aggregate by the date alias exposed by its subquery', async () => {
    const pool = recordingPool();
    const repository = new PostgresDashboardRepository(pool);

    await repository.getUserDashboardSnapshot(42);

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('jsonb_agg(day ORDER BY date)');
    expect(sql).not.toContain('jsonb_agg(day ORDER BY usage_date)');
  });
});
