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
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM models m'), ['public-chat', 7]);
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

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM models m'), ['fallback-chat', 19]);
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

    expect(charge.amount).toBeCloseTo(11.2, 10);
    expect(charge.snapshot).toMatchObject({
      size: '4K', image_count: 2, output_size_breakdown: { '1K': 1, '4K': 1 },
      size_breakdown: { '4K': 2 },
      tier_charges: {
        '4K': { image_count: 2, unit_price: 0.4 },
      },
    });
    expect(charge.snapshot.tier_charges['4K'].total_cost).toBeCloseTo(11.2, 10);
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
