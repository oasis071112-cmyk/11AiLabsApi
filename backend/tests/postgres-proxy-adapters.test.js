import { describe, expect, it, vi } from 'vitest';
import {
  PostgresProxyBillingPolicy,
  PostgresProxyRepository,
} from '../src/modules/postgres-proxy/postgres-adapters.js';

describe('PostgreSQL public proxy adapters', () => {
  it('lists only models already authorized by the API-key identity', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            model_code: 'public-chat',
            provider: 'openai',
            effective_capabilities: { chat_completions: true },
            created_at: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
    };
    const repository = new PostgresProxyRepository(pool);

    const result = await repository.listModels({ allowedModels: ['public-chat'] });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('m.model_code=ANY($1::text[])'),
      [['public-chat'], null],
    );
    expect(result).toEqual([{
      id: 'public-chat',
      object: 'model',
      created: 1_785_542_400,
      owned_by: 'openai',
      capabilities: { chat_completions: true },
    }]);
  });

  it('checks configured model capability inside the API key routing group', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ supported: false }] }) };
    const repository = new PostgresProxyRepository(pool);

    const supported = await repository.supportsCapability(
      { routingGroupId: 7 },
      'public-image',
      'image_transformations',
    );

    expect(supported).toBe(false);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("ua.capabilities ? $3"),
      ['public-image', 7, 'image_transformations'],
    );
  });

  it('quotes token reservations and settles using catalog prices and group multipliers', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'public-chat',
          model_type: 'llm',
          context_length: 8_192,
          metadata: {
            official_input_price: 10,
            official_output_price: 20,
            official_cached_input_price: 1,
          },
          official_currency: 'USD',
          official_input_price: null,
          official_output_price: null,
          official_cached_input_price: null,
          official_unit_tokens: 1_000_000,
          input_multiplier: 2,
          output_multiplier: 3,
          image_multiplier: 1,
          billing_mode: 'token',
          rule: {},
          usd_cny_rate: 7,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);
    const context = {
      identity: { routingGroupId: 7 },
      operation: 'chat_completions',
      model: 'public-chat',
      request: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 },
    };

    const reservation = await policy.quoteReservation(context);
    const charge = await policy.quoteCharge({
      ...context,
      usage: { inputTokens: 1_000, outputTokens: 500 },
    });
    const mappedCharge = await policy.quoteCharge({
      ...context,
      usage: { inputTokens: 1_000, outputTokens: 500 },
      selection: {
        account: {
          modelMappings: [{
            model: 'public-chat',
            configuration: { input_price: 0.000003, output_price: 0.000008 },
          }],
        },
      },
    });

    expect(reservation.amount).toBeGreaterThan(0);
    expect(reservation.estimatedTokens).toBeGreaterThan(100);
    expect(charge.amount).toBeCloseTo(0.35, 10);
    expect(mappedCharge.amount).toBeCloseTo(0.126, 10);
    expect(charge).toMatchObject({
      billingMode: 'token',
      snapshot: {
        input_price: 0.00001,
        output_price: 0.00002,
        input_multiplier: 2,
        output_multiplier: 3,
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM models m'), ['public-chat', 7, null]);
  });

  it('applies active pricing rules in user, routing-group, then platform priority order', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'priority-chat', model_type: 'llm', metadata: {},
          official_currency: 'USD', official_input_price: 10, official_output_price: 20,
          official_cached_input_price: 1, official_unit_tokens: 1_000_000,
          input_multiplier: 2, output_multiplier: 3, image_multiplier: null,
          platform_billing_mode: 'token',
          platform_rule: {
            billing_multiplier_input: 1.1,
            billing_multiplier_output: 1.2,
            billing_multiplier_image: 1.3,
          },
          user_billing_mode: null,
          user_rule: { billing_multiplier_input: 4 },
          usd_cny_rate: 7,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const loaded = await policy.loadPolicy('priority-chat', 7, 42);

    expect(loaded.multipliers).toEqual({ input: 4, output: 3, image: 1.3 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/scope_type[\s\S]*priority[\s\S]*start_time[\s\S]*end_time/i),
      ['priority-chat', 7, 42],
    );
  });

  it('settles against the actual fallback group and selected account mapping', async () => {
    const pool = {
      query: vi.fn(async (_sql, parameters) => ({
        rows: [{
          model_code: 'fallback-chat',
          model_type: 'llm',
          context_length: 8_192,
          metadata: {},
          official_currency: 'USD',
          official_input_price: 10,
          official_output_price: 20,
          official_cached_input_price: 1,
          official_unit_tokens: 1_000_000,
          input_multiplier: parameters[1] === 19 ? 4 : 1,
          output_multiplier: parameters[1] === 19 ? 5 : 1,
          image_multiplier: 1,
          billing_mode: 'token',
          rule: {},
          usd_cny_rate: 7,
        }],
      })),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 7 },
      operation: 'chat_completions',
      model: 'fallback-chat',
      request: {},
      usage: { inputTokens: 1_000, outputTokens: 500 },
      selection: {
        routingGroupId: 19,
        account: {
          modelMappings: [{
            model: 'fallback-chat',
            configuration: { input_price: 0.000002, output_price: 0.000004 },
          }],
        },
      },
    });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM models m'), ['fallback-chat', 19, null]);
    expect(charge).toMatchObject({
      billingMode: 'token',
      snapshot: {
        input_price: 0.000002,
        output_price: 0.000004,
        input_multiplier: 4,
        output_multiplier: 5,
      },
    });
    expect(charge.amount).toBeCloseTo(0.126, 10);
  });

  it('uses official cache prices and snapshots OpenAI cache usage dimensions', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'gpt-5.6-sol', model_type: 'llm', context_length: 128_000,
          official_provider: 'openai', metadata: {},
          official_currency: 'USD', official_input_price: 5, official_output_price: 30,
          official_cached_input_price: 0.5, official_unit_tokens: 1_000_000,
          input_multiplier: 0.2, output_multiplier: 0.2, image_multiplier: 1,
          billing_mode: 'token', rule: {}, usd_cny_rate: 6.7513,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 7 },
      operation: 'chat_completions',
      model: 'gpt-5.6-sol',
      request: {},
      usage: { inputTokens: 11_813, cachedInputTokens: 10_752, outputTokens: 1_483 },
      selection: {
        account: {
          modelMappings: [{
            model: 'gpt-5.6-sol',
            configuration: {
              input_price: 0.000005,
              output_price: 0.00003,
              cache_read_price: 0.000001,
            },
          }],
        },
      },
    });

    expect(charge.amount).toBeCloseTo(0.07449519446, 12);
    expect(charge.snapshot).toMatchObject({
      snapshot_version: 2,
      input_price: 0.000005,
      cached_input_price: 0.0000005,
      output_price: 0.00003,
      usage: {
        input_tokens: 11_813,
        uncached_input_tokens: 1_061,
        cached_input_tokens: 10_752,
        cache_creation_tokens: 0,
        output_tokens: 1_483,
      },
    });
  });

  it('uses the official GPT-5.6 cache-write derivation before channel cache prices', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'gpt-5.6-sol', model_type: 'llm', context_length: 128_000,
          official_provider: 'openai', metadata: {},
          official_currency: 'USD', official_input_price: 5, official_output_price: 30,
          official_cached_input_price: 0.5, official_unit_tokens: 1_000_000,
          input_multiplier: 0.2, output_multiplier: 0.2, image_multiplier: 1,
          billing_mode: 'token', rule: {}, usd_cny_rate: 6.7513,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 7 },
      operation: 'chat_completions',
      model: 'gpt-5.6-sol',
      request: {},
      usage: { inputTokens: 100, cacheCreationTokens: 100, outputTokens: 0 },
      selection: {
        account: {
          modelMappings: [{
            model: 'gpt-5.6-sol',
            configuration: { input_price: 0.000008, cache_write_price: 0.000009 },
          }],
        },
      },
    });

    expect(charge.snapshot.cache_creation_price).toBeCloseTo(0.00000625, 12);
    expect(charge.amount).toBeCloseTo(0.0008439125, 12);
  });

  it('falls back to PostgreSQL channel cache prices when official cache prices are missing', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'fallback-cache', model_type: 'llm', context_length: 128_000,
          official_provider: 'openai', metadata: {},
          official_currency: 'USD', official_input_price: 5, official_output_price: 30,
          official_cached_input_price: 0, official_unit_tokens: 1_000_000,
          input_multiplier: 1, output_multiplier: 1, image_multiplier: 1,
          billing_mode: 'token', rule: {}, usd_cny_rate: 7,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 7 },
      operation: 'chat_completions',
      model: 'fallback-cache',
      request: {},
      usage: { inputTokens: 200, cachedInputTokens: 100, cacheCreationTokens: 100 },
      selection: {
        account: {
          modelMappings: [{
            model: 'fallback-cache',
            configuration: { cache_read_price: 0.000001, cache_write_price: 0.000007 },
          }],
        },
      },
    });

    expect(charge.snapshot).toMatchObject({
      cached_input_price: 0.000001,
      cache_creation_price: 0.000007,
    });
    expect(charge.amount).toBeCloseTo(0.0056, 12);
  });

  it('uses official Anthropic cache-write pricing and snapshots every cache bucket', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'claude-opus-4-8', model_type: 'llm', context_length: 128_000,
          official_provider: 'anthropic', metadata: {},
          official_currency: 'USD', official_input_price: 5, official_output_price: 25,
          official_cached_input_price: 0.5, official_unit_tokens: 1_000_000,
          input_multiplier: 0.15, output_multiplier: 0.15, image_multiplier: 1,
          billing_mode: 'token', rule: {}, usd_cny_rate: 6.7513,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 7 },
      operation: 'anthropic_messages',
      model: 'claude-opus-4-8',
      request: {},
      usage: {
        inputTokens: 36_832,
        cachedInputTokens: 25_186,
        cacheCreationTokens: 11_155,
        cacheCreation5mTokens: 11_155,
        outputTokens: 101,
      },
      selection: {
        account: {
          modelMappings: [{
            model: 'claude-opus-4-8',
            configuration: { cache_read_price: 0.000001, cache_write_price: 0.000005 },
          }],
        },
      },
    });

    expect(charge.amount).toBeCloseTo(0.088399918766, 12);
    expect(charge.snapshot).toMatchObject({
      snapshot_version: 2,
      cached_input_price: 0.0000005,
      cache_creation_5m_price: 0.00000625,
      cache_creation_1h_price: 0.00001,
      usage: {
        input_tokens: 36_832,
        uncached_input_tokens: 491,
        cached_input_tokens: 25_186,
        cache_creation_tokens: 11_155,
        cache_creation_5m_tokens: 11_155,
        cache_creation_1h_tokens: 0,
        output_tokens: 101,
      },
    });
    expect(charge.snapshot.cache_creation_price).toBeCloseTo(0.00000625, 12);
  });

  it('rejects a token reservation when no positive catalog price exists', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'unpriced-model', model_type: 'llm', metadata: {}, rule: {},
          official_currency: 'USD', official_input_price: 0, official_output_price: 0,
          official_cached_input_price: 0, official_unit_tokens: 1_000_000,
          input_multiplier: 1, output_multiplier: 1, image_multiplier: 1,
          billing_mode: 'token', usd_cny_rate: 7,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    await expect(policy.quoteReservation({
      identity: { routingGroupId: 7 },
      operation: 'chat_completions',
      model: 'unpriced-model',
      request: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 10 },
    })).rejects.toMatchObject({ code: 'pricing_unavailable', status: 503 });
  });

  it('uses the highest eligible account-mapping token price for a conservative reservation', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'mapped-only', model_type: 'llm', context_length: 4096, metadata: {}, rule: {},
          official_currency: 'USD', official_input_price: 0, official_output_price: 0,
          official_cached_input_price: 0, official_unit_tokens: 1_000_000,
          input_multiplier: 1, output_multiplier: 1, image_multiplier: 1,
          billing_mode: 'token', usd_cny_rate: 7,
          candidate_configurations: [
            { input_price: 0.000002, output_price: 0.000004 },
            { input_price: 0.000006, output_price: 0.000009 },
          ],
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const reservation = await policy.quoteReservation({
      identity: { routingGroupId: 7 }, operation: 'chat_completions', model: 'mapped-only',
      request: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 },
    });

    expect(reservation.amount).toBeGreaterThan(0);
    expect(reservation.snapshot).toMatchObject({
      mode: 'token', input_price: 0.000006, output_price: 0.000009, unit_tokens: 1,
    });
  });

  it('quotes image output by actual image count, tier and image multiplier', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'public-image',
          model_type: 'image',
          context_length: null,
          metadata: { official_image_prices: { '1K': 0.1, '2K': 0.2 } },
          official_currency: 'USD',
          official_input_price: null,
          official_output_price: null,
          official_cached_input_price: null,
          official_unit_tokens: null,
          input_multiplier: 1,
          output_multiplier: 1,
          image_multiplier: 2,
          billing_mode: 'image',
          rule: {},
          usd_cny_rate: 7,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 9 },
      operation: 'image_edits',
      model: 'public-image',
      request: { size: '1K' },
      imageCount: 2,
      response: { data: [{ width: 2048, height: 1024 }, { width: 2048, height: 1024 }] },
    });

    expect(charge.amount).toBeCloseTo(5.6, 10);
    expect(charge).toMatchObject({
      billingMode: 'image',
      snapshot: {
        size: '2K',
        input_size: '1K',
        output_size: '2048x1024',
        size_source: 'output',
        image_count: 2,
        unit_price: 0.2,
        currency: 'USD',
        multiplier: 2,
      },
    });
  });

  it('charges every output at the highest confirmed tier for a mixed-size request', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'public-image', model_type: 'image', context_length: null,
          metadata: { official_image_prices: { '1K': 0.1, '4K': 0.4 } },
          official_currency: 'USD', official_input_price: null, official_output_price: null,
          official_cached_input_price: null, official_unit_tokens: null,
          input_multiplier: 1, output_multiplier: 1, image_multiplier: 2,
          billing_mode: 'image', rule: {}, usd_cny_rate: 7,
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const charge = await policy.quoteCharge({
      identity: { routingGroupId: 9 }, operation: 'image_generations', model: 'public-image',
      request: { size: 'auto' }, imageCount: 2,
      response: { data: [{ width: 1024, height: 1024 }, { width: 3840, height: 2160 }] },
    });

    expect(charge.amount).toBeCloseTo(7, 10);
    expect(charge.snapshot).toMatchObject({
      size: '4K', image_count: 2, output_size_breakdown: { '1K': 1, '4K': 1 },
      size_breakdown: { '1K': 1, '4K': 1 },
      tier_charges: {
        '1K': { image_count: 1, unit_price: 0.1 },
        '4K': { image_count: 1, unit_price: 0.4 },
      },
    });
    expect(charge.snapshot.tier_charges['1K'].total_cost).toBeCloseTo(1.4, 10);
    expect(charge.snapshot.tier_charges['4K'].total_cost).toBeCloseTo(5.6, 10);
  });

  it('prefreezes image output from the highest eligible mapping price when catalog pricing is absent', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          model_code: 'mapped-image', model_type: 'image', metadata: {}, rule: {},
          official_currency: 'USD', official_input_price: null, official_output_price: null,
          official_cached_input_price: null, official_unit_tokens: null,
          input_multiplier: 1, output_multiplier: 1, image_multiplier: 1.5,
          billing_mode: 'image', usd_cny_rate: 7,
          candidate_configurations: [
            { billing_mode: 'image', image_price_1k: 0.03 },
            { billing_mode: 'image', image_price_1k: 0.2 },
          ],
        }],
      }),
    };
    const policy = new PostgresProxyBillingPolicy(pool);

    const reservation = await policy.quoteReservation({
      identity: { routingGroupId: 9 }, operation: 'image_edits', model: 'mapped-image',
      request: { size: '1K', n: 2 },
    });

    expect(reservation.amount).toBeCloseTo(4.2, 10);
    expect(reservation.snapshot).toMatchObject({ unit_price: 0.2, size: '1K', image_count: 2, multiplier: 1.5 });
  });
});
