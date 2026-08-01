import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresDashboardRepository } from '../src/modules/dashboard-read-model/postgres-repository.js';

const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe('PostgresDashboardRepository integration', () => {
  let pool;
  let repository;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    repository = new PostgresDashboardRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('executes every dashboard and logs overview query against the migrated schema', async () => {
    const admin = await repository.getAdminDashboardSnapshot();
    const user = await repository.getUserDashboardSnapshot(9_999_999);
    const logs = await repository.getUserLogsOverview(9_999_999, {
      page: 1,
      limit: 20,
      status: '',
      model: '',
      startDate: '',
      endDate: '',
    });

    expect(admin).toMatchObject({ active_channels: expect.any(Number) });
    expect(admin.daily_trend).toEqual(expect.any(Array));
    expect(user).toMatchObject({ wallet: {}, stats: {}, has_api_keys: false });
    expect(user.daily).toEqual([]);
    expect(logs).toMatchObject({ data: [], pagination: { page: 1, limit: 20, total: 0 } });
  });
});
