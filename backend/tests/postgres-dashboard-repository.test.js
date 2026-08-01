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

  it('returns numeric log costs and a display-safe billing detail from PostgreSQL snapshots', async () => {
    const pool = {
      query: vi.fn(async sql => {
        if (sql.includes('ORDER BY created_at DESC LIMIT')) return { rows: [{
          request_id: 'req-pg', model_code: 'claude-opus-4-8', status: 'success',
          input_tokens: '0', output_tokens: '83', total_cost: '0.002101', billing_mode: 'token',
          billing_detail: { charge: {
            mode: 'token', currency: 'USD', unit_tokens: 1,
            input_price: 0.000005, output_price: 0.000025,
            input_multiplier: 0.15, output_multiplier: 0.15,
          } },
        }] };
        if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: '1', input_tokens: '0', output_tokens: '83', cost: '0.002101' }] };
        if (sql.includes("AT TIME ZONE 'Asia/Shanghai'")) return { rows: [] };
        return { rows: [{ total_calls: '1', total_consumption: '0.002101' }] };
      }),
    };
    const repository = new PostgresDashboardRepository(pool);

    const result = await repository.getUserLogsOverview(2, {
      page: 1, limit: 20, status: '', model: '', startDate: '', endDate: '',
    });

    expect(result.data[0].total_cost).toBe(0.002101);
    expect(result.data[0].billing_detail).toMatchObject({
      mode: 'snapshot', dimensions: [expect.objectContaining({ usage: 83 })],
    });
  });
});
