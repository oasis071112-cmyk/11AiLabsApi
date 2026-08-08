import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const adminRoutes = require('../src/routes/admin.js');

describe('管理端余额与订单安全边界', () => {
  let server;
  let baseUrl;
  let adminToken;
  let userId;

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const admin = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run('finance-admin', 'finance-admin@test.local', bcrypt.hashSync('safe-pass', 4), 'admin', 'active');
    const user = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run('finance-user', 'finance-user@test.local', bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    userId = user.lastInsertRowid;
    db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,0,0)').run(userId);
    adminToken = generateToken({ id: admin.lastInsertRowid, username: 'finance-admin', role: 'admin' });

    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    app.use((error, req, res, next) => {
      res.status(500).json({ error: error.message, stack: error.stack });
    });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (response.status === 500) throw new Error(await response.clone().text());
    return response;
  }

  function createOrder(status, amount = 10) {
    const suffix = `${Date.now()}-${Math.random()}`;
    return getDatabase().prepare(`INSERT INTO quota_orders
      (order_no,user_id,amount,payment_method,status) VALUES (?,?,?,'manual_transfer',?)`)
      .run(`TEST-${suffix}`, userId, amount, status).lastInsertRowid;
  }

  it('returns the settled user deduction in USD from legacy request-log snapshots', async () => {
    const requestId = `USD-LOG-${Date.now()}-${Math.random()}`;
    getDatabase().prepare(`INSERT INTO api_request_logs
      (request_id,user_id,model_code,total_cost,status,official_currency,usd_cny_rate)
      VALUES (?,?,'gpt-test',14,'success','USD',7)`).run(requestId, userId);

    const response = await request(`/api/admin/logs?user_id=${userId}&model=gpt-test&status=success&page=1`);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination).toMatchObject({ page: 1, limit: 50 });
    expect(payload.data.find((log) => log.request_id === requestId)).toMatchObject({
      total_cost: 14,
      user_deduction_usd: 2,
    });
  });

  it('summarizes every matching request log independently from the current page', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const insert = db.prepare(`INSERT INTO api_request_logs
      (request_id,user_id,model_code,upstream_channel_name,billing_mode,input_tokens,output_tokens,total_cost,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    insert.run(`OPS-A1-${suffix}`, userId, 'gpt-ops-a', 'channel-alpha', 'token', 100, 20, 1, 'success', '2026-08-07 01:10:00');
    insert.run(`OPS-A2-${suffix}`, userId, 'gpt-ops-a', 'channel-alpha', 'token', 200, 30, 2, 'success', '2026-08-07 01:40:00');
    insert.run(`OPS-A3-${suffix}`, userId, 'gpt-ops-a', 'channel-beta', 'token', 0, 0, 0, 'failed', '2026-08-07 02:10:00');
    insert.run(`OPS-B1-${suffix}`, userId, 'gpt-ops-b', 'channel-beta', 'token', 0, 0, 0, 'blocked', '2026-08-07 03:10:00');

    const query = new URLSearchParams({
      user_id: String(userId), start_at: '2026-08-07T00:00:00.000Z', end_at: '2026-08-08T00:00:00.000Z',
      dimension: 'model', bucket: 'hour', page: '1', limit: '1',
    });
    const response = await request(`/api/admin/logs?${query}`);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination).toMatchObject({ page: 1, limit: 1, total: 4 });
    expect(payload.data).toHaveLength(1);
    expect(payload.summary).toEqual({
      total_calls: 4,
      total_cost: 3,
      success_calls: 2,
      failed_calls: 1,
      blocked_calls: 1,
      pending_calls: 0,
      success_rate: 50,
    });
    expect(payload.trend).toEqual([
      expect.objectContaining({ label: '2026-08-07 09:00', success_calls: 2, failed_calls: 0, blocked_calls: 0 }),
      expect.objectContaining({ label: '2026-08-07 10:00', success_calls: 0, failed_calls: 1, blocked_calls: 0 }),
      expect.objectContaining({ label: '2026-08-07 11:00', success_calls: 0, failed_calls: 0, blocked_calls: 1 }),
    ]);
    expect(payload.ranking).toEqual([
      expect.objectContaining({ key: 'gpt-ops-a', label: 'gpt-ops-a', calls: 3, share: 75, total_cost: 3, success_rate: 66.67, failed_or_blocked_calls: 1 }),
      expect.objectContaining({ key: 'gpt-ops-b', label: 'gpt-ops-b', calls: 1, share: 25, total_cost: 0, success_rate: 0, failed_or_blocked_calls: 1 }),
    ]);
  });

  it('drills into request logs whose displayed channel is unavailable', async () => {
    const requestId = `OPS-NO-CHANNEL-${Date.now()}-${Math.random()}`;
    getDatabase().prepare(`INSERT INTO api_request_logs
      (request_id,user_id,model_code,total_cost,status,created_at)
      VALUES (?,?,?,0,'success','2026-08-07 04:10:00')`).run(requestId, userId, 'gpt-no-channel');
    const query = new URLSearchParams({
      user_id: String(userId), model: 'gpt-no-channel', channel: '__none__',
      start_at: '2026-08-07T00:00:00.000Z', end_at: '2026-08-08T00:00:00.000Z',
    });

    const response = await request(`/api/admin/logs?${query}`);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination.total).toBe(1);
    expect(payload.data[0]).toMatchObject({ request_id: requestId, upstream_channel_name: null });
  });

  it('returns raw log pages without rerunning operations aggregates', async () => {
    const response = await request(`/api/admin/logs?user_id=${userId}&include_summary=false&page=1&limit=1`);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toHaveLength(1);
    expect(payload.pagination).toMatchObject({ page: 1, limit: 1 });
    expect(payload).not.toHaveProperty('summary');
    expect(payload).not.toHaveProperty('trend');
    expect(payload).not.toHaveProperty('ranking');
  });

  it('drills into an exact channel object without fuzzy collisions', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const insert = db.prepare(`INSERT INTO api_request_logs
      (request_id,user_id,model_code,upstream_channel_id,upstream_channel_name,total_cost,status,created_at)
      VALUES (?,?,?,?,?,0,'success','2026-08-07 04:20:00')`);
    insert.run(`OPS-CHANNEL-7-${suffix}`, userId, 'gpt-channel-exact', 7, 'channel-7');
    insert.run(`OPS-CHANNEL-17-${suffix}`, userId, 'gpt-channel-exact', 17, 'channel-17');

    const query = new URLSearchParams({
      user_id: String(userId), model: 'gpt-channel-exact', channel_exact: 'id:7',
      start_at: '2026-08-07T00:00:00.000Z', end_at: '2026-08-08T00:00:00.000Z', include_summary: 'false',
    });
    const payload = await (await request(`/api/admin/logs?${query}`)).json();

    expect(payload.pagination.total).toBe(1);
    expect(payload.data[0]).toMatchObject({ upstream_channel_id: 7 });
  });

  it('存在待处理订单时，不允许无来源说明地手工增加额度', async () => {
    const db = getDatabase();
    const orderId = createOrder('pending', 10);
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;

    const response = await request(`/api/admin/users/${userId}/adjust-balance`, {
      method: 'POST',
      body: JSON.stringify({ amount: 10, type: 'manual_add', balance_type: 'recharge', remark: '手动入账' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PENDING_ORDER_CONFLICT' });
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance).toBe(before);
    expect(db.prepare('SELECT status FROM quota_orders WHERE id=?').get(orderId).status).toBe('pending');
  });

  it('管理员明确确认独立调账后允许入账，但不改变待处理订单', async () => {
    const db = getDatabase();
    const orderId = createOrder('pending', 15);
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;

    const response = await request(`/api/admin/users/${userId}/adjust-balance`, {
      method: 'POST',
      body: JSON.stringify({ amount: 15, type: 'manual_add', balance_type: 'recharge', remark: '独立补偿', allow_pending_order_conflict: true }),
    });

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance).toBe(before + 15);
    expect(db.prepare('SELECT status FROM quota_orders WHERE id=?').get(orderId).status).toBe('pending');
    const transaction = db.prepare("SELECT remark FROM wallet_transactions WHERE user_id=? AND transaction_type='manual_add' ORDER BY id DESC LIMIT 1").get(userId);
    expect(transaction.remark).toContain('已确认与待处理订单无关');
  });

  it('已发放筛选兼容前端 credited 状态码', async () => {
    const grantedId = createOrder('granted', 20);
    createOrder('pending', 30);

    const response = await request('/api/admin/recharge-orders?status=credited');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.map((order) => order.id)).toContain(grantedId);
    expect(payload.data.every((order) => order.status === 'granted')).toBe(true);
  });

  it('同一订单只能发放一次', async () => {
    const db = getDatabase();
    const orderId = createOrder('paid', 40);
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;

    const first = await request(`/api/admin/recharge-orders/${orderId}/confirm`, { method: 'PATCH' });
    const second = await request(`/api/admin/recharge-orders/${orderId}/confirm`, { method: 'PATCH' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance).toBe(before + 40);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM wallet_transactions
      WHERE related_order_id=? AND transaction_type='purchase'`).get(orderId).count).toBe(1);
  });

  it('人工确认不会发放尚未验签的在线支付订单', async () => {
    const db = getDatabase();
    const providerId = db.prepare(`INSERT INTO payment_providers
      (provider_type,provider_name,api_base_url,merchant_id,merchant_key_encrypted,status)
      VALUES ('easypay','guard','https://pay.example.test','guard-pid','encrypted','active')`).run().lastInsertRowid;
    const orderId = db.prepare(`INSERT INTO quota_orders
      (order_no,user_id,amount,payment_method,status,payment_provider_id) VALUES (?,?,?,'easypay','pending',?)`)
      .run(`ONLINE-${Date.now()}-${Math.random()}`, userId, 33, providerId).lastInsertRowid;
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    const response = await request(`/api/admin/recharge-orders/${orderId}/confirm`, { method: 'PATCH' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ONLINE_ORDER_CALLBACK_REQUIRED' });
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance).toBe(before);
  });
});
