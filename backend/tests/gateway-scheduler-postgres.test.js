import { describe, expect, it } from 'vitest';
import { PostgresAccountRepository } from '../src/modules/gateway-scheduler/index.js';

describe('PostgresAccountRepository', () => {
  it('maps joined account-pool rows into the scheduler account contract', async () => {
    const calls = [];
    const pool = {
      async query(sql, parameters) {
        calls.push({ sql, parameters });
        return {
          rows: [{
            id: 7,
            account_key: 'primary-openai',
            display_name: 'Primary OpenAI',
            base_url: 'https://upstream.example/v1',
            protocol_type: 'openai_compatible',
            api_key_envelope: 'v1.ciphertext',
            secret_version: 'v1',
            capabilities: '["chat_completions","image_edits"]',
            account_status: 'active',
            max_concurrency: 8,
            rpm_limit: 120,
            tpm_limit: 50000,
            cooldown_seconds: 45,
            account_priority: 9,
            account_weight: 10,
            health_score: '92.50',
            cooldown_until: null,
            routing_group_id: 3,
            routing_priority: 1,
            routing_weight: 70,
            model_code: 'gpt-image-2',
            upstream_model_name: 'vendor-image-v2',
            supports_image_input: true,
            model_configuration: '{"quality":"high"}',
            model_status: 'active',
          }],
        };
      },
    };
    const repository = new PostgresAccountRepository(pool);

    const accounts = await repository.listCandidates({
      groupId: 3,
      model: 'gpt-image-2',
      protocol: 'openai_compatible',
      capability: 'image_edits',
    });

    expect(accounts).toEqual([{
      id: 7,
      accountKey: 'primary-openai',
      displayName: 'Primary OpenAI',
      baseUrl: 'https://upstream.example/v1',
      protocol: 'openai_compatible',
      credentialEnvelope: 'v1.ciphertext',
      secretVersion: 'v1',
      capabilities: ['chat_completions', 'image_edits'],
      status: 'active',
      groupIds: ['3'],
      priority: 1,
      weight: 70,
      healthScore: 92.5,
      cooldownUntil: null,
      cooldownSeconds: 45,
      maxConcurrency: 8,
      rpmLimit: 120,
      tpmLimit: 50000,
      modelMappings: [{
        model: 'gpt-image-2',
        upstreamModel: 'vendor-image-v2',
        supportsImageInput: true,
        configuration: { quality: 'high' },
        status: 'active',
      }],
    }]);
    expect(calls[0].sql).toContain('FROM routing_group_accounts');
    expect(calls[0].sql).toContain('JOIN upstream_accounts');
    expect(calls[0].sql).toContain('JOIN account_models');
    expect(calls[0].sql).toContain('rg.restrict_models');
    expect(calls[0].sql).toContain('FROM routing_group_models');
    expect(calls[0].parameters).toEqual([3, 'gpt-image-2', 'openai_compatible', 'image_edits']);
  });

  it('loads fallback groups and persists health and cooldown runtime state', async () => {
    const calls = [];
    const pool = {
      async query(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.includes('SELECT fallback_group_id')) return { rows: [{ fallback_group_id: 9 }] };
        return { rows: [] };
      },
    };
    const repository = new PostgresAccountRepository(pool);

    await expect(repository.getFallbackGroupId(3)).resolves.toBe(9);
    await repository.reportHealth({ accountId: 7, success: false, status: 503 });
    await repository.markCooldown({ accountId: 7, cooldownUntil: Date.parse('2026-08-01T00:01:00.000Z') });

    expect(calls[0]).toMatchObject({ parameters: [3] });
    expect(calls[1].sql).toContain('SET health_score=CASE');
    expect(calls[1].parameters).toEqual([7, false]);
    expect(calls[2].sql).toContain('SET cooldown_until=GREATEST');
    expect(calls[2].parameters).toEqual([7, '2026-08-01T00:01:00.000Z']);
  });
});
