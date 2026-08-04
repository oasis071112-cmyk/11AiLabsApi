import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createPostgresProxyRouter } from '../src/routes/postgres-proxy.js';
import { executeJsonUpstream } from '../src/modules/postgres-proxy/upstream.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

async function listen(router) {
  const app = express();
  app.use('/v1', router);
  const server = http.createServer(app);
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

function authenticateApiKey(req, _res, next) {
  req.apiIdentity = {
    userId: 10,
    apiKeyId: 20,
    routingGroupId: 'group-1',
    allowedModels: ['public-chat', 'public-image'],
  };
  next();
}

function baseOptions(overrides = {}) {
  return {
    runtime: {
      mode: 'postgres_redis',
      gatewayScheduler: { async executeWithFailover() { throw new Error('unexpected scheduler call'); } },
      usageSettlement: {
        async reserve() { throw new Error('unexpected reservation'); },
        async release() {},
        async settle() {},
        async markPending() {},
      },
      secretBox: { open() { throw new Error('unexpected secret open'); } },
    },
    authenticateApiKey,
    repository: {
      async listModels() { return []; },
    },
    billingPolicy: {
      async quoteReservation() { return { amount: 1, estimatedTokens: 1 }; },
      async quoteCharge() { return { amount: 1 }; },
    },
    fetchImpl: async () => { throw new Error('unexpected upstream request'); },
    ...overrides,
  };
}

describe('PostgreSQL public proxy bridge', () => {
  it('returns only the API-key-visible model catalog', async () => {
    const repository = {
      async listModels(identity) {
        expect(identity).toMatchObject({ apiKeyId: 20, routingGroupId: 'group-1' });
        return [
          { id: 'public-chat', object: 'model', owned_by: 'ionailabs' },
          { id: 'public-image', object: 'model', owned_by: 'ionailabs' },
        ];
      },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({ repository })));

    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: 'Bearer sk-test' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: 'list',
      data: [
        { id: 'public-chat', object: 'model', owned_by: 'ionailabs' },
        { id: 'public-image', object: 'model', owned_by: 'ionailabs' },
      ],
    });
  });

  it('rejects Responses image tools before billing when the model lacks transformation capability', async () => {
    const checks = [];
    const repository = {
      async listModels() { return []; },
      async supportsCapability(identity, model, capability) {
        checks.push({ identity, model, capability });
        return false;
      },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({ repository })));

    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'public-image',
        input: 'draw a small blue square',
        tools: [{ type: 'image_generation' }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { type: 'invalid_request_error', code: 'capability_not_supported' },
    });
    expect(checks).toEqual([{
      identity: expect.objectContaining({ routingGroupId: 'group-1' }),
      model: 'public-image',
      capability: 'image_transformations',
    }]);
  });

  it('builds production repository and billing adapters from the runtime pool', async () => {
    const pool = {
      async query(sql, values) {
        expect(sql).toContain("m.model_code=ANY($1::text[])");
        expect(sql).toContain('am.supports_image_input');
        expect(values).toEqual([['public-chat', 'public-image'], 'group-1']);
        return {
          rows: [{
            model_code: 'public-chat',
            provider: 'openai',
            effective_capabilities: { chat_completions: true },
            created_at: '2026-08-01T00:00:00.000Z',
          }],
        };
      },
    };
    const options = baseOptions({
      runtime: { ...baseOptions().runtime, pool },
      repository: undefined,
      billingPolicy: undefined,
    });
    const baseUrl = await listen(createPostgresProxyRouter(options));

    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: 'Bearer sk-test' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      object: 'list',
      data: [{ id: 'public-chat', object: 'model', owned_by: 'openai' }],
    });
  });

  it('maps and forwards chat JSON, decrypts with account AAD, then settles actual usage', async () => {
    const schedulerRequests = [];
    const secretReads = [];
    const reservations = [];
    const settlements = [];
    const chargeQuotes = [];
    const upstreamCalls = [];
    const selection = {
      account: {
        id: 'account-7',
        accountKey: 'primary-openai',
        baseUrl: 'https://upstream.example/v1',
        protocol: 'openai_compatible',
        credentialEnvelope: 'v1.envelope',
      },
      upstreamModel: 'vendor-chat-v2',
      routingGroupId: 'group-1',
      lease: { id: 'lease-1', accountId: 'account-7' },
    };
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(criteria, invoke) {
          schedulerRequests.push(criteria);
          const value = await invoke(selection);
          return { value, selection, attempts: 1, postProcessingError: null };
        },
      },
      usageSettlement: {
        async reserve(value) { reservations.push(value); return { reserved: value.amount }; },
        async settle(value) { settlements.push(value); return { charged: value.chargeAmount }; },
        async release() { throw new Error('unexpected release'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: {
        open(envelope, options) {
          secretReads.push({ envelope, options });
          return 'upstream-secret';
        },
      },
    };
    const billingPolicy = {
      async quoteReservation(context) {
        expect(context).toMatchObject({ operation: 'chat_completions', model: 'public-chat' });
        return { amount: 5, estimatedTokens: 128, snapshot: { policy: 'test' } };
      },
      async quoteCharge(context) {
        chargeQuotes.push(context);
        return { amount: 0.16, snapshot: { policy: 'test', actual: true }, billingMode: 'token' };
      },
    };
    const fetchImpl = async (url, options) => {
      upstreamCalls.push({ url, options });
      expect(url).toBe('https://upstream.example/v1/chat/completions');
      expect(options.headers).toMatchObject({
        Authorization: 'Bearer upstream-secret',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(options.body)).toEqual({
        model: 'vendor-chat-v2',
        messages: [{ role: 'user', content: 'private prompt' }],
      });
      return new Response(JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'upstream-request-1' },
      });
    };
    const router = createPostgresProxyRouter(baseOptions({
      runtime,
      billingPolicy,
      fetchImpl,
      requestIdFactory: () => 'request-1',
    }));
    const baseUrl = await listen(router);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'public-chat',
        messages: [{ role: 'user', content: 'private prompt' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('upstream-request-1');
    expect(await response.json()).toMatchObject({ id: 'chatcmpl-1', usage: { total_tokens: 16 } });
    expect(schedulerRequests).toEqual([expect.objectContaining({
      groupId: 'group-1', model: 'public-chat', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 128,
    })]);
    expect(secretReads).toEqual([{
      envelope: 'v1.envelope',
      options: { aad: 'upstream_accounts:primary-openai' },
    }]);
    expect(reservations).toEqual([{ userId: 10, apiKeyId: 20, amount: 5, requestId: 'request-1' }]);
    expect(chargeQuotes[0]).toMatchObject({
      operation: 'chat_completions',
      usage: { inputTokens: 12, outputTokens: 4 },
      imageCount: 0,
    });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      userId: 10, reservedAmount: 5, chargeAmount: 0.16, requestId: 'request-1',
      successLog: {
        request_id: 'request-1', user_id: 10, api_key_id: 20, model_code: 'public-chat',
        upstream_account_id: 'account-7', status: 'success', input_tokens: 12,
        output_tokens: 4, total_cost: 0.16, billing_mode: 'token',
      },
    });
    const serializedLog = JSON.stringify(settlements[0].successLog);
    expect(serializedLog).not.toContain('private prompt');
    expect(serializedLog).not.toContain('upstream.example');
    expect(serializedLog).not.toContain('upstream-secret');
    expect(upstreamCalls).toHaveLength(1);
  });

  it('settles native Anthropic cache reads and writes as additional input usage', async () => {
    const chargeQuotes = [];
    const settlements = [];
    const selection = {
      account: {
        id: 'account-anthropic',
        accountKey: 'anthropic-primary',
        baseUrl: 'https://anthropic.example/v1',
        protocol: 'anthropic',
        credentialEnvelope: 'anthropic.envelope',
      },
      upstreamModel: 'claude-opus-4-8',
      routingGroupId: 'group-1',
      lease: { id: 'lease-anthropic', accountId: 'account-anthropic' },
    };
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(_criteria, invoke) {
          const value = await invoke(selection);
          return { value, selection, attempts: 1, postProcessingError: null };
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async settle(value) { settlements.push(value); return { charged: value.chargeAmount }; },
        async release() { throw new Error('unexpected release'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: { open() { return 'upstream-secret'; } },
    };
    const billingPolicy = {
      async quoteReservation() { return { amount: 1, estimatedTokens: 1, snapshot: {} }; },
      async quoteCharge(context) {
        chargeQuotes.push(context);
        return { amount: 0.1, billingMode: 'token', snapshot: {} };
      },
    };
    const fetchImpl = async () => new Response(JSON.stringify({
      id: 'msg-cache',
      type: 'message',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 491,
        cache_read_input_tokens: 25_186,
        cache_creation_input_tokens: 11_155,
        output_tokens: 101,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      billingPolicy,
      fetchImpl,
      requestIdFactory: () => 'request-anthropic-cache',
    })));

    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'public-chat',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(chargeQuotes[0].usage).toMatchObject({
      inputTokens: 36_832,
      cachedInputTokens: 25_186,
      cacheCreationTokens: 11_155,
      outputTokens: 101,
    });
    expect(settlements[0].successLog).toMatchObject({
      input_tokens: 36_832,
      output_tokens: 101,
    });
  });

  it('releases the reservation and returns an explicit 503 when Redis scheduling is unavailable', async () => {
    const releases = [];
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover() {
          throw Object.assign(new Error('Redis down'), { code: 'redis_unavailable', status: 503 });
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async release(value) { releases.push(value); },
        async settle() { throw new Error('unexpected settle'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: { open() { throw new Error('unexpected secret open'); } },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      requestIdFactory: () => 'request-redis-down',
    })));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'hello' }] }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        message: 'Gateway scheduler is temporarily unavailable',
        type: 'service_unavailable',
        code: 'redis_unavailable',
      },
    });
    expect(releases).toEqual([expect.objectContaining({
      userId: 10,
      reservedAmount: 1,
      requestId: 'request-redis-down',
    })]);
  });

  it('returns sanitized capacity reasons and Retry-After for zero-cost requests without leaking upstream account identity', async () => {
    const releases = [];
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover() {
          throw Object.assign(new Error('capacity'), {
            code: 'account_capacity_exhausted',
            status: 503,
            details: { rejections: [
              { accountId: 'secret-concurrency-account', routingGroupId: 'private-group', reason: 'concurrency', retryAfterMs: 0 },
              { accountId: 'secret-rpm-account', reason: 'rpm', retryAfterMs: 2_200 },
              { accountId: 'secret-tpm-account', reason: 'tpm', retryAfterMs: 3_200 },
              { accountId: 'secret-cooldown-account', reason: 'cooldown', retryAfterMs: 4_200 },
            ] },
          });
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async release(value) { releases.push(value); },
        async settle() { throw new Error('unexpected settle'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: { open() { throw new Error('unexpected secret open'); } },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      requestIdFactory: () => 'request-capacity',
      billingPolicy: {
        async quoteReservation() { return { amount: 0, estimatedTokens: 1 }; },
        async quoteCharge() { throw new Error('unexpected charge'); },
      },
    })));

    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'public-chat', input: 'hello' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(payload).toEqual({
      error: {
        message: 'No upstream account is currently available',
        type: 'no_channel',
        code: 'account_capacity_exhausted',
        details: { reasons: ['concurrency', 'rpm', 'tpm', 'cooldown'] },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('secret-');
    expect(JSON.stringify(payload)).not.toContain('private-group');
    expect(releases).toHaveLength(0);
  });

  it('routes every JSON protocol surface with the matching scheduler capability and upstream path', async () => {
    const schedulerCalls = [];
    const upstreamCalls = [];
    const chargeQuotes = [];
    const settlements = [];
    let requestSequence = 0;
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(criteria, invoke) {
          schedulerCalls.push(criteria);
          const selection = {
            account: {
              id: `account-${criteria.protocol}`,
              accountKey: `${criteria.protocol}-key`,
              baseUrl: `https://${criteria.protocol}.upstream.test/v1`,
              protocol: criteria.protocol,
              credentialEnvelope: `${criteria.protocol}.envelope`,
            },
            upstreamModel: `vendor-${criteria.model}`,
            routingGroupId: criteria.groupId,
            lease: { id: `lease-${schedulerCalls.length}`, accountId: `account-${criteria.protocol}` },
          };
          const value = await invoke(selection);
          return { value, selection, attempts: 1, postProcessingError: null };
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async settle(value) { settlements.push(value); },
        async release() { throw new Error('unexpected release'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: {
        open(envelope, { aad }) {
          expect(aad).toContain('upstream_accounts:');
          return `secret-for-${envelope}`;
        },
      },
    };
    const billingPolicy = {
      async quoteReservation() { return { amount: 2, estimatedTokens: 64 }; },
      async quoteCharge(context) {
        chargeQuotes.push(context);
        return { amount: context.imageCount > 0 ? context.imageCount * 3 : 0.25, billingMode: context.imageCount ? 'image' : 'token' };
      },
    };
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      upstreamCalls.push({ url, headers: options.headers, body });
      if (url.endsWith('/messages/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 7 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/messages')) {
        return new Response(JSON.stringify({
          id: 'msg-1', type: 'message', content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 5, output_tokens: 2 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/images/generations')) {
        return new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/embeddings')) {
        return new Response(JSON.stringify({ object: 'list', data: [], usage: { prompt_tokens: 3, total_tokens: 3 } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'resp-1', output: [], usage: { input_tokens: 3, output_tokens: 2 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      billingPolicy,
      fetchImpl,
      requestIdFactory: () => `json-request-${++requestSequence}`,
    })));
    const cases = [
      { route: '/responses', model: 'public-chat', capability: 'responses', protocol: 'openai_compatible' },
      { route: '/embeddings', model: 'public-chat', capability: 'embeddings', protocol: 'openai_compatible' },
      { route: '/messages', model: 'public-chat', capability: 'anthropic_messages', protocol: 'anthropic' },
      { route: '/messages/count_tokens', model: 'public-chat', capability: 'anthropic_count_tokens', protocol: 'anthropic' },
      { route: '/images/generations', model: 'public-image', capability: 'image_generations', protocol: 'openai_compatible' },
    ];

    for (const entry of cases) {
      const response = await fetch(`${baseUrl}${entry.route}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
          ...(entry.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}),
        },
        body: JSON.stringify({
          model: entry.model,
          ...(entry.route === '/images/generations'
            ? { prompt: 'draw a safe test image', n: 1, size: '1024x1024', output_format: 'webp', output_compression: 55 }
            : { input: 'hello', messages: [{ role: 'user', content: 'hello' }] }),
        }),
      });
      expect(response.status, entry.route).toBe(200);
      await response.arrayBuffer();
    }

    expect(schedulerCalls.map(call => ({ capability: call.capability, protocol: call.protocol }))).toEqual(
      cases.map(({ capability, protocol }) => ({ capability, protocol })),
    );
    expect(upstreamCalls.map(call => new URL(call.url).pathname)).toEqual(cases.map(({ route }) => `/v1${route}`));
    expect(upstreamCalls.map(call => call.body.model)).toEqual(cases.map(entry => `vendor-${entry.model}`));
    expect(upstreamCalls[2].headers).toMatchObject({
      'x-api-key': 'secret-for-anthropic.envelope',
      'anthropic-version': '2023-06-01',
    });
    expect(chargeQuotes.at(-1)).toMatchObject({ operation: 'image_generations', imageCount: 1 });
    expect(settlements).toHaveLength(cases.length);
    expect(settlements.at(-1)).toMatchObject({
      chargeAmount: 3,
      successLog: {
        endpoint: 'images/generations', operation: 'image_generations', output_items: 1,
        final_size: '1024x1024', output_format: 'webp', output_compression: 55,
        billing_mode: 'image', total_cost: 3,
      },
    });
  });

  it('rebuilds multipart image bodies for failover and maps transformations onto Responses', async () => {
    const schedulerCalls = [];
    const upstreamCalls = [];
    const chargeQuotes = [];
    const settlements = [];
    let requestSequence = 0;
    const selections = ['first', 'second'].map(name => ({
      account: {
        id: `account-${name}`,
        accountKey: `image-${name}`,
        baseUrl: `https://${name}.image-upstream.test/v1`,
        protocol: 'openai_compatible',
        credentialEnvelope: `${name}.envelope`,
      },
      upstreamModel: `vendor-image-${name}`,
      routingGroupId: 'group-1',
      lease: { id: `lease-${name}`, accountId: `account-${name}` },
    }));
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(criteria, invoke) {
          schedulerCalls.push(criteria);
          try {
            const value = await invoke(selections[0]);
            return { value, selection: selections[0], attempts: 1, postProcessingError: null };
          } catch (error) {
            expect(error.status).toBe(503);
            const value = await invoke(selections[1]);
            return { value, selection: selections[1], attempts: 2, postProcessingError: null };
          }
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async settle(value) { settlements.push(value); },
        async release() { throw new Error('unexpected release'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: {
        open(envelope, { aad }) {
          expect(aad).toMatch(/^upstream_accounts:image-/);
          return `secret-${envelope}`;
        },
      },
    };
    const billingPolicy = {
      async quoteReservation() { return { amount: 4, estimatedTokens: 0 }; },
      async quoteCharge(context) {
        chargeQuotes.push(context);
        return { amount: context.imageCount * 2, billingMode: 'image' };
      },
    };
    let editAttempt = 0;
    const fetchImpl = async (url, options) => {
      const call = { url, body: options.body, headers: options.headers };
      if (options.body instanceof FormData) {
        call.model = options.body.get('model');
        const image = options.body.get('image');
        call.imageBytes = Buffer.from(await image.arrayBuffer()).toString('hex');
      } else {
        call.json = JSON.parse(options.body);
      }
      upstreamCalls.push(call);
      if (url.endsWith('/images/edits') && editAttempt++ === 0) {
        return new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
          status: 503, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        created: 1,
        data: [{ b64_json: 'aW1hZ2U=' }],
        ...(url.endsWith('/responses') ? { output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }] } : {}),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      billingPolicy,
      fetchImpl,
      requestIdFactory: () => `multipart-request-${++requestSequence}`,
    })));
    const cases = [
      { route: '/images/edits', capability: 'image_edits', prompt: 'edit this' },
      { route: '/images/variations', capability: 'image_variations' },
      { route: '/images/transformations', capability: 'image_transformations', prompt: 'transform this' },
    ];

    for (const entry of cases) {
      const form = new FormData();
      form.append('model', 'public-image');
      if (entry.prompt) form.append('prompt', entry.prompt);
      form.append('image', new Blob([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ], { type: 'image/png' }), 'input.png');
      const response = await fetch(`${baseUrl}${entry.route}`, {
        method: 'POST', headers: { Authorization: 'Bearer sk-test' }, body: form,
      });
      expect(response.status, entry.route).toBe(200);
      await response.arrayBuffer();
    }

    expect(schedulerCalls.map(call => call.capability)).toEqual(cases.map(entry => entry.capability));
    const editCalls = upstreamCalls.filter(call => call.url.endsWith('/images/edits'));
    expect(editCalls).toHaveLength(2);
    expect(editCalls[0].body).not.toBe(editCalls[1].body);
    expect(editCalls.map(call => call.model)).toEqual(['vendor-image-first', 'vendor-image-second']);
    const expectedPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('hex');
    expect(editCalls.map(call => call.imageBytes)).toEqual([expectedPngHeader, expectedPngHeader]);
    expect(upstreamCalls.find(call => call.url.endsWith('/images/variations')).model).toBe('vendor-image-first');
    const transformation = upstreamCalls.find(call => call.url.endsWith('/responses'));
    expect(transformation.json).toMatchObject({
      model: 'vendor-image-first',
      tools: [{ type: 'image_generation', model: 'vendor-image-first', action: 'edit' }],
    });
    expect(chargeQuotes).toHaveLength(3);
    expect(chargeQuotes.every(quote => quote.imageCount === 1)).toBe(true);
    expect(settlements).toHaveLength(3);
    expect(JSON.stringify(settlements)).not.toContain('aW1hZ2U=');
    expect(JSON.stringify(settlements)).not.toContain('image-upstream.test');
  });

  it('forwards a definitive upstream 4xx unchanged and releases the reservation', async () => {
    const releases = [];
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(_criteria, invoke) {
          return invoke({
            account: {
              id: 'account-4xx', accountKey: 'account-4xx', baseUrl: 'https://upstream.test/v1',
              protocol: 'openai_compatible', credentialEnvelope: '4xx.envelope',
            },
            upstreamModel: 'vendor-chat',
            lease: { id: 'lease-4xx', accountId: 'account-4xx' },
          });
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async release(value) { releases.push(value); },
        async settle() { throw new Error('unexpected settle'); },
        async markPending() { throw new Error('unexpected pending'); },
      },
      secretBox: { open() { return 'upstream-secret'; } },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      requestIdFactory: () => 'request-4xx',
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: 'prompt rejected', type: 'invalid_request_error' },
      }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'upstream-4xx' } }),
    })));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'bad prompt' }] }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('upstream-4xx');
    expect(await response.json()).toEqual({
      error: { message: 'prompt rejected', type: 'invalid_request_error' },
    });
    expect(releases).toEqual([expect.objectContaining({
      userId: 10, reservedAmount: 1, requestId: 'request-4xx',
    })]);
  });

  it('keeps the reservation and marks reconciliation pending after an uncertain transport timeout', async () => {
    const pending = [];
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(_criteria, invoke) {
          return invoke({
            account: {
              id: 'account-timeout', accountKey: 'account-timeout', baseUrl: 'https://sensitive-upstream.test/v1',
              protocol: 'openai_compatible', credentialEnvelope: 'timeout.envelope',
            },
            upstreamModel: 'vendor-chat',
            lease: { id: 'lease-timeout', accountId: 'account-timeout' },
          });
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async markPending(value) { pending.push(value); },
        async release() { throw new Error('unexpected release'); },
        async settle() { throw new Error('unexpected settle'); },
      },
      secretBox: { open() { return 'upstream-secret'; } },
    };
    const timeoutError = Object.assign(new Error('timeout for https://sensitive-upstream.test/private'), {
      code: 'ETIMEDOUT',
    });
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      requestIdFactory: () => 'request-timeout',
      fetchImpl: async () => { throw timeoutError; },
    })));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'private timeout prompt' }] }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { type: 'settlement_pending' } });
    expect(pending).toEqual([expect.objectContaining({
      userId: 10,
      reservedAmount: 1,
      requestId: 'request-timeout',
      log: expect.objectContaining({
        request_id: 'request-timeout', status: 'settlement_pending',
        error_type: 'upstream_state_unknown',
      }),
    })]);
    const serialized = JSON.stringify(pending[0].log);
    expect(serialized).not.toContain('private timeout prompt');
    expect(serialized).not.toContain('sensitive-upstream.test');
    expect(serialized).not.toContain('upstream-secret');
  });

  it('keeps the reservation when a Redis release error wraps an uncertain upstream execution', async () => {
    const pending = [];
    const releases = [];
    const uncertain = Object.assign(new Error('upstream may have completed'), {
      code: 'ETIMEDOUT', executionUncertain: true,
    });
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover() {
          throw Object.assign(new Error('lease release failed'), {
            code: 'redis_unavailable', status: 503, cause: uncertain,
          });
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async markPending(value) { pending.push(value); },
        async release(value) { releases.push(value); },
        async settle() { throw new Error('unexpected settle'); },
      },
      secretBox: { open() { return 'unused'; } },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      requestIdFactory: () => 'request-wrapped-timeout',
    })));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'hello' }] }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { type: 'settlement_pending' } });
    expect(releases).toEqual([]);
    expect(pending).toEqual([expect.objectContaining({
      requestId: 'request-wrapped-timeout',
      log: expect.objectContaining({ error_type: 'upstream_state_unknown' }),
    })]);
  });

  it('forwards SSE unchanged while settling only from final stream usage', async () => {
    const schedulerCalls = [];
    const reservations = [];
    const settlements = [];
    const chargeQuotes = [];
    const upstreamBodies = [];
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(criteria, invoke) {
          schedulerCalls.push(criteria);
          const selection = {
            account: {
              id: `stream-${criteria.protocol}`,
              accountKey: `stream-${criteria.protocol}`,
              baseUrl: 'https://stream.test/v1',
              protocol: criteria.protocol,
              credentialEnvelope: 'stream.envelope',
            },
            upstreamModel: 'vendor-stream',
            lease: { id: `lease-${criteria.protocol}`, accountId: `stream-${criteria.protocol}` },
          };
          return { value: await invoke(selection), selection, attempts: 1, postProcessingError: null };
        },
      },
      usageSettlement: {
        async reserve(value) { reservations.push(value); },
        async release() {},
        async settle(value) { settlements.push(value); },
        async markPending() {},
      },
      secretBox: { open() { return 'stream-secret'; } },
    };
    const streams = {
      '/chat/completions': [
        'data: {"id":"chat-stream","choices":[]}\n\n',
        'data: {"id":"chat-stream","choices":[],"usage":{"prompt_tokens":11813,"prompt_tokens_details":{"cached_tokens":10752},"completion_tokens":1483}}\n\n',
        'data: [DONE]\n\n',
      ].join(''),
      '/responses': 'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-stream","usage":{"input_tokens":8,"output_tokens":3}}}\n\n',
      '/messages': [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":491,"cache_read_input_tokens":25000,"cache_creation_input_tokens":11155,"cache_creation_5m_input_tokens":11155,"output_tokens":0}}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":null,"cache_read_input_tokens":25186,"cache_creation_input_tokens":null,"output_tokens":101}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(''),
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      billingPolicy: {
        async quoteReservation() { return { amount: 1, estimatedTokens: 10 }; },
        async quoteCharge(context) { chargeQuotes.push(context); return { amount: 0.1 }; },
      },
      fetchImpl: async (url, options) => {
        upstreamBodies.push(JSON.parse(options.body));
        const path = new URL(url).pathname.replace('/v1', '');
        return new Response(streams[path], { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    })));

    for (const route of ['/chat/completions', '/responses', '/messages']) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'public-chat', stream: true, messages: [] }),
      });
      expect(response.status, route).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(await response.text()).toBe(streams[route]);
    }
    expect(reservations).toHaveLength(3);
    expect(settlements).toHaveLength(3);
    expect(schedulerCalls).toHaveLength(3);
    expect(upstreamBodies[0].stream_options).toEqual({ include_usage: true });
    expect(chargeQuotes.map(quote => quote.usage)).toEqual([
      expect.objectContaining({ inputTokens: 11_813, cachedInputTokens: 10_752, outputTokens: 1_483 }),
      expect.objectContaining({ inputTokens: 8, outputTokens: 3 }),
      expect.objectContaining({
        inputTokens: 36_832,
        cachedInputTokens: 25_186,
        cacheCreationTokens: 11_155,
        cacheCreation5mTokens: 11_155,
        outputTokens: 101,
      }),
    ]);
  });

  it('delivers stream chunks before the upstream response completes', async () => {
    const delivered = [];
    let releaseFinalChunk;
    const waitForFinalChunk = new Promise(resolve => { releaseFinalChunk = resolve; });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"first"}\n\n'));
        void waitForFinalChunk.then(() => {
          controller.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'));
          controller.close();
        });
      },
    });
    const execution = executeJsonUpstream({
      fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      selection: {
        account: {
          accountKey: 'stream-live', baseUrl: 'https://stream.test/v1', protocol: 'openai_compatible',
          credentialEnvelope: 'stream.envelope',
        },
        upstreamModel: 'vendor-stream',
      },
      secretBox: { open: () => 'stream-secret' },
      path: 'chat/completions',
      body: { model: 'public-chat', stream: true },
      requestHeaders: {},
      timeoutMs: 2_000,
      stream: true,
      onStreamChunk: chunk => delivered.push(chunk.toString('utf8')),
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(delivered).toEqual(['data: {"id":"first"}\n\n']);
    let completed = false;
    void execution.then(() => { completed = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(completed).toBe(false);

    releaseFinalChunk();
    const snapshot = await execution;
    expect(delivered).toHaveLength(2);
    expect(snapshot.streamed).toBe(true);
    expect(snapshot.body.toString('utf8')).toContain('prompt_tokens');
  });

  it('cancels the upstream reader and aborts fetch when the downstream client disconnects', async () => {
    let upstreamSignal;
    let cancelReason;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"first"}\n\n'));
      },
      cancel(reason) { cancelReason = reason; },
    });
    const disconnected = new Error('Client disconnected during upstream streaming');
    disconnected.code = 'CLIENT_DISCONNECTED';

    const execution = executeJsonUpstream({
      fetchImpl: async (_url, options) => {
        upstreamSignal = options.signal;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
      selection: {
        account: {
          accountKey: 'stream-cancel', baseUrl: 'https://stream.test/v1', protocol: 'openai_compatible',
          credentialEnvelope: 'stream.envelope',
        },
        upstreamModel: 'vendor-stream',
      },
      secretBox: { open: () => 'stream-secret' },
      path: 'chat/completions',
      body: { model: 'public-chat', stream: true },
      requestHeaders: {},
      timeoutMs: 2_000,
      stream: true,
      onStreamChunk: () => { throw disconnected; },
    });

    await expect(execution).rejects.toMatchObject({
      name: 'UpstreamTransportError', executionUncertain: true, responseStarted: true,
      cause: { code: 'CLIENT_DISCONNECTED' },
    });
    expect(upstreamSignal.aborted).toBe(true);
    expect(cancelReason).toBe(disconnected);
  });

  it('forwards a completed response without usage only after marking its reservation pending', async () => {
    const pending = [];
    const selection = {
      account: {
        id: 'account-no-usage', accountKey: 'no-usage', baseUrl: 'https://upstream.test/v1',
        protocol: 'openai_compatible', credentialEnvelope: 'no-usage.envelope',
      },
      upstreamModel: 'vendor-chat',
      lease: { id: 'lease-no-usage', accountId: 'account-no-usage' },
    };
    const runtime = {
      mode: 'postgres_redis',
      gatewayScheduler: {
        async executeWithFailover(_criteria, invoke) {
          return { value: await invoke(selection), selection, attempts: 1, postProcessingError: null };
        },
      },
      usageSettlement: {
        async reserve(value) { return { reserved: value.amount }; },
        async markPending(value) { pending.push(value); },
        async release() { throw new Error('unexpected release'); },
        async settle() { throw new Error('unexpected settle'); },
      },
      secretBox: { open() { return 'secret'; } },
    };
    const baseUrl = await listen(createPostgresProxyRouter(baseOptions({
      runtime,
      requestIdFactory: () => 'request-no-usage',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'chat-no-usage', choices: [{ message: { role: 'assistant', content: 'done' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    })));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'public-chat', messages: [{ role: 'user', content: 'hello' }] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-settlement-status')).toBe('pending');
    expect(await response.json()).toMatchObject({ id: 'chat-no-usage' });
    expect(pending).toEqual([expect.objectContaining({
      userId: 10, reservedAmount: 1, requestId: 'request-no-usage',
      log: expect.objectContaining({ error_type: 'usage_missing', status: 'settlement_pending' }),
    })]);
  });
});
