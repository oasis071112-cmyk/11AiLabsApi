import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  calculateImagePricing,
  calculatePricing,
  extractUsage,
  mergeUsage,
  resolveImageUnitPrice,
} from '../src/utils/pricing-engine.js';

const require = createRequire(import.meta.url);
const { channelTokenOfficial } = require('../src/utils/billing-policy.js');

describe('官方定价换算与用户扣费', () => {
  it('美元官方价应先换算为人民币点数，再应用用户倍率', () => {
    const result = calculatePricing({
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      official: { currency: 'USD', input: 5, output: 30, unitTokens: 1_000_000 },
      multipliers: { input: 0.88, output: 0.88 },
      usdCnyRate: 7,
    });

      expect(result.userCostPoints).toBeCloseTo(400.4, 8);
  });

  it('人民币官方价不应重复换汇，缓存输入使用独立单价', () => {
    const result = calculatePricing({
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 1_000_000,
      official: { currency: 'CNY', input: 2, cachedInput: 0.5, output: 8, unitTokens: 1_000_000 },
      multipliers: { input: 1.2, output: 1.2 },
      usdCnyRate: 7,
    });

      expect(result.userCostPoints).toBeCloseTo(11.28, 8);
  });

  it('图片计费按真实张数、尺寸单价、图片倍率和汇率结算', () => {
    const result = calculateImagePricing({
      imageCount: 2,
      unitPrice: 0.04,
      currency: 'USD',
      multiplier: 1.2,
      usdCnyRate: 7,
    });

    expect(result.userCostPoints).toBeCloseTo(0.672, 8);
    expect(result.officialCostCny).toBeCloseTo(0.56, 8);
    expect(result.image).toMatchObject({
      imageCount: 2,
      unitPrice: 0.04,
      multiplier: 1.2,
    });
  });

  it('图片未配置价格时使用 Sub2API 默认价和尺寸倍率', () => {
    expect(resolveImageUnitPrice({ serializedPrices: '{}', sizeTier: '1K' })).toBeCloseTo(0.031, 8);
    expect(resolveImageUnitPrice({ serializedPrices: '{}', sizeTier: '2K' })).toBeCloseTo(0.0465, 8);
    expect(resolveImageUnitPrice({ serializedPrices: '{}', sizeTier: '4K' })).toBeCloseTo(0.062, 8);
  });

  it('图片显式档位价格优先于 Sub2API 默认价', () => {
    const prices = JSON.stringify({ '1K': 0.1, '2K': 0.15, '4K': 0.3 });
    expect(resolveImageUnitPrice({ serializedPrices: prices, sizeTier: '2K' })).toBe(0.15);
  });

  it('token 计费把普通、缓存和图片 token 拆成互斥桶', () => {
    const result = calculatePricing({
      modelCode: 'gpt-5.4-mini',
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      cacheCreationTokens: 100_000,
      imageInputTokens: 100_000,
      outputTokens: 300_000,
      imageOutputTokens: 100_000,
      official: {
        currency: 'CNY',
        input: 2,
        imageInput: 4,
        cachedInput: 0.5,
        cacheCreation: 2.5,
        output: 8,
        imageOutput: 10,
        unitTokens: 1_000_000,
      },
      multipliers: { input: 1, output: 1 },
    });

    expect(result.userCostPoints).toBeCloseTo(4.55, 8);
    expect(result.official).toMatchObject({
      textInputTokens: 600_000,
      imageInputTokens: 100_000,
      cachedInputTokens: 200_000,
      cacheCreationTokens: 100_000,
      textOutputTokens: 200_000,
      imageOutputTokens: 100_000,
    });
  });

  it('priority 和 flex 使用 Sub2API 的服务层倍率', () => {
    const common = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      official: { currency: 'CNY', input: 2, output: 8, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
    };
    expect(calculatePricing({ ...common, serviceTier: 'priority' }).userCostPoints).toBeCloseTo(20, 8);
    expect(calculatePricing({ ...common, serviceTier: 'flex' }).userCostPoints).toBeCloseTo(5, 8);
  });

  it('GPT-5.4 长上下文按 Sub2API 阈值和倍率计费', () => {
    const result = calculatePricing({
      modelCode: 'gpt-5.4',
      inputTokens: 300_000,
      outputTokens: 100_000,
      official: { currency: 'CNY', input: 2, output: 10, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
    });
    expect(result.userCostPoints).toBeCloseTo(2.7, 8);
    expect(result.longContextBillingApplied).toBe(true);
  });

  it('GPT-5.5 后缀型号沿用长上下文规则，GPT-5.4 mini 不使用', () => {
    const common = {
      inputTokens: 300_000,
      outputTokens: 100_000,
      official: { currency: 'CNY', input: 2, output: 10, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
    };
    expect(calculatePricing({ ...common, modelCode: 'gpt-5.5-20260701' }).longContextBillingApplied).toBe(true);
    expect(calculatePricing({ ...common, modelCode: 'gpt-5.4-mini-20260701' }).longContextBillingApplied).toBe(false);
  });

  it('GPT-5.6 缺少缓存创建价时回退到输入价的 1.25 倍', () => {
    const result = calculatePricing({
      modelCode: 'gpt-5.6',
      inputTokens: 100_000,
      cacheCreationTokens: 100_000,
      official: { currency: 'CNY', input: 2, output: 10, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
    });
    expect(result.userCostPoints).toBeCloseTo(0.25, 8);
  });

  it('Anthropic 缓存写入按 5 分钟与 1 小时独立价格结算', () => {
    const result = calculatePricing({
      inputTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
      cacheCreation5mTokens: 600_000,
      cacheCreation1hTokens: 400_000,
      official: {
        currency: 'USD',
        input: 5,
        cacheCreation: 6.25,
        cacheCreation5m: 6.25,
        cacheCreation1h: 10,
        output: 25,
        unitTokens: 1_000_000,
      },
      multipliers: { input: 1, output: 1 },
      usdCnyRate: 7,
    });

    expect(result.userCostPoints).toBeCloseTo(54.25, 8);
    expect(result.official).toMatchObject({
      cacheCreation5mTokens: 600_000,
      cacheCreation1hTokens: 400_000,
      cacheCreation5mCost: 26.25,
      cacheCreation1hCost: 28,
      cacheCreationEffectivePrice: 7.75,
    });
  });

  it('Anthropic 缓存 TTL 价格只作用于原生 Anthropic 渠道', () => {
    const model = {
      model_code: 'claude-test',
      official_provider: 'anthropic',
      official_currency: 'USD',
      official_input_price: 1,
      official_cached_input_price: 0.1,
      official_output_price: 2,
      official_unit_tokens: 1_000_000,
    };
    const openAiCompatible = channelTokenOfficial(model, {
      protocol_type: 'openai_compatible',
    });
    const nativeAnthropic = channelTokenOfficial(model, {
      protocol_type: 'anthropic',
    });

    expect(openAiCompatible.cacheCreation).toBeCloseTo(0.000001, 12);
    expect(openAiCompatible).not.toHaveProperty('cacheCreation5m');
    expect(nativeAnthropic.cacheCreation5m).toBeCloseTo(0.00000125, 12);
    expect(nativeAnthropic.cacheCreation1h).toBeCloseTo(0.000002, 12);
  });

  it('解析上游 usage 时保留 Sub2API 使用的缓存和图片 token 桶', () => {
    expect(extractUsage({
      input_tokens: 1000,
      output_tokens: 500,
      input_tokens_details: { cached_tokens: 200, image_tokens: 50 },
      output_tokens_details: { image_tokens: 80 },
      cache_creation_input_tokens: 100,
    })).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
      cacheCreationTokens: 100,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      imageInputTokens: 50,
      imageOutputTokens: 80,
    });
  });

  it('缓存创建总量缺失时合并 5 分钟和 1 小时缓存写入桶', () => {
    expect(extractUsage({
      input_tokens: 1000,
      input_tokens_details: {
        cache_creation_5m_tokens: 120,
        cache_creation_1h_tokens: 80,
      },
    }).cacheCreationTokens).toBe(200);
  });

  it('解析 Anthropic 新版嵌套缓存创建明细', () => {
    expect(extractUsage({
      input_tokens: 1000,
      cache_creation: {
        ephemeral_5m_input_tokens: 120,
        ephemeral_1h_input_tokens: 80,
      },
    })).toMatchObject({
      cacheCreationTokens: 200,
      cacheCreation5mTokens: 120,
      cacheCreation1hTokens: 80,
    });
  });

  it('Anthropic 原生 usage 将普通输入与缓存读写合并为计费总输入', () => {
    expect(extractUsage({
      input_tokens: 491,
      output_tokens: 101,
      cache_read_input_tokens: 25_186,
      cache_creation_input_tokens: 11_155,
    }, { cacheTokensAreAdditional: true })).toMatchObject({
      inputTokens: 36_832,
      outputTokens: 101,
      cachedInputTokens: 25_186,
      cacheCreationTokens: 11_155,
    });
  });

  it('Anthropic 流式 usage 按每一维最新累计值合并', () => {
    const started = mergeUsage({}, {
      input_tokens: 491,
      cache_read_input_tokens: 25_000,
      cache_creation_input_tokens: 11_155,
      cache_creation_5m_input_tokens: 11_155,
      output_tokens: 0,
    }, { cacheTokensAreAdditional: true });
    const completed = mergeUsage(started, {
      input_tokens: null,
      cache_read_input_tokens: 25_186,
      cache_creation_input_tokens: null,
      output_tokens: 101,
    }, { cacheTokensAreAdditional: true });

    expect(completed).toMatchObject({
      inputTokens: 36_832,
      cachedInputTokens: 25_186,
      cacheCreationTokens: 11_155,
      cacheCreation5mTokens: 11_155,
      outputTokens: 101,
    });
  });

  it('OpenAI 流式 usage 保持总输入语义并保留缓存子集', () => {
    const started = mergeUsage({}, {
      input_tokens: 11_813,
      input_tokens_details: { cached_tokens: 10_752 },
      output_tokens: 0,
    });
    const completed = mergeUsage(started, { output_tokens: 1_483 });

    expect(completed).toMatchObject({
      inputTokens: 11_813,
      cachedInputTokens: 10_752,
      outputTokens: 1_483,
    });
  });

  it('流式缓存写入总量显式提供时不被 TTL 子桶覆盖', () => {
    const usage = mergeUsage({}, {
      input_tokens: 10,
      cache_creation_input_tokens: 100,
      cache_creation_5m_input_tokens: 60,
      cache_creation_1h_input_tokens: 20,
    }, { cacheTokensAreAdditional: true });

    expect(usage).toMatchObject({
      inputTokens: 110,
      cacheCreationTokens: 100,
      cacheCreation5mTokens: 60,
      cacheCreation1hTokens: 20,
    });
  });

  it('嵌套 cache_write_tokens 包括显式 0 都优先于顶层兼容字段', () => {
    expect(extractUsage({
      input_tokens: 20,
      cache_creation_input_tokens: 19,
      input_tokens_details: { cache_write_tokens: 0 },
    }).cacheCreationTokens).toBe(0);
    expect(extractUsage({
      input_tokens: 20,
      cache_creation_input_tokens: 19,
      input_tokens_details: { cache_write_tokens: 7 },
    }).cacheCreationTokens).toBe(7);
    expect(extractUsage({
      input_tokens: 20,
      cache_creation_input_tokens: 19,
      input_tokens_details: { cache_creation_tokens: 0 },
    }).cacheCreationTokens).toBe(0);
    expect(extractUsage({ input_tokens: 20, cache_write_input_tokens: 6 }).cacheCreationTokens).toBe(6);
  });
});
