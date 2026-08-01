import { describe, expect, it, vi } from 'vitest';
import { ControlPlane } from '../src/modules/control-plane/index.js';

describe('ControlPlane', () => {
  it('returns one sanitized control-plane bootstrap without encrypted credentials', async () => {
    const repository = {
      getBootstrap: vi.fn(async () => ({
        accounts: [{ id: 1, name: 'primary', credential_ciphertext: 'secret', secret_configured: true }],
        models: [{ model_code: 'gpt-image-2' }],
        account_models: [{ account_id: 1, model_code: 'gpt-image-2' }],
        routing_groups: [{ id: 2, group_name: 'image' }],
        group_accounts: [{ group_id: 2, account_id: 1 }],
        group_models: [{ group_id: 2, model_code: 'gpt-image-2' }],
      })),
    };
    const controlPlane = new ControlPlane({ repository });

    const result = await controlPlane.bootstrap();

    expect(result.accounts[0]).toEqual({ id: 1, name: 'primary', secret_configured: true });
    expect(JSON.stringify(result)).not.toContain('credential_ciphertext');
    expect(repository.getBootstrap).toHaveBeenCalledTimes(1);
  });

  it('encrypts an upstream secret and persists account protections in one transaction', async () => {
    const created = [];
    const repository = {
      transaction: async work => work({
        createAccount: async account => { created.push(account); return { id: 81, ...account }; },
        appendAudit: vi.fn(async () => {}),
      }),
    };
    const secretCipher = { encrypt: vi.fn(value => `v2:${value}:ciphertext`) };
    const cache = { bumpVersion: vi.fn(async () => 4) };
    const controlPlane = new ControlPlane({ repository, secretCipher, cache });

    const result = await controlPlane.createAccount({
      name: ' Image Account ',
      base_url: 'https://upstream.example/v1/',
      api_key: 'sk-upstream',
      protocol_type: 'openai_compatible',
      capabilities: ['image_generations', 'image_edits'],
      max_concurrency: 4,
      rpm_limit: 60,
      tpm_limit: 200000,
      cooldown_seconds: 45,
      priority: 10,
      weight: 80,
    }, { id: 7, role: 'admin' });

    expect(secretCipher.encrypt).toHaveBeenCalledWith('sk-upstream', { accountKey: 'image-account' });
    expect(created[0]).toMatchObject({
      name: 'Image Account',
      base_url: 'https://upstream.example/v1',
      credential_ciphertext: 'v2:sk-upstream:ciphertext',
      max_concurrency: 4,
      rpm_limit: 60,
      tpm_limit: 200000,
      cooldown_seconds: 45,
    });
    expect(created[0]).not.toHaveProperty('api_key');
    expect(result.account).not.toHaveProperty('credential_ciphertext');
    expect(result.config_version).toBe(4);
  });

  it('defaults new upstream accounts to five concurrent requests while honoring an explicit override', async () => {
    const created = [];
    const repository = {
      transaction: async work => work({
        createAccount: async account => { created.push(account); return { id: created.length, ...account }; },
      }),
    };
    const controlPlane = new ControlPlane({ repository, secretCipher: { encrypt: value => `sealed:${value}` } });
    const baseAccount = {
      name: 'Primary', base_url: 'https://upstream.example/v1', api_key: 'secret',
      protocol_type: 'openai_compatible', capabilities: ['responses'],
    };

    await controlPlane.createAccount(baseAccount);
    await controlPlane.createAccount({ ...baseAccount, name: 'Special', max_concurrency: 9 });

    expect(created.map(account => account.max_concurrency)).toEqual([5, 9]);
  });

  it('rejects invalid account limits before writing anything', async () => {
    const repository = { transaction: vi.fn() };
    const controlPlane = new ControlPlane({ repository, secretCipher: { encrypt: value => value } });

    await expect(controlPlane.createAccount({
      name: 'bad', base_url: 'https://example.com', api_key: 'key',
      protocol_type: 'openai_compatible', max_concurrency: 0,
    }, { id: 1 })).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_LIMIT' });
    expect(repository.transaction).not.toHaveBeenCalled();
  });
});
