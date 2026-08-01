import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createPostgresPaymentService, signEasyPay } = require('../src/modules/postgres-payment/index.js');
const { createSecretBox } = require('../src/infrastructure/versioned-secret.js');
const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('PostgreSQL payment restoration integration', () => {
  let pool;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('restores disabled payment, creates an order, and idempotently credits a signed callback', async () => {
    const suffix = randomUUID();
    const providerCode = `integration-pay-${suffix}`;
    const secretBox = createSecretBox({ activeVersion: 'integration-v1', keys: { 'integration-v1': Buffer.alloc(32, 8) } });
    const merchantKey = `merchant-${suffix}`;
    const original = await pool.query("SELECT config_value FROM system_config WHERE config_key='payment_enabled'");
    const userId = Number((await pool.query('SELECT COALESCE(MAX(id),0)+10000 AS id FROM users')).rows[0].id);
    let providerId;
    let orderId;
    try {
      await pool.query(`INSERT INTO users(id,username,password_hash,role,status)
        VALUES($1,$2,'integration-only','user','active')`, [userId, `integration-${suffix}`]);
      await pool.query('INSERT INTO wallets(user_id,quota_balance,gift_quota,frozen_balance,total_spent) VALUES($1,0,0,0,0)', [userId]);
      const provider = await pool.query(`INSERT INTO payment_providers
        (provider_code,provider_name,provider_type,config,secret_envelope,secret_version,status)
        VALUES($1,'integration','easypay',$2::jsonb,$3,'integration-v1','active') RETURNING id`, [
        providerCode,
        JSON.stringify({ api_base_url: 'https://pay.example.test', merchant_id: 'integration-pid', enabled_methods: ['alipay'] }),
        secretBox.seal(merchantKey, { aad: `payment_providers:${providerCode}` }),
      ]);
      providerId = provider.rows[0].id;
      await pool.query(`INSERT INTO system_config(config_key,config_value,description)
        VALUES('payment_enabled','true'::jsonb,'integration')
        ON CONFLICT(config_key) DO UPDATE SET config_value='true'::jsonb`, []);

      const service = createPostgresPaymentService({
        pool, secretBox, siteUrl: 'https://ionailabs.example', idFactory: () => suffix,
      });
      await expect(service.getPaymentOptions()).resolves.toMatchObject({ enabled: true });
      const order = await service.createPaymentOrder({ userId, amount: '12.30', paymentMethod: 'alipay' });
      expect(order.payment_request.fields.sign).toMatch(/^[a-f0-9]{32}$/);
      orderId = (await pool.query('SELECT id FROM quota_orders WHERE order_key=$1', [order.order_no])).rows[0].id;

      const callback = {
        pid: 'integration-pid', type: 'alipay', out_trade_no: order.order_no,
        trade_status: 'TRADE_SUCCESS', trade_no: `trade-${suffix}`, money: '12.30',
      };
      callback.sign = signEasyPay(callback, merchantKey);
      callback.sign_type = 'MD5';
      await expect(service.processEasyPayCallback(callback)).resolves.toMatchObject({ duplicate: false });
      await expect(service.processEasyPayCallback(callback)).resolves.toMatchObject({ duplicate: true });
      expect(Number((await pool.query('SELECT quota_balance FROM wallets WHERE user_id=$1', [userId])).rows[0].quota_balance)).toBe(12.3);
      expect(Number((await pool.query("SELECT COUNT(*) AS count FROM wallet_transactions WHERE related_order_id=$1 AND transaction_type='purchase'", [orderId])).rows[0].count)).toBe(1);
    } finally {
      if (orderId) await pool.query('DELETE FROM wallet_transactions WHERE related_order_id=$1', [orderId]);
      await pool.query('DELETE FROM quota_orders WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM wallets WHERE user_id=$1', [userId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
      if (providerId) await pool.query('DELETE FROM payment_providers WHERE id=$1', [providerId]);
      if (original.rows[0]) {
        await pool.query("UPDATE system_config SET config_value=$1::jsonb WHERE config_key='payment_enabled'", [JSON.stringify(original.rows[0].config_value)]);
      } else {
        await pool.query("DELETE FROM system_config WHERE config_key='payment_enabled'");
      }
    }
  });
});
