import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const { PostgresAdminCompatRepository } = require('../src/modules/control-plane/admin-compat-repository.js');
const { createSecretBox } = require('../src/infrastructure/versioned-secret.js');
const { createPostgresIdentity } = require('../src/modules/identity/index.js');
const { createPostgresAdminRouter } = require('../src/routes/postgres-admin.js');
const { createPostgresUserRouter } = require('../src/routes/postgres-user.js');
const { PostgresProxyBillingPolicy } = require('../src/modules/postgres-proxy/postgres-adapters.js');
const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('PostgreSQL admin compatibility integration', () => {
  let pool;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterAll(async () => pool?.end());

  it('executes the user, key, order, model, mapping and pricing management paths on the migrated schema', async () => {
    const suffix = randomUUID();
    const code = `integration-model-${suffix}`;
    const accountKey = `integration-account-${suffix}`;
    const groupKey = `integration-group-${suffix}`;
    const pricingKey = `integration-pricing-${suffix}`;
    const userPricingKey = `${pricingKey}-user`;
    const secretBox = createSecretBox({ activeVersion: 'integration-v1', keys: { 'integration-v1': Buffer.alloc(32, 9) } });
    let staffId; let userId; let accountId; let groupId; let keyId; let orderId; let providerId; let server;
    const repository = new PostgresAdminCompatRepository({ pool, secretBox });
    try {
      staffId = Number((await pool.query(`INSERT INTO staff_users(username,email,password_hash,role,status)
        VALUES($1,$2,'integration','admin','active') RETURNING id`, [`staff-${suffix}`, `staff-${suffix}@example.test`])).rows[0].id);
      userId = Number((await pool.query(`INSERT INTO users(username,email,password_hash,role,status)
        VALUES($1,$2,'integration','user','active') RETURNING id`, [`user-${suffix}`, `user-${suffix}@example.test`])).rows[0].id);
      await pool.query('INSERT INTO wallets(user_id,quota_balance,gift_quota,frozen_balance,total_spent) VALUES($1,10,0,0,0)', [userId]);
      await pool.query(`INSERT INTO models(model_code,model_name,provider,model_type,status,metadata,capabilities)
        VALUES($1,'Integration model','manual','llm','inactive','{}'::jsonb,'{}'::jsonb)`, [code]);
      accountId = Number((await pool.query(`INSERT INTO upstream_accounts
        (account_key,display_name,base_url,protocol_type,api_key_envelope,secret_version,capabilities,status)
        VALUES($1,'Integration','https://upstream.example/v1','openai_compatible',$2,'integration-v1','["chat_completions"]'::jsonb,'active') RETURNING id`, [
        accountKey, secretBox.seal('integration-key', { aad: `upstream_accounts:${accountKey}` }),
      ])).rows[0].id);
      await pool.query(`INSERT INTO account_models(account_id,model_code,upstream_model_name,status)
        VALUES($1,$2,$2,'inactive')`, [accountId, code]);
      groupId = Number((await pool.query(`INSERT INTO routing_groups(group_key,group_name,status)
        VALUES($1,$1,'active') RETURNING id`, [groupKey])).rows[0].id);
      await pool.query(`INSERT INTO routing_group_accounts(routing_group_id,account_id,status) VALUES($1,$2,'active')`, [groupId, accountId]);
      keyId = Number((await pool.query(`INSERT INTO api_keys(user_id,key_name,key_hash,key_prefix,routing_group_id,status)
        VALUES($1,'Integration','integration-hash',$2,$3,'active') RETURNING id`, [userId, `sk-${suffix}`.slice(0, 12), groupId])).rows[0].id);
      await pool.query(`INSERT INTO api_key_permissions(api_key_id,model_code,status) VALUES($1,$2,'active')`, [keyId, code]);
      orderId = Number((await pool.query(`INSERT INTO quota_orders(order_key,order_no,user_id,amount,payment_method,status)
        VALUES($1,$1,$2,3,'manual','pending') RETURNING id`, [`order-${suffix}`, userId])).rows[0].id);
      const actor = { id: staffId, staffId, role: 'admin' };

      expect((await repository.listModels()).find(model => model.model_code === code)).toMatchObject({ context_length: null, channel_mappings: [{ channel_id: String(accountId) }] });
      expect(await repository.listKeys({ page: 1, limit: 20, groupBy: 'user' })).toMatchObject({ data: [{ user_id: String(userId), keys: [{ id: String(keyId) }] }] });
      expect(await repository.getUser(userId)).toMatchObject({ pending_orders: [{ id: String(orderId) }] });
      await expect(repository.updateModel(code, { model_name: 'Updated', context_length: 8192, official_provider: 'openai', official_pricing_mode: 'manual', official_input_price: 1 }, actor)).resolves.toMatchObject({ model_name: 'Updated', context_length: 8192 });
      await expect(repository.setChannelModelStatus(accountId, code, 'active', actor)).resolves.toMatchObject({ status: 'active', model_status: 'active' });
      expect((await pool.query('SELECT status FROM models WHERE model_code=$1', [code])).rows[0].status).toBe('active');
      await expect(repository.adjustUserBalance(userId, { type: 'manual_add', balance_type: 'gift', amount: 2 }, actor)).resolves.toMatchObject({ after_balance: 2 });
      await expect(repository.confirmRechargeOrder(orderId, {}, actor)).resolves.toMatchObject({ status: 'granted' });
      expect(Number((await pool.query('SELECT quota_balance FROM wallets WHERE user_id=$1', [userId])).rows[0].quota_balance)).toBe(13);
      const pricing = await repository.createPricingRule({ rule_key: pricingKey, rule_name: 'Integration', scope_type: 'platform', multiplier_input: 1.1, multiplier_output: 1.2, multiplier_image: 1.3 }, actor);
      expect(pricing).toMatchObject({ id: pricingKey, billing_multiplier_image: 1.3 });
      await expect(repository.updatePricingRule(pricingKey, { multiplier_input: 1.4 }, actor)).resolves.toMatchObject({ billing_multiplier_input: 1.4 });
      await repository.deletePricingRule(pricingKey, actor);
      const provider = await repository.createPaymentProvider({ provider_name: `Pay ${suffix}`, merchant_key: 'merchant', enable: false }, actor);
      providerId = provider.id;
      expect(provider.provider_code).toMatch(/^pay-/);

      await repository.createPricingRule({ rule_key: userPricingKey, rule_name: 'Integration user', scope_type: 'user', scope_id: userId, model_code: code, multiplier_input: 4, multiplier_output: 5, multiplier_image: 6 }, actor);
      const policy = await new PostgresProxyBillingPolicy(pool).loadPolicy(code, groupId, userId);
      expect(policy.multipliers).toEqual({ input: 4, output: 5, image: 6 });

      const identity = createPostgresIdentity({
        pool, secretBox, jwtSecret: 'postgres-integration-http-secret-2026-08-01',
      });
      const requireAdmin = (...roles) => (req, res, next) => roles.includes(req.user?.role)
        ? next() : res.status(403).json({ error: '权限不足' });
      const app = express();
      app.use(express.json());
      app.use('/api/user', createPostgresUserRouter({ pool, identity, secretBox }));
      app.use('/api/admin', createPostgresAdminRouter({
        repository, authenticate: identity.authenticate, requireAdmin,
        pricingSyncService: { status: async () => ({}), syncAll: async () => ({}) },
      }));
      app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
      await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const userHeaders = { Authorization: `Bearer ${identity.generateToken({ id: userId, username: `user-${suffix}`, role: 'user' })}` };
      const staffHeaders = { Authorization: `Bearer ${identity.generateToken({ id: staffId, username: `staff-${suffix}`, role: 'admin' })}` };
      expect((await fetch(`${baseUrl}/api/user/wallet`, { headers: staffHeaders })).status).toBe(403);
      expect((await fetch(`${baseUrl}/api/user/wallet`, { headers: userHeaders })).status).toBe(200);
      const docs = await fetch(`${baseUrl}/api/user/docs/channel?channel_name=${encodeURIComponent(groupKey)}`, { headers: userHeaders });
      expect(docs.status).toBe(200);
      expect(await docs.json()).toMatchObject({ protocol_docs: [{ protocol_type: 'openai', models: [{ model_code: code }] }] });
      const groupedKeys = await fetch(`${baseUrl}/api/admin/keys?group_by=user`, { headers: staffHeaders });
      expect(groupedKeys.status).toBe(200);
      expect(await groupedKeys.json()).toMatchObject({ data: [{ user_id: String(userId), keys: [{ id: String(keyId) }] }] });
      expect((await fetch(`${baseUrl}/api/admin/keys/${keyId}/status`, {
        method: 'PATCH', headers: { ...staffHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'revoked' }),
      })).status).toBe(200);
      const reactivation = await fetch(`${baseUrl}/api/admin/keys/${keyId}/status`, {
        method: 'PATCH', headers: { ...staffHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }),
      });
      expect(reactivation.status).toBe(409);
      expect(await reactivation.json()).toMatchObject({ code: 'revoked_key_immutable' });
      await pool.query('DELETE FROM pricing_rules WHERE rule_key=$1', [userPricingKey]);
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (providerId) await pool.query('DELETE FROM payment_providers WHERE id=$1', [providerId]);
      await pool.query('DELETE FROM pricing_rules WHERE rule_key=$1', [userPricingKey]);
      await pool.query('DELETE FROM pricing_rules WHERE rule_key=$1', [pricingKey]);
      if (orderId) await pool.query('DELETE FROM wallet_transactions WHERE related_order_id=$1 OR user_id=$2', [orderId, userId]);
      if (orderId) await pool.query('DELETE FROM quota_orders WHERE id=$1', [orderId]);
      if (keyId) await pool.query('DELETE FROM api_key_permissions WHERE api_key_id=$1', [keyId]);
      if (keyId) await pool.query('DELETE FROM api_keys WHERE id=$1', [keyId]);
      if (groupId) await pool.query('DELETE FROM routing_group_models WHERE routing_group_id=$1', [groupId]);
      if (groupId) await pool.query('DELETE FROM routing_group_accounts WHERE routing_group_id=$1', [groupId]);
      if (groupId) await pool.query('DELETE FROM routing_groups WHERE id=$1', [groupId]);
      if (accountId) await pool.query('DELETE FROM account_models WHERE account_id=$1', [accountId]);
      if (accountId) await pool.query('DELETE FROM upstream_accounts WHERE id=$1', [accountId]);
      await pool.query('DELETE FROM models WHERE model_code=$1', [code]);
      if (userId) await pool.query('DELETE FROM wallets WHERE user_id=$1', [userId]);
      if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
      if (staffId) await pool.query('DELETE FROM audit_logs WHERE actor_staff_user_id=$1', [staffId]);
      if (staffId) await pool.query('DELETE FROM staff_users WHERE id=$1', [staffId]);
    }
  });
});
