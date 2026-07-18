import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const userRoutes = require('../src/routes/user.js');
const paymentRoutes = require('../src/routes/payment.js');
const { encrypt } = require('../src/utils/crypto.js');

function signEasyPay(fields, key) {
  const payload = Object.entries(fields)
    .filter(([name, value]) => name !== 'sign' && name !== 'sign_type' && value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  return crypto.createHash('md5').update(`${payload}${key}`).digest('hex');
}

describe('易支付自动到账', () => {
  let server;
  let baseUrl;
  let userId;
  let userToken;
  const merchantKey = 'payment-test-key';

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const user = db.prepare('INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)')
      .run(`payment-user-${Date.now()}`, `payment-${Date.now()}@test.local`, bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    userId = user.lastInsertRowid;
    db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,0,0)').run(userId);
    userToken = generateToken({ id: userId, username: 'payment-user', role: 'user' });
    db.prepare(`INSERT INTO payment_providers
      (provider_type,provider_name,api_base_url,merchant_id,merchant_key_encrypted,status)
      VALUES ('easypay','测试易支付','https://pay.example.test','10001',?,'active')`).run(encrypt(merchantKey));
    db.prepare("INSERT OR REPLACE INTO system_config (config_key,config_value,description) VALUES ('payment_enabled','true','是否启用在线支付')").run();
    db.prepare("INSERT OR REPLACE INTO system_config (config_key,config_value,description) VALUES ('payment_site_url','https://11ailabs.example','支付回调站点地址')").run();

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/user', userRoutes);
    app.use('/api/payment', paymentRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

  async function createOrder(amount = 10) {
    const response = await fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, payment_method: 'alipay' }),
    });
    expect(response.status).toBe(201);
    return response.json();
  }

  function callbackFields(order, overrides = {}) {
    const fields = {
      pid: '10001', out_trade_no: order.order_no, trade_no: `UP-${order.order_no}`,
      trade_status: 'TRADE_SUCCESS', money: order.amount.toFixed(2), type: 'alipay', ...overrides,
    };
    return { ...fields, sign: signEasyPay(fields, merchantKey), sign_type: 'MD5', ...overrides };
  }

  it('用户创建支付订单后可获得服务器生成的易支付请求', async () => {
    const order = await createOrder();
    expect(order).toMatchObject({ amount: 10, payment_method: 'alipay' });
    expect(order.payment_request).toMatchObject({ method: 'POST', action: 'https://pay.example.test/submit.php' });
    expect(order.payment_request.fields).toMatchObject({ pid: '10001', type: 'alipay', money: '10.00' });
    expect(order.payment_request.fields.notify_url).toBe('https://11ailabs.example/api/payment/easypay/notify');
  });

  it('验签成功的回调只会自动入账一次', async () => {
    const order = await createOrder(12);
    const fields = callbackFields(order);
    const first = await fetch(`${baseUrl}/api/payment/easypay/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    const repeated = await fetch(`${baseUrl}/api/payment/easypay/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    expect(await first.text()).toBe('success');
    expect(await repeated.text()).toBe('success');
    const db = getDatabase();
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance).toBe(12);
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_transactions WHERE related_order_id=(SELECT id FROM quota_orders WHERE order_no=?) AND transaction_type='purchase'").get(order.order_no).count).toBe(1);
  });

  it('回调金额被篡改时拒绝入账', async () => {
    const order = await createOrder(18);
    const response = await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callbackFields(order, { money: '0.01' })),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('fail');
    expect(getDatabase().prepare('SELECT status FROM quota_orders WHERE order_no=?').get(order.order_no).status).toBe('pending');
  });

  it('回调签名无效时拒绝入账', async () => {
    const order = await createOrder(20);
    const fields = callbackFields(order, { sign: 'not-a-valid-signature' });
    const response = await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('fail');
    expect(getDatabase().prepare('SELECT status FROM quota_orders WHERE order_no=?').get(order.order_no).status).toBe('pending');
  });
});
