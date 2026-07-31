import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildControlPlaneImportPlan,
  createPostgresControlPlaneSink,
  executeControlPlaneImport,
} = require('../src/infrastructure/sqljs-control-plane-import.js');
const { createSecretBox } = require('../src/infrastructure/versioned-secret.js');

describe('SQL.js control-plane import seam', () => {
  const snapshot = {
    staffUsers: [
      { username: 'admin', email: 'admin@example.test', password_hash: 'hash', role: 'admin', status: 'active' },
      { username: 'ordinary-user', email: 'user@example.test', password_hash: 'hash', role: 'user', status: 'active' },
    ],
    models: [{ model_code: 'image-alpha', model_name: 'Image Alpha', model_type: 'image', status: 'active' }],
    systemConfig: [{ config_key: 'payment_enabled', config_value: 'true', description: 'legacy switch' }],
    upstreamChannels: [{
      channel_name: 'primary', base_url: 'https://upstream.test/v1', api_key: 'legacy-api-key',
      protocol_type: 'openai_compatible', status: 'active', priority: 9, weight: 70,
    }],
    channelModels: [{ channel_name: 'primary', model_code: 'image-alpha', upstream_model_name: 'vendor-image-alpha', status: 'active' }],
    routingGroups: [
      {
        group_name: 'stable', protocol_type: 'openai_compatible', status: 'active', description: '稳定池',
        restrict_models: 1, billing_multiplier_input: 1.2, billing_multiplier_output: 1.3,
        billing_multiplier_image: 1.4, fallback_group_name: 'backup',
      },
      { group_name: 'backup', protocol_type: 'openai_compatible', status: 'active' },
    ],
    routingGroupChannels: [{ group_name: 'stable', channel_name: 'primary', priority: 10, weight: 100, status: 'active' }],
    routingGroupModels: [{
      group_name: 'stable', model_code: 'image-alpha', status: 'active',
      billing_multiplier_input: 1.1, billing_multiplier_output: 1.2, billing_multiplier_image: 1.3,
    }],
    pricingRules: [{ rule_name: 'platform-image', scope_type: 'platform', model_code: 'image-alpha', status: 'active' }],
    paymentProviders: [{
      provider_name: 'legacy-pay', provider_type: 'easypay', status: 'active',
      api_base_url: 'https://pay.example.test', merchant_id: 'merchant-1',
      merchant_key_encrypted: 'legacy-payment-ciphertext', enabled_methods: '["alipay","wechat"]',
    }],
    excludedUserPlaneCounts: { api_keys: 2, wallets: 1, quota_orders: 1, api_request_logs: 9 },
  };

  it('defaults to dry-run, uses natural keys, excludes ordinary users, and forces payment disabled', async () => {
    const plan = buildControlPlaneImportPlan(snapshot);
    expect(plan.records.find(record => record.entity === 'staff_user')?.naturalKey).toEqual({ username: 'admin' });
    expect(plan.records.some(record => record.value?.username === 'ordinary-user')).toBe(false);
    expect(plan.records.find(record => record.entity === 'system_config' && record.naturalKey.configKey === 'payment_enabled'))
      .toMatchObject({ value: { configValue: false } });
    expect(plan.records.find(record => record.entity === 'payment_provider')).toMatchObject({
      value: {
        status: 'disabled', secretEnvelope: null, secretPresent: true,
        config: {
          api_base_url: 'https://pay.example.test',
          merchant_id: 'merchant-1',
          enabled_methods: ['alipay', 'wechat'],
        },
      },
    });
    expect(plan.records.find(record => record.entity === 'upstream_account')).toMatchObject({
      value: { priority: 9, weight: 70, maxConcurrency: 1, rpmLimit: 60, tpmLimit: 100000 },
    });
    expect(plan.records.find(record => record.entity === 'routing_group' && record.value.groupKey === 'stable')).toMatchObject({
      value: {
        description: '稳定池', restrictModels: true,
        billingMultiplierInput: 1.2, billingMultiplierOutput: 1.3, billingMultiplierImage: 1.4,
      },
    });
    expect(plan.records.find(record => record.entity === 'routing_group_fallback')).toMatchObject({
      value: { groupKey: 'stable', fallbackGroupKey: 'backup' },
    });
    expect(plan.records.find(record => record.entity === 'routing_group_model')).toMatchObject({
      value: { billingMultiplierInput: 1.1, billingMultiplierOutput: 1.2, billingMultiplierImage: 1.3 },
    });

    const writes = [];
    const result = await executeControlPlaneImport({ snapshot, sink: { upsert: async record => writes.push(record), insertAudit: async audit => writes.push(audit) } });
    expect(result).toMatchObject({ dryRun: true, paymentEnabled: false, excludedUserPlaneCounts: snapshot.excludedUserPlaneCounts });
    expect(writes).toEqual([]);
  });

  it('writes encrypted account credentials and one audit record only for an explicit apply', async () => {
    const writes = [];
    const secretBox = createSecretBox({ activeVersion: 'v1', keys: { v1: Buffer.alloc(32, 3) } });
    const decodePaymentSecret = vi.fn(value => value === 'legacy-payment-ciphertext' ? 'legacy-payment-secret' : '');
    const verification = { user_plane_zero: true, secrets_opened: 2 };
    const verify = vi.fn().mockResolvedValue(verification);
    const result = await executeControlPlaneImport({
      snapshot,
      dryRun: false,
      secretBox,
      decodePaymentSecret,
      sink: {
        upsert: async record => { writes.push(record); return { rowCount: 1 }; },
        verify,
        insertAudit: async audit => writes.push({ audit }),
      },
    });

    const account = writes.find(record => record.entity === 'upstream_account');
    expect(account.value.apiKeyEnvelope).toMatch(/^v1\./);
    expect(JSON.stringify(account)).not.toContain('legacy-api-key');
    const payment = writes.find(record => record.entity === 'payment_provider');
    expect(payment.value).toMatchObject({ status: 'disabled', secretVersion: 'v1' });
    expect(payment.value.secretEnvelope).toMatch(/^v1\./);
    expect(decodePaymentSecret).toHaveBeenCalledWith('legacy-payment-ciphertext');
    expect(JSON.stringify(payment)).not.toContain('legacy-payment-ciphertext');
    expect(JSON.stringify(payment)).not.toContain('legacy-payment-secret');
    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith({ plan: expect.objectContaining({ records: expect.any(Array) }), secretBox });
    expect(writes.at(-1).audit).toMatchObject({
      action: 'sqljs_control_plane_import',
      payload: { paymentEnabled: false, verification },
    });
    expect(result).toMatchObject({ dryRun: false, paymentEnabled: false, verification });
  });

  it('keeps imported payment configuration runtime-compatible and never clears an existing secret on conflict', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const sink = createPostgresControlPlaneSink({ query });
    await sink.upsert({
      entity: 'payment_provider',
      value: {
        providerCode: 'easypay:legacy-pay',
        providerName: 'legacy-pay',
        providerType: 'easypay',
        config: {
          api_base_url: 'https://pay.example.test',
          merchant_id: 'merchant-1',
          enabled_methods: ['alipay'],
        },
        secretEnvelope: null,
        secretVersion: null,
      },
    });

    expect(query.mock.calls[0][0]).toContain('secret_envelope=COALESCE(EXCLUDED.secret_envelope,payment_providers.secret_envelope)');
    expect(JSON.parse(query.mock.calls[0][1][3])).toMatchObject({
      api_base_url: 'https://pay.example.test',
      merchant_id: 'merchant-1',
      enabled_methods: ['alipay'],
    });
  });
});
