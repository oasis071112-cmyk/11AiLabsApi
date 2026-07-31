import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresIdentity } = require('../src/modules/identity/index.js');
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

async function appFor(pool, bcrypt) {
  const identity = createPostgresIdentity({
    pool,
    bcrypt,
    jwt: { sign: vi.fn(), verify: vi.fn() },
    jwtSecret: 'postgres-api-key-auth-test-secret!',
  });
  const app = express();
  const handler = (req, res) => res.json({ identity: req.apiIdentity });
  app.get('/v1/models', identity.authenticateApiKey, handler);
  app.get('/v1/messages', identity.authenticateApiKey, handler);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}/v1/models`;
}

describe('PostgreSQL API key authentication', () => {
  it('accepts Bearer keys, resolves the effective model whitelist, and exposes no secret columns', async () => {
    const queries = [];
    const pool = {
      async query(sql, values = []) {
        queries.push({ sql, values });
        if (sql.includes('FROM api_keys ak JOIN users u')) return { rows: [{
          id: '20', user_id: '10', key_hash: 'hash', key_envelope: 'ciphertext',
          key_prefix: 'sk-valid-123', user_status: 'active', status: 'active',
          routing_group_id: '7', permission_mode: 'restricted', expired_at: null,
        }] };
        if (sql.includes('SELECT DISTINCT m.model_code')) return { rows: [{ model_code: 'model-a' }] };
        if (sql.startsWith('UPDATE api_keys SET last_used_at')) return { rows: [] };
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    const url = await appFor(pool, { compare: vi.fn(async value => value === 'sk-valid-1234'), hash: vi.fn() });

    const response = await fetch(url, { headers: { Authorization: 'Bearer sk-valid-1234' } });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.identity).toEqual({
      userId: '10', apiKeyId: '20', routingGroupId: '7', permissionMode: 'restricted',
      allowedModels: ['model-a'],
    });
    expect(JSON.stringify(body)).not.toContain('hash');
    expect(JSON.stringify(body)).not.toContain('ciphertext');
    expect(queries.some(query => query.sql.startsWith('UPDATE api_keys SET last_used_at'))).toBe(true);
  });

  it('uses Anthropic error shape for an invalid x-api-key', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const url = await appFor(pool, { compare: vi.fn(async () => false), hash: vi.fn() });

    const response = await fetch(url.replace('/models', '/messages'), { headers: { 'x-api-key': 'bad-key' } });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'authentication_error', message: 'API Key 无效' },
    });
  });
});
