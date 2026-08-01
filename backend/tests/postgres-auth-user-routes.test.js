import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresIdentity } = require('../src/modules/identity/index.js');
const { createPostgresAuthRouter } = require('../src/routes/postgres-auth.js');
const { buildChannelProtocolDocs, createPostgresUserRouter, effectiveModelCapabilities } = require('../src/routes/postgres-user.js');

class MemoryUserPool {
  constructor() {
    this.users = [];
    this.staff = [];
    this.wallets = new Map();
    this.keys = [];
    this.transactions = [];
    this.nextUserId = 1;
    this.nextKeyId = 1;
    this.queries = [];
    this.config = new Map([
      ['registration_enabled', true],
      ['new_user_gift_enabled', false],
      ['new_user_gift_amount', 0],
    ]);
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }

  async query(sql, values = []) {
    this.queries.push({ sql, values });
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(compact)) return { rows: [] };
    if (compact.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
    if (compact.includes('FROM system_config') && compact.includes('config_key = ANY')) {
      return { rows: values[0].filter(key => this.config.has(key)).map(key => ({ config_key: key, config_value: this.config.get(key) })) };
    }
    if (compact.includes('FROM system_config')) {
      return { rows: this.config.has(values[0]) ? [{ config_value: this.config.get(values[0]) }] : [] };
    }
    if (compact.includes('SELECT id FROM users WHERE username=$1 OR email=$2')) {
      return { rows: this.users.filter(user => user.username === values[0] || user.email === values[1]).map(user => ({ id: user.id })) };
    }
    if (compact.includes('SELECT id FROM staff_users WHERE username=$1 OR email=$2')) {
      return { rows: this.staff.filter(user => user.username === values[0] || user.email === values[1]).map(user => ({ id: user.id })) };
    }
    if (compact.includes('INSERT INTO users')) {
      const user = { id: this.nextUserId++, username: values[0], email: values[1], password_hash: values[2], role: 'user', status: 'active' };
      this.users.push(user);
      return { rows: [user] };
    }
    if (compact.includes('INSERT INTO wallets')) {
      this.wallets.set(values[0], { user_id: values[0], quota_balance: 0, gift_quota: Number(values[1] || 0), frozen_balance: 0, total_spent: 0 });
      return { rows: [this.wallets.get(values[0])] };
    }
    if (compact.includes('INSERT INTO wallet_transactions')) {
      this.transactions.push({ transaction_key: values[0], user_id: values[1], amount: Number(values[2]), balance_after: Number(values[3]) });
      return { rows: [] };
    }
    if (compact.includes('FROM users WHERE username=$1 OR email=$1')) {
      return { rows: this.users.filter(user => user.username === values[0] || user.email === values[0]) };
    }
    if (compact.includes('FROM staff_users WHERE username=$1 OR email=$1')) {
      return { rows: this.staff.filter(user => user.username === values[0] || user.email === values[0]) };
    }
    if (compact.includes('FROM staff_users WHERE id=$1')) {
      return { rows: this.staff.filter(user => String(user.id) === String(values[0])) };
    }
    if (compact === 'SELECT id,username,role,status FROM users WHERE id=$1') {
      return { rows: this.users.filter(user => String(user.id) === String(values[0])) };
    }
    if (compact.includes('FROM users WHERE id=$1') && compact.includes('register_time')) {
      return { rows: this.users.filter(user => String(user.id) === String(values[0])) };
    }
    if (compact === 'SELECT password_hash FROM users WHERE id=$1') {
      return { rows: this.users.filter(user => String(user.id) === String(values[0])) };
    }
    if (compact.includes('UPDATE users SET updated_at=CURRENT_TIMESTAMP')) return { rows: [] };
    if (compact.includes('UPDATE staff_users SET updated_at=CURRENT_TIMESTAMP')) return { rows: [] };
    if (compact.startsWith('UPDATE users SET password_hash=$1,updated_at=CURRENT_TIMESTAMP')) {
      const user = this.users.find(item => String(item.id) === String(values[1]));
      user.password_hash = values[0];
      return { rows: [] };
    }
    if (compact.startsWith('UPDATE staff_users SET password_hash=$1,updated_at=CURRENT_TIMESTAMP')) {
      const user = this.staff.find(item => String(item.id) === String(values[1]));
      user.password_hash = values[0];
      return { rows: [] };
    }
    if (compact.includes('FROM wallets WHERE user_id=$1')) return { rows: [this.wallets.get(values[0])].filter(Boolean) };
    if (compact.includes('SELECT id,group_name FROM routing_groups')) return { rows: [{ id: values[0], group_name: '测试分组' }] };
    if (compact.includes('INSERT INTO api_keys')) {
      const key = { id: this.nextKeyId++, user_id: values[0], key_name: values[1], key_hash: values[2], key_prefix: values[3], key_envelope: null, routing_group_id: values[4], status: 'active' };
      this.keys.push(key);
      return { rows: [{ id: key.id }] };
    }
    if (compact.startsWith('UPDATE api_keys SET key_envelope=$1')) {
      const key = this.keys.find(item => item.id === values[1]);
      key.key_envelope = values[0];
      return { rows: [] };
    }
    if (compact.includes('INSERT INTO api_key_permissions')) return { rows: [] };
    if (compact.includes('SELECT id,key_envelope FROM api_keys')) {
      return { rows: this.keys.filter(key => String(key.id) === String(values[0]) && String(key.user_id) === String(values[1])) };
    }
    if (compact.startsWith('SELECT status FROM api_keys WHERE id=$1 AND user_id=$2 FOR UPDATE')) {
      return { rows: this.keys.filter(key => String(key.id) === String(values[0]) && String(key.user_id) === String(values[1])).map(key => ({ status: key.status })) };
    }
    if (compact.startsWith('UPDATE api_keys SET status=$1 WHERE id=$2 AND user_id=$3')) {
      const key = this.keys.find(item => String(item.id) === String(values[1]) && String(item.user_id) === String(values[2]));
      if (key) key.status = values[0];
      return { rows: [] };
    }
    if (compact.includes('FROM api_keys ak JOIN users u')) {
      const rows = this.keys.filter(key => key.key_prefix === values[0] && key.status === 'active').map(key => ({ ...key, user_status: 'active' }));
      return { rows };
    }
    if (compact.startsWith('SELECT id,transaction_key')) {
      return { rows: [{ id: '1', transaction_key: 'tx-1', transaction_type: 'manual_add', amount: '2.5', created_at: '2026-08-01T00:00:00.000Z' }] };
    }
    if (compact.startsWith('SELECT COUNT(*) AS count FROM wallet_transactions')) return { rows: [{ count: '1' }] };
    if (compact.includes('BOOL_OR(am.supports_image_input)')) {
      return { rows: [{ key_id: 1, routing_group_id: 7, permission_mode: 'group_dynamic', group_name: '测试分组', description: '', billing_multiplier_input: '1', billing_multiplier_output: '1', billing_multiplier_image: '1', model_code: 'model-a', model_name: 'Model A', model_type: 'llm', sort_order: 1, supports_image_input: true, protocol_types: ['openai_compatible'] }] };
    }
    if (compact.startsWith('SELECT EXISTS(SELECT 1 FROM api_keys')) return { rows: [{ has_api_keys: true }] };
    if (compact.startsWith('SELECT rg.id,rg.group_name AS channel_name')) {
      return { rows: [{ id: 7, channel_name: '测试分组', protocol_type: 'openai_compatible', model_count: '1' }] };
    }
    if (compact.startsWith('SELECT request_id,api_key_id,model_code')) {
      return { rows: [{ request_id: 'req-1', model_code: 'model-a', input_tokens: '10', output_tokens: '20', total_cost: '0.5', status: 'success', created_at: '2026-08-01T00:00:00.000Z' }] };
    }
    if (compact.startsWith('SELECT request_id,model_code,billing_mode')) {
      return { rows: [{
        request_id: '=2+2', model_code: '@unsafe-model', billing_mode: 'token', input_tokens: '10',
        output_tokens: '20', output_items: '0', total_cost: '0.5', status: 'success', latency_ms: '12',
        operation: 'chat_completions', final_size: null, output_format: null, error_type: null,
        error_message: null, created_at: '2026-08-01T00:00:00.000Z',
      }] };
    }
    if (compact.startsWith('SELECT COUNT(*) AS count FROM api_request_logs')) return { rows: [{ count: '1' }] };
    if (compact.startsWith("SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS date")) {
      return { rows: [{ date: '2026-08-01', calls: '1', cost: '0.5', input_tokens: '10', output_tokens: '20' }] };
    }
    if (compact.startsWith('SELECT usage_date AS date')) {
      return { rows: [{ date: '2026-08-01', calls: '1', cost: '0.5', input_tokens: '10', output_tokens: '20' }] };
    }
    if (compact.startsWith('SELECT COALESCE(SUM(request_count),0) AS total_calls')) {
      return { rows: [{ total_calls: '1', input_tokens: '10', output_tokens: '20', total_consumption: '0.5', today_calls: '1', today_consumption: '0.5', model_usage: [], today_status: [{ status: 'success', count: 1 }] }] };
    }
    throw new Error(`未实现的测试 SQL: ${compact}`);
  }
}

