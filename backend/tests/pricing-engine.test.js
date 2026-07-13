import { describe, expect, it } from 'vitest';
import { calculatePricing } from '../src/utils/pricing-engine.js';

describe('官方定价换算与用户扣费', () => {
  it('美元官方价应先换算为人民币点数，再应用用户倍率', () => {
    const result = calculatePricing({
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      official: { currency: 'USD', input: 5, output: 30, unitTokens: 1_000_000 },
      channel: { currency: 'USD', input: 4, output: 25, unitTokens: 1_000_000 },
      multipliers: { input: 0.88, output: 0.88 },
      usdCnyRate: 7,
    });

    expect(result.userCostPoints).toBeCloseTo(400.4, 8);
    expect(result.channelCostCny).toBeCloseTo(378, 8);
    expect(result.profitCny).toBeCloseTo(22.4, 8);
  });

  it('人民币官方价不应重复换汇，缓存输入使用独立单价', () => {
    const result = calculatePricing({
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 1_000_000,
      official: { currency: 'CNY', input: 2, cachedInput: 0.5, output: 8, unitTokens: 1_000_000 },
      channel: { currency: 'CNY', input: 1, cachedInput: 0.2, output: 4, unitTokens: 1_000_000 },
      multipliers: { input: 1.2, output: 1.2 },
      usdCnyRate: 7,
    });

    expect(result.userCostPoints).toBeCloseTo(11.28, 8);
    expect(result.channelCostCny).toBeCloseTo(4.68, 8);
  });
});
