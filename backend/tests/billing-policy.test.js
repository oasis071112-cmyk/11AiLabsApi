import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveFixedUnitPrice,
} = require('../src/utils/billing-policy.js');

describe('Sub2API 请求计费策略', () => {
  const model = {
    official_currency: 'USD',
    official_input_price: 2,
    official_output_price: 8,
    official_cached_input_price: 0.5,
    official_unit_tokens: 1_000_000,
  };

  it('未显式配置时图片请求按图片、其他请求按 token', () => {
    expect(billingModeForRequest({}, true)).toBe('image');
    expect(billingModeForRequest({}, false)).toBe('token');
    expect(billingModeForRequest({ billing_mode: 'per_request' }, false)).toBe('per_request');
    expect(billingModeForRequest({ billing_mode: 'token' }, true)).toBe('token');
  });

  it('渠道 token 单价以每 token 美元覆盖模型官方价，并保留缺省回退', () => {
    expect(channelTokenOfficial(model, {
      input_price: 0.000003,
      cache_read_price: 0.0000002,
      image_output_price: 0.00001,
    })).toEqual({
      currency: 'USD',
      unitTokens: 1,
      input: 0.000003,
      output: 0.000008,
      cachedInput: 0.0000002,
      cacheCreation: 0.000003,
      imageInput: 0.000003,
      imageOutput: 0.00001,
    });
  });

  it('按配置来源解析账单模型名', () => {
    const values = { requested: 'public', channelMapped: 'mapped', upstream: 'actual' };
    expect(resolveBillingModel('requested', values)).toBe('public');
    expect(resolveBillingModel('channel_mapped', values)).toBe('mapped');
    expect(resolveBillingModel('upstream', values)).toBe('actual');
  });

  it('GPT-5.6 渠道未配置缓存写入价时保留缺省，以触发 1.25 倍规则', () => {
    const official = channelTokenOfficial({ ...model, model_code: 'gpt-5.6' }, {
      input_price: 0.000003,
    });
    expect(official).not.toHaveProperty('cacheCreation');
  });

  it('渠道部分美元覆盖不会把人民币模型回退价误当美元', () => {
    expect(channelTokenOfficial({
      ...model,
      official_currency: 'CNY',
      official_input_price: 2,
    }, { output_price: 0.000008 }, 7).input).toBeCloseTo(2 / 1_000_000 / 7, 14);
  });

  it('每请求模式使用渠道固定美元价，图片模式按档位取价', () => {
    expect(resolveFixedUnitPrice({ billing_mode: 'per_request', per_request_price: 0.12 }, '4K')).toBe(0.12);
    expect(resolveFixedUnitPrice({ billing_mode: 'image', image_price_4k: 0.28 }, '4K')).toBe(0.28);
    expect(resolveFixedUnitPrice({ billing_mode: 'image', per_request_price: 0.1 }, '2K')).toBe(0.1);
  });
});
