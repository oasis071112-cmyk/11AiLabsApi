import { describe, expect, it } from 'vitest';
import { buildBillingDetail } from '../src/utils/billing-detail.js';

describe('用户计费明细', () => {
  it('历史实际扣费为 0 时展示 Token 计算但不按当前价格追溯补扣', () => {
    const detail = buildBillingDetail({
      inputTokens: 15_659,
      outputTokens: 0,
      totalCost: 0,
      legacy: { input: 0.001, output: 0.004, unitTokens: 1_000 },
    });

    expect(detail.mode).toBe('legacy_zero');
    expect(detail.dimensions).toEqual([
      expect.objectContaining({ label: '普通输入 Token', usage: 15_659, unitPrice: 0, amount: 0 }),
    ]);
    expect(detail.calculatedTotal).toBe(0);
    expect(detail.actualTotal).toBe(0);
    expect(detail.notice).toContain('不追溯补扣');
  });

  it('新版美元价格按调用时快照逐项换算且合计等于实际扣点', () => {
    const detail = buildBillingDetail({
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 2_000_000,
      totalCost: 397.32,
      official: {
        currency: 'USD', input: 5, cachedInput: 2.5, output: 30, unitTokens: 1_000_000,
      },
      multipliers: { input: 0.88, output: 0.88 },
      usdCnyRate: 7,
    });

    expect(detail.mode).toBe('snapshot');
    expect(detail.dimensions.map(item => item.amount)).toEqual([24.64, 3.08, 369.6]);
    expect(detail.calculatedTotal).toBeCloseTo(397.32, 8);
    expect(detail.actualTotal).toBeCloseTo(397.32, 8);
    expect(detail.reconciled).toBe(true);
  });

  it('官方快照即使按每千 Token 保存，也要换算为每 1M Token 展示且金额不变', () => {
    const detail = buildBillingDetail({
      inputTokens: 1_000,
      totalCost: 5,
      official: { currency: 'CNY', input: 5, output: 0, unitTokens: 1_000 },
      multipliers: { input: 1, output: 1 },
    });

    expect(detail.dimensions[0]).toMatchObject({ unitTokens: 1_000_000, unitPrice: 5_000, amount: 5 });
    expect(detail.calculatedTotal).toBe(5);
  });

  it('旧版非零扣费按原来的每千 Token 规则还原并对齐实际扣点', () => {
    const detail = buildBillingDetail({
      inputTokens: 87,
      outputTokens: 9,
      totalCost: 0.000123,
      legacy: { input: 0.001, output: 0.004, unitTokens: 1_000 },
      multipliers: { input: 1, output: 1 },
    });

    expect(detail.mode).toBe('legacy');
    expect(detail.dimensions.map(item => [item.unitTokens, item.unitPrice])).toEqual([
      [1_000_000, 1], [1_000_000, 4],
    ]);
    expect(detail.dimensions.map(item => item.amount)).toEqual([0.000087, 0.000036]);
    expect(detail.calculatedTotal).toBeCloseTo(0.000123, 12);
    expect(detail.actualTotal).toBeCloseTo(0.000123, 12);
    expect(detail.reconciled).toBe(true);
  });

  it('历史价格无法精确还原时用明确差额行对齐实际扣点', () => {
    const detail = buildBillingDetail({
      inputTokens: 1_000,
      totalCost: 1.2,
      legacy: { input: 1, output: 0, unitTokens: 1_000 },
    });

    expect(detail.dimensions.at(-1)).toEqual(expect.objectContaining({
      label: '历史实际扣费差额', amount: 0.2, isAdjustment: true,
    }));
    expect(detail.calculatedTotal).toBe(1.2);
    expect(detail.actualTotal).toBe(1.2);
    expect(detail.reconciled).toBe(true);
  });

  it('新版快照与钱包最终结算有差异时用明确调整行对齐', () => {
    const detail = buildBillingDetail({
      inputTokens: 1_000_000,
      totalCost: 34.5,
      official: { currency: 'USD', input: 5, output: 0, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
      usdCnyRate: 7,
    });

    expect(detail.dimensions.at(-1)).toEqual(expect.objectContaining({
      label: '实际结算差额', amount: -0.5, isAdjustment: true,
    }));
    expect(detail.calculatedTotal).toBe(34.5);
    expect(detail.actualTotal).toBe(34.5);
    expect(detail.reconciled).toBe(true);
  });

  it('极小结算差异也必须添加调整行而不是显示两个不同合计', () => {
    const detail = buildBillingDetail({
      inputTokens: 1_000_000,
      totalCost: 35.000000001,
      official: { currency: 'USD', input: 5, output: 0, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
      usdCnyRate: 7,
    });

    expect(detail.dimensions.at(-1)).toEqual(expect.objectContaining({
      label: '实际结算差额', amount: 0.000000001, isAdjustment: true,
    }));
    expect(detail.calculatedTotal).toBe(detail.actualTotal);
  });
});