describe('PostgreSQL 用户面兼容路由', () => {
  let server;
  let baseUrl;
  let pool;
  let identity;
  let secretBox;

  beforeAll(async () => {
    pool = new MemoryUserPool();
    secretBox = { seal: vi.fn((value, { aad }) => `sealed:${aad}:${value}`), open: vi.fn((value, { aad }) => value.replace(`sealed:${aad}:`, '')) };
    identity = createPostgresIdentity({ pool, jwtSecret: 'postgres-user-route-test-secret!!', secretBox });
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createPostgresAuthRouter({ pool, identity }));
    app.use('/api/user', createPostgresUserRouter({ pool, identity, secretBox }));
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('注册在一个事务内创建 PostgreSQL 用户和空钱包，并返回兼容登录响应', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'safe-pass-123' }),
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({ message: '注册成功，登录中...', gift_amount: 0, user: { username: 'pg-user', role: 'user', email: null } });
    expect(payload.token).toBeTruthy();
    expect(pool.wallets.get(payload.user.id)).toMatchObject({ quota_balance: 0, gift_quota: 0, frozen_balance: 0 });
    expect(pool.queries.map(item => item.sql.trim())).toContain('BEGIN');
    expect(pool.queries.map(item => item.sql.trim())).toContain('COMMIT');
    expect(pool.queries.every(item => Array.isArray(item.values))).toBe(true);
  });

  it('注册赠送开启时把配置金额写入赠送余额并返回真实赠送额', async () => {
    pool.config.set('new_user_gift_enabled', true);
    pool.config.set('new_user_gift_amount', 1);
    try {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'gift-user', password: 'safe-pass-123' }),
      });
      expect(response.status).toBe(201);
      const payload = await response.json();
      expect(payload.gift_amount).toBe(1);
      expect(pool.wallets.get(payload.user.id).gift_quota).toBe(1);
      expect(pool.transactions).toContainEqual(expect.objectContaining({
        transaction_key: `registration-gift:${payload.user.id}`, user_id: payload.user.id, amount: 1, balance_after: 1,
      }));
    } finally {
      pool.config.set('new_user_gift_enabled', false);
      pool.config.set('new_user_gift_amount', 0);
    }
  });

  it('rejects registration when the username is already reserved by a staff account', async () => {
    const staff = {
      id: 87,
      username: 'reserved-staff',
      email: 'reserved-staff@example.test',
      password_hash: 'unused-in-registration',
      role: 'operator',
      status: 'active',
    };
    pool.staff.push(staff);

    try {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'reserved-staff', password: 'safe-pass-123' }),
      });

      expect(response.status).toBe(409);
      expect(pool.users.some(user => user.username === 'reserved-staff')).toBe(false);
    } finally {
      pool.staff.splice(pool.staff.indexOf(staff), 1);
    }
  });

  it('已登录用户可读取兼容钱包，且支付选项默认关闭', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'safe-pass-123' }),
    });
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const wallet = await fetch(`${baseUrl}/api/user/wallet`, { headers });
    expect(wallet.status).toBe(200);
    expect(await wallet.json()).toEqual({ quota_balance: 0, gift_quota: 0, frozen_balance: 0, total_balance: 0, total_spent: 0 });

    const paymentOptions = await fetch(`${baseUrl}/api/user/payment-options`, { headers });
    expect(paymentOptions.status).toBe(200);
    expect(await paymentOptions.json()).toEqual({ enabled: false, methods: [], minimum: 1, maximum: 10000 });

    const channels = await fetch(`${baseUrl}/api/user/channels`, { headers });
    expect(channels.status).toBe(200);
    expect((await channels.json()).data).toMatchObject([{ id: 7, channel_name: '测试分组', model_count: 1 }]);
  });

  it('创建 Key 仅保存 bcrypt hash 与 AAD 绑定密文，导出只能成功一次', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'safe-pass-123' }),
    });
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const create = await fetch(`${baseUrl}/api/user/keys`, {
      method: 'POST', headers, body: JSON.stringify({ key_name: 'Postgres key', routing_group_id: 7 }),
    });

    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.key.key_raw).toMatch(/^sk-/);
    expect(pool.keys[0].key_hash).not.toBe(created.key.key_raw);
    expect(await identity.bcrypt.compare(created.key.key_raw, pool.keys[0].key_hash)).toBe(true);
    expect(await identity.findApiKey(created.key.key_raw)).toMatchObject({ id: created.key.id, user_id: 1 });
    await expect(identity.findApiKey(`${created.key.key_raw}wrong`)).resolves.toBeNull();
    expect(secretBox.seal).toHaveBeenCalledWith(created.key.key_raw, { aad: `api_keys:${pool.keys[0].id}` });

    const exported = await fetch(`${baseUrl}/api/user/keys/${created.key.id}/export`, { method: 'POST', headers });
    expect(exported.status).toBe(200);
    expect(await exported.json()).toEqual({ key_raw: created.key.key_raw });
    expect(secretBox.open).toHaveBeenCalledWith(expect.any(String), { aad: `api_keys:${pool.keys[0].id}` });
    expect((await fetch(`${baseUrl}/api/user/keys/${created.key.id}/export`, { method: 'POST', headers })).status).toBe(200);
  });

  it('永久撤销的用户 API Key 不能通过 toggle 重新启用', async () => {
    const user = pool.users.find(item => item.username === 'pg-user');
    const key = pool.keys.find(item => item.user_id === user.id);
    key.status = 'revoked';
    const token = identity.generateToken(user);

    const response = await fetch(`${baseUrl}/api/user/keys/${key.id}/toggle`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '已撤销的 API Key 不能重新启用' });
    expect(key.status).toBe('revoked');
  });

  it('只为显式声明的聊天模型生成 Chat 文档，并为图片模型生成 Images 文档', () => {
    const docs = buildChannelProtocolDocs({
      baseUrl: 'https://example.test', channelName: '图片分组', keyPrefix: 'sk-test',
      protocolTypes: ['openai_compatible'],
      models: [
        { model_code: 'image2', capabilities: { image_generations: true, image_edits: true } },
        { model_code: 'chat', capabilities: { chat_completions: true } },
        { model_code: 'undeclared', capabilities: {} },
      ],
    });

    expect(docs).toHaveLength(2);
    expect(docs.find(item => item.protocol_type === 'openai').models.map(model => model.model_code)).toEqual(['chat']);
    expect(docs.find(item => item.protocol_type === 'openai_images')).toMatchObject({
      endpoint: '/v1/images/generations', additional_endpoints: ['/v1/images/edits'],
      models: [{ model_code: 'image2' }],
    });
    expect(JSON.stringify(docs)).not.toContain('undeclared');
  });

  it('模型映射未开放图片输入时不发布图片编辑能力', () => {
    expect(effectiveModelCapabilities({
      capabilities: {}, supports_image_input: false,
      interface_capability_sets: [['image_generations']],
      account_capability_sets: [['image_generations', 'image_edits']],
    })).toMatchObject({ image_generations: true, image_edits: false });
  });

  it('authenticates an imported staff account without copying it into ordinary users', async () => {
    pool.staff.push({
      id: 88,
      username: 'pg-admin',
      email: 'admin@example.test',
      password_hash: await identity.bcrypt.hash('staff-safe-pass', 10),
      role: 'admin',
      status: 'active',
    });

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-admin', password: 'staff-safe-pass' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.user).toMatchObject({ id: 88, username: 'pg-admin', role: 'admin' });
    expect(pool.users.some(user => user.username === 'pg-admin')).toBe(false);
    const userWallet = await fetch(`${baseUrl}/api/user/wallet`, {
      headers: { Authorization: `Bearer ${payload.token}` },
    });
    expect(userWallet.status).toBe(403);
  });

  it('rejects an old staff JWT after the account is disabled', async () => {
    const staff = {
      id: 89,
      username: 'jwt-admin',
      email: 'jwt-admin@example.test',
      password_hash: await identity.bcrypt.hash('jwt-safe-pass', 10),
      role: 'admin',
      status: 'active',
    };
    pool.staff.push(staff);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jwt-admin', password: 'jwt-safe-pass' }),
    });
    const { token } = await login.json();

    staff.status = 'disabled';
    try {
      const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      expect(me.status).toBe(401);
    } finally {
      pool.staff.splice(pool.staff.indexOf(staff), 1);
    }
  });

  it('用户读取面提供事务、模型、分组、日志与统计，并将筛选值参数化', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'safe-pass-123' }),
    });
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    const injectedModel = "model-a' OR 1=1 --";
    const [transactions, models, channels, logs, daily, stats] = await Promise.all([
      fetch(`${baseUrl}/api/user/transactions`, { headers }),
      fetch(`${baseUrl}/api/user/models`, { headers }),
      fetch(`${baseUrl}/api/user/channels`, { headers }),
      fetch(`${baseUrl}/api/user/logs?model=${encodeURIComponent(injectedModel)}&start_date=2026-08-01&end_date=2026-08-01`, { headers }),
      fetch(`${baseUrl}/api/user/stats/daily?start_date=2026-08-01&end_date=2026-08-01`, { headers }),
      fetch(`${baseUrl}/api/user/stats`, { headers }),
    ]);

    expect((await transactions.json()).pagination).toEqual({ page: 1, limit: 20, total: 1 });
    const modelPayload = await models.json();
    expect(modelPayload.data).toMatchObject([{ model_code: 'model-a', is_multimodal: true }]);
    expect(modelPayload.groups).toMatchObject([{ id: 7, group_name: '测试分组', models: [{ model_code: 'model-a' }] }]);
    expect((await channels.json()).data).toMatchObject([{ channel_name: '测试分组', model_count: 1 }]);
    expect((await logs.json()).pagination).toEqual({ page: 1, limit: 20, total: 1 });
    expect((await daily.json()).data).toEqual([{ date: '2026-08-01', calls: 1, cost: 0.5, input_tokens: 10, output_tokens: 20 }]);
    expect(await stats.json()).toMatchObject({ total_calls: 1, today_calls: 1, total_consumption: 0.5 });

    const logQuery = pool.queries.find(item => item.sql.includes('FROM api_request_logs WHERE') && item.values.includes(injectedModel));
    expect(logQuery).toBeTruthy();
    expect(logQuery.sql).not.toContain(injectedModel);
    expect(logQuery.values[0]).toBe(1);
    const dailyQuery = pool.queries.find(item => item.sql.includes('SELECT usage_date AS date'));
    expect(dailyQuery.sql).toContain('FROM user_daily_usage');
    expect(dailyQuery.sql).not.toContain('api_request_logs');

    const keyDaily = await fetch(`${baseUrl}/api/user/stats/daily?start_date=2026-08-01&end_date=2026-08-01&key_id=1`, { headers });
    expect(keyDaily.status).toBe(200);
    const keyDailyQuery = pool.queries.find(item => item.sql.includes('FROM user_api_key_daily_usage'));
    expect(keyDailyQuery.values).toEqual([1, '2026-08-01', '2026-08-01', '1']);
  });

  it('日志 CSV 导出要求受限日期范围、参数化查询并防止表格公式注入', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'safe-pass-123' }),
    });
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const missingDates = await fetch(`${baseUrl}/api/user/logs/export`, { headers });
    expect(missingDates.status).toBe(400);

    const exported = await fetch(`${baseUrl}/api/user/logs/export?start_date=2026-08-01&end_date=2026-08-01`, { headers });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('text/csv');
    expect(exported.headers.get('content-disposition')).toContain('logs_2026-08-01_2026-08-01.csv');
    const bytes = Buffer.from(await exported.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const csv = bytes.toString('utf8');
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'@unsafe-model");
    const query = pool.queries.find(item => item.sql.includes('SELECT request_id,model_code,billing_mode'));
    expect(query.values).toEqual([1, '2026-08-01', '2026-08-01', 100001]);
    expect(query.sql).not.toContain('2026-08-01');
  });

  it('认证工厂提供 me 与密码更新，并让新密码立即可登录', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'safe-pass-123' }),
    });
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { id: 1, username: 'pg-user' }, wallet: { total_spent: 0 } });

    const password = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'PUT', headers, body: JSON.stringify({ oldPassword: 'safe-pass-123', newPassword: 'new-safe-pass-123' }),
    });
    expect(password.status).toBe(200);
    expect((await password.json()).message).toBe('密码修改成功');
    const relogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pg-user', password: 'new-safe-pass-123' }),
    });
    expect(relogin.status).toBe(200);
  });
});
