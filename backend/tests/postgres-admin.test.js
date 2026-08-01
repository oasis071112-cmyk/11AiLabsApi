import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresAdminRouter } = require('../src/routes/postgres-admin.js');
const { PostgresAdminCompatRepository } = require('../src/modules/control-plane/admin-compat-repository.js');

function adminOnly(req, _res, next) {
  req.user = { id: 9, role: 'admin', staff_id: 77 };
  next();
}

describe('PostgreSQL management compatibility router', () => {
  let server;
  let baseUrl;
  let repository;
  let pricingSyncService;

  beforeAll(async () => {
    repository = {
      getDashboard: vi.fn(async () => ({ today_calls: 3 })),
      listUsers: vi.fn(async () => ({ data: [{ id: 3, username: 'alice' }], pagination: { page: 1, limit: 20, total: 1 } })),
      getUser: vi.fn(async id => ({ user: { id: Number(id), username: 'alice' }, pending_orders: [] })),
      setUserStatus: vi.fn(async (id, status) => ({ id, status })),
      adjustUserBalance: vi.fn(async (id, body) => ({ user_id: id, amount: body.amount })),
      listRechargeOrders: vi.fn(async () => ({ data: [{ id: 8, status: 'pending' }], pagination: { page: 1, limit: 20, total: 1 } })),
      confirmRechargeOrder: vi.fn(async id => ({ id, status: 'granted' })),
      rejectRechargeOrder: vi.fn(async id => ({ id, status: 'rejected' })),
      listKeys: vi.fn(async () => ({ data: [{ id: 4, key_prefix: 'sk-test' }], pagination: { page: 1, limit: 20, total: 1 } })),
      setKeyStatus: vi.fn(async (id, status) => ({ id, status })),
      updateKeyPermissions: vi.fn(async (id, models) => ({ id, permissions: models })),
      listLogs: vi.fn(async () => ({ data: [{ request_id: 'req-1' }], pagination: { page: 1, limit: 50, total: 1 } })),
      listModels: vi.fn(async () => [{ id: 'gpt-image-2', model_code: 'gpt-image-2', status: 'active' }]),
      listPricingRules: vi.fn(async () => [{ id: 'platform:all', rule_name: '默认', scope_type: 'platform' }]),
      createPricingRule: vi.fn(async body => ({ id: 'new-rule', ...body })),
      updatePricingRule: vi.fn(async (id, body) => ({ id, ...body })),
      deletePricingRule: vi.fn(async () => true),
      createModel: vi.fn(async body => ({ id: body.model_code, model_code: body.model_code, status: 'inactive' })),
      updateModel: vi.fn(async (id, body) => ({ id, ...body })),
      setModelStatus: vi.fn(async (id, status) => ({ id, status })),
      listChannels: vi.fn(async () => [{ id: 7, channel_name: 'primary', secret_configured: true, apiKey: 'ciphertext-never-return-me', api_key_envelope: 'envelope-never-return-me' }]),
      getChannelMonitoring: vi.fn(async (id, options) => ({
        account: { id: Number(id), channel_name: 'primary', secret_configured: true },
        window_hours: options.windowHours,
        summary: {
          total: 4, healthy: 3, availability_percent: 75, average_latency_ms: 120,
          last_checked_at: new Date('2026-08-01T00:00:00.000Z'),
        },
        history: [{ id: 1, status: 'healthy', latency_ms: 100, checked_at: new Date('2026-08-01T00:00:00.000Z') }],
      })),
      createChannel: vi.fn(async body => ({ id: 7, channel_name: body.channel_name, secret_configured: true })),
      updateChannel: vi.fn(async (id, body) => ({ id, channel_name: body.channel_name, secret_configured: true })),
      setChannelStatus: vi.fn(async (id, status) => ({ id, status })),
      deleteChannel: vi.fn(async () => true),
      listChannelModels: vi.fn(async () => [{
        account_id: 7, model_code: 'gpt-image-2', upstream_model_name: 'vendor-image-2',
        supports_image_input: true, configuration: { image_price_1k: 0.04 }, status: 'active',
      }]),
      replaceChannelModels: vi.fn(async () => []),
      syncChannelModels: vi.fn(async id => ({ message: '同步完成：新增 1，更新 0', created: 1, updated: 0, id })),
      setChannelModelStatus: vi.fn(async () => ({})),
      listRoutingGroups: vi.fn(async () => [{ id: 2, group_name: 'primary', channels: [], model_codes: [] }]),
      createRoutingGroup: vi.fn(async body => ({ id: 2, group_name: body.group_name })),
      updateRoutingGroup: vi.fn(async (id, body) => ({ id, group_name: body.group_name })),
      setRoutingGroupStatus: vi.fn(async (id, status) => ({ id, status })),
      deleteRoutingGroup: vi.fn(async () => true),
      replaceRoutingGroupMembers: vi.fn(async () => []),
      replaceRoutingGroupModels: vi.fn(async () => []),
      listPaymentProviders: vi.fn(async () => [{ id: 1, provider_name: 'pay', secret_configured: true, status: 'disabled' }]),
      createPaymentProvider: vi.fn(async body => ({ id: 1, provider_name: body.provider_name, secret_configured: true, status: 'disabled' })),
      updatePaymentProvider: vi.fn(async (id, body) => ({ id, provider_name: body.provider_name, secret_configured: true, status: body.enable ? 'active' : 'disabled' })),
      deletePaymentProvider: vi.fn(async () => true),
      listConfig: vi.fn(async () => [{ config_key: 'payment_enabled', config_value: false }]),
      updateConfig: vi.fn(async (key, value) => ({ config_key: key, config_value: value })),
    };
    pricingSyncService = {
      status: vi.fn(async () => ({ exchange_rate: 7.1, official_pricing_last_sync_status: 'ok' })),
      syncAll: vi.fn(async () => ({ exchange_rate: { ok: true, rate: 7.1 }, official_pricing: { updated: 2, failed: 0 } })),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createPostgresAdminRouter({
      repository,
      pricingSyncService,
      authenticate: adminOnly,
      requireAdmin: () => adminOnly,
    }));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  async function request(path, options = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  }

  it('exposes the management read models through the mounted router', async () => {
    for (const [path, expected] of [
      ['/dashboard', { today_calls: 3 }],
      ['/users', { data: [{ username: 'alice' }] }],
      ['/keys', { data: [{ key_prefix: 'sk-test' }] }],
      ['/logs', { data: [{ request_id: 'req-1' }] }],
      ['/accounts', { data: [{ channel_name: 'primary' }] }],
      ['/accounts/7/monitor?window_hours=12&limit=25', {
        window_hours: 12,
        summary: { availability_percent: 75, last_checked_at: '2026-08-01T00:00:00.000Z' },
        history: [{ checked_at: '2026-08-01T00:00:00.000Z' }],
      }],
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(expected);
    }
    expect(repository.getChannelMonitoring).toHaveBeenCalledWith('7', { limit: 25, windowHours: 12 });
  });

  it('provides model, channel and routing group compatibility CRUD/status seams', async () => {
    expect((await request('/models', { method: 'POST', body: JSON.stringify({ model_code: 'gpt-image-2', model_name: 'Image' }) })).status).toBe(201);
    expect((await request('/models/gpt-image-2/status', { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) })).status).toBe(200);
    expect((await request('/channels', { method: 'POST', body: JSON.stringify({ channel_name: 'primary', base_url: 'https://upstream.example/v1', api_key: 'never-return-me' }) })).status).toBe(201);
    expect((await request('/channels/7/status', { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) })).status).toBe(200);
    const mappings = await (await request('/channels/7/models')).json();
    expect(mappings).toMatchObject({
      data: [{ model_code: 'gpt-image-2' }],
      mappings: [{ model_code: 'gpt-image-2', configuration: { image_price_1k: 0.04 } }],
    });
    const sync = await request('/channels/7/sync-models', { method: 'POST' });
    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({ message: '同步完成：新增 1，更新 0' });
    expect((await request('/routing-groups', { method: 'POST', body: JSON.stringify({ group_name: 'primary' }) })).status).toBe(201);
    expect((await request('/routing-groups/2/members', { method: 'PUT', body: JSON.stringify({ members: [{ account_id: 7, weight: 100 }] }) })).status).toBe(200);
    expect((await request('/routing-groups/2/models', { method: 'PUT', body: JSON.stringify({ model_codes: ['gpt-image-2'] }) })).status).toBe(200);
    const payload = await (await request('/channels')).json();
    expect(JSON.stringify(payload)).not.toContain('never-return-me');
    expect(JSON.stringify(payload)).not.toContain('ciphertext-never-return-me');
    expect(JSON.stringify(payload)).not.toContain('envelope-never-return-me');
    expect(JSON.stringify(payload)).not.toContain('api_key_envelope');
  });

  it('exposes every user, order, key and pricing action used by the management UI', async () => {
    const calls = [
      request('/users/3/status', { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) }),
      request('/users/3/adjust-balance', { method: 'POST', body: JSON.stringify({ type: 'manual_add', balance_type: 'recharge', amount: 2 }) }),
      request('/recharge-orders'),
      request('/recharge-orders/8/confirm', { method: 'PATCH', body: '{}' }),
      request('/recharge-orders/8/reject', { method: 'PATCH', body: JSON.stringify({ remark: 'invalid' }) }),
      request('/keys/4/status', { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) }),
      request('/keys/4/permissions', { method: 'PUT', body: JSON.stringify({ model_codes: ['model-a'] }) }),
      request('/pricing-rules'),
      request('/pricing-rules', { method: 'POST', body: JSON.stringify({ rule_name: '默认', scope_type: 'platform', multiplier_input: 1, multiplier_output: 1, multiplier_image: 1 }) }),
      request('/pricing-rules/platform%3Aall', { method: 'PUT', body: JSON.stringify({ rule_name: '默认', scope_type: 'platform', multiplier_input: 1, multiplier_output: 1, multiplier_image: 1 }) }),
      request('/pricing-rules/platform%3Aall', { method: 'DELETE' }),
      request('/pricing-sync/status'),
      request('/pricing-sync', { method: 'POST', body: '{}' }),
    ];
    for (const response of await Promise.all(calls)) expect(response.status).toBeLessThan(400);
    expect(repository.listKeys).toHaveBeenCalledWith(expect.objectContaining({ groupBy: undefined }));
  });

  it('requires an explicit enable flag before activating payment', async () => {
    const rejected = await request('/payment/providers/1', {
      method: 'PUT', body: JSON.stringify({ provider_name: 'pay', status: 'active' }),
    });
    expect(rejected.status).toBe(400);
    expect(repository.updatePaymentProvider).not.toHaveBeenCalled();

    const accepted = await request('/payment/providers/1', {
      method: 'PUT', body: JSON.stringify({ provider_name: 'pay', status: 'active', enable: true }),
    });
    expect(accepted.status).toBe(200);
    expect(repository.updatePaymentProvider).toHaveBeenCalledWith('1', expect.objectContaining({ enable: true }), expect.any(Object));
  });

  it('seals upstream and payment secrets, returns only configured flags, and audits the transaction', async () => {
    const calls = [];
    const client = {
      async query(sql, values = []) {
        calls.push({ sql, values });
        if (sql.includes('INSERT INTO upstream_accounts')) {
          return { rows: [{
            id: 7, account_key: 'primary', display_name: 'primary', base_url: 'https://upstream.example/v1',
            protocol_type: 'openai_compatible', capabilities: [], status: 'active', max_concurrency: 1,
            rpm_limit: 60, tpm_limit: 100000, cooldown_seconds: 60, priority: 0, weight: 100,
            health_score: 100, secret_configured: true,
          }] };
        }
        if (sql.includes('INSERT INTO payment_providers')) {
          return { rows: [{ id: 2, provider_code: 'pay', provider_name: 'Pay', provider_type: 'easypay', config: { merchant_id: 'm-1' }, status: 'disabled', secret_configured: true }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const secretBox = { activeVersion: 'v1', seal: vi.fn(value => `v1.opaque-${value.length}`) };
    const repository = new PostgresAdminCompatRepository({
      pool: { query: client.query.bind(client), connect: async () => client }, secretBox,
    });

    const channel = await repository.createChannel({
      channel_name: 'primary', base_url: 'https://upstream.example/v1', api_key: 'upstream-secret',
    }, { id: 9, staffId: 77, role: 'admin' });
    const provider = await repository.createPaymentProvider({
      provider_code: 'pay', provider_name: 'Pay', merchant_key: 'merchant-secret', enable: false,
    }, { id: 9, staffId: 77, role: 'admin' });

    expect(secretBox.seal).toHaveBeenNthCalledWith(1, 'upstream-secret', { aad: 'upstream_accounts:primary' });
    expect(secretBox.seal).toHaveBeenNthCalledWith(2, 'merchant-secret', { aad: 'payment_providers:pay' });
    expect(JSON.stringify({ channel, provider, calls })).not.toContain('upstream-secret');
    expect(JSON.stringify({ channel, provider, calls })).not.toContain('merchant-secret');
    expect(channel).toMatchObject({ secret_configured: true });
    expect(provider).toMatchObject({ secret_configured: true });
    expect(calls.filter(call => call.sql.includes('INSERT INTO audit_logs'))).toHaveLength(2);
    expect(calls.filter(call => call.sql.includes('INSERT INTO audit_logs')).every(call => call.values[2] === 77)).toBe(true);
  });

  it('keeps routing-group reads inside the write transaction when no member or model rule changes', async () => {
    const client = {
      async query(sql) {
        if (sql.includes('SELECT * FROM routing_groups')) {
          return { rows: [{ id: 2, group_key: 'primary', group_name: 'primary', protocol_type: 'openai_compatible', status: 'active', configuration: {}, fallback_group_id: null, restrict_models: false }] };
        }
        if (sql.includes('UPDATE routing_groups')) {
          return { rows: [{ id: 2, group_key: 'primary', group_name: 'renamed', protocol_type: 'openai_compatible', status: 'active', configuration: {}, fallback_group_id: null, restrict_models: false }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async () => { throw new Error('must not query pool during transaction'); }),
      connect: async () => client,
    };
    const repository = new PostgresAdminCompatRepository({ pool, secretBox: { activeVersion: 'v1', seal: () => 'unused' } });

    const updated = await repository.updateRoutingGroup(2, { group_name: 'renamed' }, { id: 9, staffId: 77, role: 'admin' });

    expect(updated).toMatchObject({ id: 2, group_name: 'renamed', channels: [], model_codes: [] });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('serves the legacy dashboard contract from daily aggregates instead of request-log scans', async () => {
    const queries = [];
    const pool = {
      connect: vi.fn(),
      async query(sql) {
        queries.push(sql);
        if (sql.includes('platform_daily_usage') && sql.includes('usage_date=CURRENT_DATE')) {
          return { rows: [{ calls: '5', success_calls: '4', failed_calls: '1', blocked_calls: '0', cost: '0.5' }] };
        }
        return { rows: [{ count: '0', total: '0' }] };
      },
    };
    const data = new PostgresAdminCompatRepository({
      pool,
      secretBox: { activeVersion: 'v1', seal: () => 'unused' },
    });

    const dashboard = await data.getDashboard();

    expect(dashboard).toMatchObject({ today_calls: 5, success_calls: 4, failed_calls: 1, today_consumption: '0.5' });
    expect(queries.some(sql => sql.includes('platform_daily_usage'))).toBe(true);
    expect(queries.every(sql => !sql.includes('api_request_logs'))).toBe(true);
  });

  it('serves account availability and sanitized probe history from the monitoring read model', async () => {
    const queries = [];
    const pool = {
      connect: vi.fn(),
      async query(sql, values) {
        queries.push({ sql, values });
        if (sql.includes('FROM upstream_accounts WHERE id=$1')) {
          return { rows: [{
            id: 7, account_key: 'primary', display_name: 'Primary', base_url: 'https://upstream.example/v1',
            protocol_type: 'openai_compatible', capabilities: [], status: 'active', max_concurrency: 2,
            rpm_limit: 60, tpm_limit: 100000, cooldown_seconds: 30, priority: 0, weight: 100,
            health_score: 98, secret_configured: true,
          }] };
        }
        if (sql.includes('COUNT(*) AS total')) {
          return { rows: [{ total: '4', healthy: '3', degraded: '1', failed: '0', availability_percent: '75.00', average_latency_ms: '120.50', p95_latency_ms: 180 }] };
        }
        if (sql.includes('FROM upstream_account_probes')) {
          return { rows: [{ id: 2, status: 'degraded', latency_ms: 180, http_status: 429, error_code: 'http_429', checked_at: '2026-08-01T00:00:00Z' }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    const data = new PostgresAdminCompatRepository({
      pool,
      secretBox: { activeVersion: 'v1', seal: () => 'unused' },
    });

    const monitoring = await data.getChannelMonitoring(7, { limit: 10, windowHours: 12 });

    expect(monitoring).toMatchObject({
      account: { id: 7, channel_name: 'Primary', secret_configured: true },
      window_hours: 12,
      summary: { total: 4, healthy: 3, degraded: 1, availability_percent: 75, average_latency_ms: 120.5, p95_latency_ms: 180 },
      history: [{ status: 'degraded', http_status: 429, error_code: 'http_429' }],
    });
    expect(queries.find(query => query.sql.includes('COUNT(*) AS total')).values).toEqual([7, 12]);
    expect(queries.find(query => query.sql.includes('ORDER BY checked_at DESC')).values).toEqual([7, 10]);
    expect(JSON.stringify(monitoring)).not.toContain('api_key');
  });

  it('preserves imported per-model multipliers when the compatibility UI submits model codes only', async () => {
    const queries = [];
    const client = {
      async query(sql, values = []) {
        queries.push({ sql, values });
        if (sql.includes('SELECT id FROM routing_groups')) return { rows: [{ id: 2 }] };
        if (sql.includes('FROM routing_group_models WHERE routing_group_id=$1')) {
          return { rows: [{
            routing_group_id: 2, model_code: 'gpt-image-2', status: 'active', billing_multiplier: '1.1',
            billing_multiplier_input: '1.2', billing_multiplier_output: '1.3', billing_multiplier_image: '1.4',
          }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const data = new PostgresAdminCompatRepository({
      pool: { query: client.query.bind(client), connect: async () => client },
      secretBox: { activeVersion: 'v1', seal: () => 'unused' },
    });

    const result = await data.replaceRoutingGroupModels(2, ['gpt-image-2'], { staffId: 77 });

    expect(result).toEqual([expect.objectContaining({
      model_code: 'gpt-image-2', billing_multiplier: 1.1,
      billing_multiplier_input: 1.2, billing_multiplier_output: 1.3, billing_multiplier_image: 1.4,
    })]);
    const insert = queries.find(query => query.sql.includes('INSERT INTO routing_group_models'));
    expect(insert.values).toEqual([2, 'gpt-image-2', 'active', 1.1, 1.2, 1.3, 1.4]);
  });

  it('never rejects paid orders and never reactivates revoked API keys', async () => {
    const calls = [];
    const client = {
      async query(sql, values = []) {
        calls.push({ sql, values });
        if (sql.includes('FROM quota_orders WHERE id=$1 FOR UPDATE')) {
          return { rows: [{ id: 8, order_no: 'paid-8', user_id: 3, amount: '2', status: 'paid' }] };
        }
        if (sql.includes('FROM api_keys WHERE id=$1 FOR UPDATE')) {
          return { rows: [{ id: 4, user_id: 3, key_name: 'revoked', status: 'revoked' }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const data = new PostgresAdminCompatRepository({
      pool: { query: client.query.bind(client), connect: async () => client },
      secretBox: { activeVersion: 'v1', seal: () => 'unused' },
    });
    const actor = { id: 9, staffId: 77, role: 'admin' };

    await expect(data.rejectRechargeOrder(8, { remark: 'invalid' }, actor))
      .rejects.toMatchObject({ status: 409, code: 'paid_order_requires_grant' });
    await expect(data.setKeyStatus(4, 'active', actor))
      .rejects.toMatchObject({ status: 409, code: 'revoked_key_immutable' });
    expect(calls.some(call => call.sql.includes("SET status='rejected'"))).toBe(false);
    expect(calls.some(call => call.sql.includes('UPDATE api_keys SET status'))).toBe(false);
  });

  it('reactivates an inactive channel with active mappings and allows account-pool model overlap', async () => {
    const calls = [];
    const client = {
      async query(sql, values = []) {
        calls.push({ sql, values });
        if (sql.includes('SELECT model_code,status FROM account_models')) return { rows: [{ model_code: 'shared-model', status: 'active' }] };
        if (sql.includes('SELECT ua.id FROM upstream_accounts')) {
          return sql.includes("ua.status='active'") ? { rows: [] } : { rows: [{ id: 7 }] };
        }
        if (sql.includes('UPDATE upstream_accounts SET status')) {
          return { rows: [{ id: 7, account_key: 'pool-a', display_name: 'Pool A', base_url: 'https://upstream.example/v1', protocol_type: 'openai_compatible', capabilities: [], status: 'active' }] };
        }
        if (sql.includes('UPDATE models SET status=CASE')) return { rows: [{ status: 'active' }] };
        if (sql.includes('SELECT id FROM routing_groups')) return { rows: [{ id: 2 }] };
        if (sql.includes('HAVING COUNT(DISTINCT am.account_id)>1')) return { rows: [{ model_code: 'shared-model', account_count: '2' }] };
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const data = new PostgresAdminCompatRepository({
      pool: { query: client.query.bind(client), connect: async () => client },
      secretBox: { activeVersion: 'v1', seal: () => 'unused' },
    });
    const actor = { id: 9, staffId: 77, role: 'admin' };

    await expect(data.setChannelStatus(7, 'active', actor)).resolves.toMatchObject({ status: 'active' });
    await expect(data.replaceRoutingGroupMembers(2, [
      { account_id: 7, weight: 100 }, { account_id: 8, weight: 100 },
    ], actor)).resolves.toHaveLength(2);
    expect(calls.some(call => call.sql.includes('HAVING COUNT(DISTINCT am.account_id)>1'))).toBe(false);
  });

  it('keeps group-dynamic API key permissions owned by the routing group', async () => {
    const calls = [];
    const client = {
      async query(sql, values = []) {
        calls.push({ sql, values });
        if (sql.includes('SELECT id,user_id,permission_mode FROM api_keys')) {
          return { rows: [{ id: 4, user_id: 3, permission_mode: 'group_dynamic' }] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const data = new PostgresAdminCompatRepository({
      pool: { query: client.query.bind(client), connect: async () => client },
      secretBox: { activeVersion: 'v1', seal: () => 'unused' },
    });

    await expect(data.updateKeyPermissions(4, ['model-a'], { staffId: 77 }))
      .rejects.toMatchObject({ status: 409, code: 'dynamic_key_permissions' });
    expect(calls.some(call => call.sql.includes('DELETE FROM api_key_permissions'))).toBe(false);
  });
});
