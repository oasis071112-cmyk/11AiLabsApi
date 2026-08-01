import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createPostgresUserRouter } = require('../src/routes/postgres-user.js');
const { createPostgresPaymentService } = require('../src/modules/postgres-payment/index.js');
const { createPostgresPaymentRouter } = require('../src/routes/postgres-payment.js');

class PaymentOptionsPool {
  constructor() {
    this.config = new Map([
      ['payment_enabled', false],
      ['payment_min_amount', '2.50'],
      ['payment_max_amount', '500.00'],
    ]);
    this.providers = [{
      id: 9,
      provider_code: 'ep-main',
      provider_type: 'easypay',
      status: 'active',
      config: {
        api_base_url: 'https://pay.example.test/', merchant_id: '10001',
        enabled_methods: ['alipay', 'wechat'], alipay_type: 'alipay', wechat_type: 'wxpay',
      },
      secret_envelope: 'sealed:payment_providers:ep-main:merchant-secret',
    }];
    this.orders = [];
    this.nextOrderId = 1;
    this.wallets = new Map([[42, { user_id: 42, quota_balance: '0.00', gift_quota: '0.00', frozen_balance: '0.00' }]]);
    this.transactions = [];
    this.transactionSnapshot = null;
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }

  async query(sql, values = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (/^BEGIN$/i.test(compact)) {
      this.transactionSnapshot = {
        orders: this.orders.map(order => ({ ...order })),
        wallets: new Map([...this.wallets].map(([key, wallet]) => [key, { ...wallet }])),
        transactions: this.transactions.map(transaction => ({ ...transaction })),
        nextOrderId: this.nextOrderId,
      };
      return { rows: [] };
    }
    if (/^COMMIT$/i.test(compact)) {
      this.transactionSnapshot = null;
      return { rows: [] };
    }
    if (/^ROLLBACK$/i.test(compact)) {
      if (this.transactionSnapshot) {
        this.orders.splice(0, this.orders.length, ...this.transactionSnapshot.orders);
        this.wallets = this.transactionSnapshot.wallets;
        this.transactions.splice(0, this.transactions.length, ...this.transactionSnapshot.transactions);
        this.nextOrderId = this.transactionSnapshot.nextOrderId;
      }
      this.transactionSnapshot = null;
      return { rows: [] };
    }
    if (compact.includes('FROM system_config') && compact.includes('config_key')) {
      return { rows: [...this.config.entries()].map(([config_key, config_value]) => ({ config_key, config_value })) };
    }
    if (compact.includes('FROM payment_providers') && compact.includes("status='active'")) {
      return { rows: this.providers.filter(provider => provider.status === 'active' && provider.provider_type === 'easypay') };
    }
    if (compact.startsWith("UPDATE quota_orders SET status='expired'")) {
      for (const order of this.orders) {
        const matches = compact.includes('WHERE user_id=$1')
          ? String(order.user_id) === String(values[0])
          : String(order.id) === String(values[0]);
        if (matches && order.status === 'pending' && new Date(order.expires_at).getTime() <= Date.now()) order.status = 'expired';
      }
      return { rows: [] };
    }
    if (compact.startsWith('SELECT COUNT(*) AS count FROM quota_orders') && compact.includes('payment_provider_id=$2')) {
      return { rows: [{ count: String(this.orders.filter(order => String(order.user_id) === String(values[0])
        && String(order.payment_provider_id) === String(values[1]) && order.status === 'pending'
        && new Date(order.expires_at).getTime() > Date.now()).length) }] };
    }
    if (compact.startsWith('INSERT INTO quota_orders')) {
      const online = compact.includes('payment_provider_id');
      const order = {
        id: this.nextOrderId++, order_key: values[0], order_no: values[1], user_id: values[2], amount: values[3],
        payment_provider_id: online ? values[4] : null, payment_method: online ? values[5] : values[4],
        status: 'pending', expires_at: online ? values[6] : null, created_at: '2026-08-01T00:00:00.000Z',
      };
      this.orders.push(order);
      return { rows: [order] };
    }
    if (compact.startsWith('SELECT id,order_key,amount,status,expires_at,paid_at,granted_at,payment_method FROM quota_orders')) {
      return { rows: this.orders.filter(order => String(order.order_key) === String(values[0]) && String(order.user_id) === String(values[1])) };
    }
    if (compact.startsWith('SELECT id,order_key,user_id,amount,status,expires_at,payment_provider_id,provider_trade_no FROM quota_orders')) {
      return { rows: this.orders.filter(order => String(order.order_key) === String(values[0])) };
    }
    if (compact.startsWith('SELECT id,order_key AS order_no,user_id,amount,payment_method,status,created_at,paid_at, granted_at AS credited_at FROM quota_orders')) {
      const limit = Number(values[1]);
      const offset = Number(values[2]);
      return { rows: this.orders.filter(order => String(order.user_id) === String(values[0])).slice(offset, offset + limit)
        .map(order => ({ ...order, order_no: order.order_key })) };
    }
    if (compact.startsWith('SELECT COUNT(*) AS count FROM quota_orders WHERE user_id=$1')) {
      return { rows: [{ count: String(this.orders.filter(order => String(order.user_id) === String(values[0])).length) }] };
    }
    if (compact.startsWith('SELECT id,provider_code,provider_type,config,secret_envelope,status FROM payment_providers WHERE id=$1')) {
      return { rows: this.providers.filter(provider => String(provider.id) === String(values[0]) && provider.provider_type === 'easypay') };
    }
    if (compact.startsWith("SELECT id FROM wallet_transactions WHERE related_order_id=$1 AND transaction_type='purchase'")) {
      return { rows: this.transactions.filter(transaction => String(transaction.related_order_id) === String(values[0]) && transaction.transaction_type === 'purchase') };
    }
    if (compact.startsWith('SELECT user_id,quota_balance FROM wallets WHERE user_id=$1 FOR UPDATE')) {
      return { rows: [this.wallets.get(values[0])].filter(Boolean) };
    }
    if (compact.startsWith('SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE')) {
      return { rows: [this.wallets.get(values[0])].filter(Boolean) };
    }
    if (compact.startsWith('UPDATE wallets SET quota_balance=quota_balance+$1')) {
      const wallet = this.wallets.get(values[1]);
      wallet.quota_balance = (Number(wallet.quota_balance) + Number(values[0])).toFixed(6);
      return { rows: [{ quota_balance: wallet.quota_balance }] };
    }
    if (compact.startsWith('INSERT INTO wallet_transactions')) {
      this.transactions.push({
        id: this.transactions.length + 1, transaction_key: values[0], user_id: values[1], transaction_type: 'purchase',
        amount: values[2], related_order_id: values[6],
      });
      return { rows: [] };
    }
    if (compact.startsWith("UPDATE quota_orders SET status='granted'")) {
      const order = this.orders.find(item => String(item.id) === String(values.length === 1 ? values[0] : values[3]));
      order.status = 'granted';
      if (values.length > 1) {
        order.provider_trade_no = values[0];
        order.paid_amount = values[1];
        order.payment_channel = values[2];
      }
      return { rows: [order] };
    }
    throw new Error(`未实现的支付测试 SQL: ${compact}; ${JSON.stringify(values)}`);
  }
}

describe('PostgreSQL 支付用户接口', () => {
  let server;
  let baseUrl;
  let pool;
  let secretBox;
  let paymentService;

  beforeAll(async () => {
    pool = new PaymentOptionsPool();
    const identity = {
      authenticate(req, _res, next) { req.user = { id: 42, role: 'user' }; next(); },
      bcrypt: {},
      sealApiKey() {},
      openApiKey() {},
    };
    secretBox = {
      seal() {},
      open: vi.fn((value, { aad }) => value.replace(`sealed:${aad}:`, '')),
    };
    paymentService = createPostgresPaymentService({ pool, secretBox, siteUrl: 'https://console.example.test' });
    const app = express();
    app.use(express.json());
    app.use('/api/user', createPostgresUserRouter({ pool, identity, secretBox, paymentService }));
    app.use('/api/payment', createPostgresPaymentRouter({ paymentService }));
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('支付选项动态读取总开关与活跃服务商，并默认关闭', async () => {
    const disabled = await fetch(`${baseUrl}/api/user/payment-options`);
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ enabled: false, methods: [], minimum: 2.5, maximum: 500 });

    pool.config.set('payment_enabled', true);
    const enabled = await fetch(`${baseUrl}/api/user/payment-options`);
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ enabled: true, methods: ['alipay', 'wechat'], minimum: 2.5, maximum: 500 });
  });

  it('创建在线支付订单时精确校验金额，并以 AAD 解封服务商密钥', async () => {
    const invalid = await fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '12.301', payment_method: 'alipay' }),
    });
    expect(invalid.status).toBe(400);

    const created = await fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '12.30', payment_method: 'alipay' }),
    });
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload).toMatchObject({
      amount: 12.3,
      payment_method: 'alipay',
      payment_request: { method: 'POST', action: 'https://pay.example.test/submit.php', fields: { pid: '10001', type: 'alipay', money: '12.30', sign_type: 'MD5' } },
    });
    expect(payload.order_no).toMatch(/^EP/);
    expect(JSON.stringify(payload)).not.toContain('merchant-secret');
    expect(secretBox.open).toHaveBeenCalledWith(pool.providers[0].secret_envelope, { aad: 'payment_providers:ep-main' });
  });

  it('未显式配置公开 HTTPS 回调地址时拒绝创建在线支付订单', async () => {
    const withoutSiteUrl = createPostgresPaymentService({ pool, secretBox });
    await expect(withoutSiteUrl.createPaymentOrder({ userId: 42, amount: '12.30', paymentMethod: 'alipay' }))
      .rejects.toMatchObject({ status: 409, code: 'payment_site_url_invalid' });
  });

  it('限制 pending 订单、清理过期订单，并仅向订单本人提供查询结果', async () => {
    pool.orders.length = 0;
    pool.config.set('payment_pending_limit', 1);
    const create = () => fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '10.00', payment_method: 'wechat' }),
    });

    const first = await create();
    expect(first.status).toBe(201);
    const firstPayload = await first.json();
    expect((await create()).status).toBe(429);

    pool.orders[0].expires_at = new Date(Date.now() - 1_000);
    const expiredQuery = await fetch(`${baseUrl}/api/user/payment-orders/${firstPayload.order_no}`);
    expect(expiredQuery.status).toBe(200);
    expect(await expiredQuery.json()).toMatchObject({ data: { order_no: firstPayload.order_no, status: 'expired' } });

    const afterExpiry = await create();
    expect(afterExpiry.status).toBe(201);

    const query = await fetch(`${baseUrl}/api/user/payment-orders/${firstPayload.order_no}`);
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({ data: { order_no: firstPayload.order_no, status: 'expired', amount: 10 } });
  });

  it('GET/POST 回调验签后只为同一订单入账一次', async () => {
    pool.orders.length = 0;
    pool.transactions.length = 0;
    pool.wallets.get(42).quota_balance = '0.00';
    pool.config.set('payment_pending_limit', 5);
    const created = await fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '12.30', payment_method: 'alipay' }),
    });
    const { order_no: orderNo } = await created.json();
    const callback = {
      pid: '10001', type: 'alipay', out_trade_no: orderNo, trade_status: 'TRADE_SUCCESS', trade_no: 'trade-1001', money: '12.30',
    };
    const signingText = Object.entries(callback).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`).join('&');
    callback.sign = createHash('md5').update(`${signingText}merchant-secret`, 'utf8').digest('hex');
    callback.sign_type = 'MD5';
    secretBox.open.mockClear();

    const posted = await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callback),
    });
    expect(posted.status).toBe(200);
    expect(await posted.text()).toBe('success');
    expect(pool.wallets.get(42).quota_balance).toBe('12.300000');
    expect(pool.transactions).toHaveLength(1);
    expect(secretBox.open).toHaveBeenCalledWith(pool.providers[0].secret_envelope, { aad: 'payment_providers:ep-main' });

    const duplicated = await fetch(`${baseUrl}/api/payment/easypay/notify?${new URLSearchParams(callback)}`);
    expect(duplicated.status).toBe(200);
    expect(await duplicated.text()).toBe('success');
    expect(pool.wallets.get(42).quota_balance).toBe('12.300000');
    expect(pool.transactions).toHaveLength(1);
  });

  it('credits a wallet that starts negative while preserving six-decimal precision', async () => {
    pool.orders.length = 0;
    pool.transactions.length = 0;
    pool.wallets.get(42).quota_balance = '-0.123456';
    const created = await fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '12.30', payment_method: 'alipay' }),
    });
    const { order_no: orderNo } = await created.json();
    const callback = {
      pid: '10001', type: 'alipay', out_trade_no: orderNo, trade_status: 'TRADE_SUCCESS', trade_no: 'trade-six-decimals', money: '12.30',
    };
    const signingText = Object.entries(callback).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`).join('&');
    callback.sign = createHash('md5').update(`${signingText}merchant-secret`, 'utf8').digest('hex');
    callback.sign_type = 'MD5';

    const response = await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callback),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
    expect(pool.wallets.get(42).quota_balance).toBe('12.176544');
    expect(pool.transactions).toHaveLength(1);
  });

  it('回调拒绝错签、错金额与错商户，但已验签的晚到付款仍只入账一次', async () => {
    pool.orders.length = 0;
    pool.transactions.length = 0;
    pool.wallets.get(42).quota_balance = '0.00';
    const created = await fetch(`${baseUrl}/api/user/payment-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '12.30', payment_method: 'alipay' }),
    });
    const { order_no: orderNo } = await created.json();
    const signed = (fields) => {
      const values = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${value}`).join('&');
      return createHash('md5').update(`${values}merchant-secret`, 'utf8').digest('hex');
    };
    const callback = {
      pid: '10001', type: 'alipay', out_trade_no: orderNo, trade_status: 'TRADE_SUCCESS', trade_no: 'trade-1002', money: '12.30',
    };

    expect((await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...callback, sign: 'bad' }),
    })).status).toBe(400);
    const wrongAmount = { ...callback, money: '12.31' };
    wrongAmount.sign = signed(wrongAmount);
    expect((await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wrongAmount),
    })).status).toBe(400);
    const wrongMerchant = { ...callback, pid: '99999' };
    wrongMerchant.sign = signed(wrongMerchant);
    expect((await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wrongMerchant),
    })).status).toBe(400);

    pool.orders[0].expires_at = new Date(Date.now() - 1_000);
    callback.sign = signed(callback);
    const expired = await fetch(`${baseUrl}/api/payment/easypay/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callback),
    });
    expect(expired.status).toBe(200);
    expect(await expired.text()).toBe('success');
    expect(pool.orders[0].status).toBe('granted');
    expect(pool.wallets.get(42).quota_balance).toBe('12.300000');
    expect(pool.transactions).toHaveLength(1);
  });

  it('保留手工额度订单和 recharge 别名，但不在用户提交时直接入账', async () => {
    pool.orders.length = 0;
    pool.transactions.length = 0;
    const invalid = await fetch(`${baseUrl}/api/user/quota-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '3.001' }),
    });
    expect(invalid.status).toBe(400);

    const created = await fetch(`${baseUrl}/api/user/recharge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '20.00', payment_method: 'manual_transfer' }),
    });
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload).toMatchObject({ amount: 20, payment_method: 'manual_transfer' });
    expect(payload.order_no).toMatch(/^QPO/);
    expect(pool.transactions).toHaveLength(0);

    const listed = await fetch(`${baseUrl}/api/user/quota-orders`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: [{ order_no: payload.order_no, status: 'pending' }], pagination: { page: 1, limit: 20, total: 1 } });
    expect((await fetch(`${baseUrl}/api/user/recharge-orders`)).status).toBe(200);
  });
});
