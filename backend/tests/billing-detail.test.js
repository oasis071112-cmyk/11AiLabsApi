import { describe, expect, it } from 'vitest';
import { buildBillingDetail, buildBillingDetailFromSnapshot } from '../src/utils/billing-detail.js';

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

  it('图片模式按真实张数和调用时图片价格快照展示', () => {
    const detail = buildBillingDetail({
      billingMode: 'image',
      totalCost: 0.672,
      official: { currency: 'USD' },
      image: {
        count: 2,
        size: '1024x1536',
        quality: 'high',
        unitPrice: 0.04,
        billingModel: 'gpt-image-1',
      },
      multipliers: { image: 1.2 },
      usdCnyRate: 7,
    });

    expect(detail.mode).toBe('image_snapshot');
    expect(detail.dimensions[0]).toMatchObject({
      label: '生成图片',
      usage: 2,
      unit: '张',
      unitPrice: 0.04,
      multiplier: 1.2,
      amount: 0.672,
      size: '1024x1536',
    });
    expect(detail.reconciled).toBe(true);
  });

  it('每请求模式按固定美元单价快照展示', () => {
    const detail = buildBillingDetail({
      billingMode: 'per_request',
      totalCost: 0.84,
      official: { currency: 'USD' },
      image: { unitPrice: 0.12 },
      multipliers: { input: 1 },
      usdCnyRate: 7,
    });
    expect(detail.mode).toBe('fixed_snapshot');
    expect(detail.dimensions[0]).toMatchObject({
      label: '固定请求', usage: 1, unit: '次', unitPrice: 0.12, amount: 0.84,
    });
    expect(detail.reconciled).toBe(true);
  });

  it('Count Tokens 显示计数结果但明确不扣点', () => {
    const detail = buildBillingDetail({
      billingMode: 'count_tokens',
      inputTokens: 37,
      totalCost: 0,
    });
    expect(detail).toMatchObject({
      mode: 'count_tokens',
      dimensions: [{ label: '输入 Token 计数', usage: 37, unit: 'Token', amount: 0 }],
      actualTotal: 0,
      reconciled: true,
    });
  });

  it('GPT-5.6 缓存写入缺少独立价格时按输入价格的 1.25 倍回显', () => {
    const detail = buildBillingDetail({
      modelCode: 'gpt-5.6',
      inputTokens: 100_000,
      cacheCreationTokens: 100_000,
      totalCost: 0.25,
      official: { currency: 'CNY', input: 2, output: 10, unitTokens: 1_000_000 },
      multipliers: { input: 1, output: 1 },
    });

    expect(detail.dimensions).toEqual([
      expect.objectContaining({ label: '缓存写入 Token', usage: 100_000, amount: 0.25 }),
    ]);
    expect(detail.reconciled).toBe(true);
  });

  it('PostgreSQL 结算快照可还原成用户可点击的逐项扣费过程', () => {
    const detail = buildBillingDetailFromSnapshot({
      model_code: 'claude-opus-4-8',
      input_tokens: '0',
      output_tokens: '83',
      total_cost: '0.002101',
      billing_mode: 'token',
      billing_detail: {
        charge: {
          mode: 'token', currency: 'USD', unit_tokens: 1,
          input_price: 0.000005, output_price: 0.000025,
          input_multiplier: 0.15, output_multiplier: 0.15,
        },
      },
    });

    expect(detail).toMatchObject({
      mode: 'snapshot', currency: 'USD', actualTotal: 0.002101, reconciled: true,
      dimensions: [expect.objectContaining({ label: '输出 Token', usage: 83, multiplier: 0.15 })],
    });
    expect(detail.dimensions[0].fxRate).toBeCloseTo(6.7502008, 6);
  });

  it('新 PostgreSQL 快照逐项展示 OpenAI 普通输入、缓存输入和输出', () => {
    const detail = buildBillingDetailFromSnapshot({
      model_code: 'gpt-5.6-sol',
      input_tokens: '11813',
      output_tokens: '1483',
      total_cost: '0.07449519446',
      billing_mode: 'token',
      billing_snapshot: {
        charge: {
          mode: 'token', snapshot_version: 2, currency: 'USD', unit_tokens: 1,
          input_price: 0.000005, cached_input_price: 0.0000005, output_price: 0.00003,
          input_multiplier: 0.2, output_multiplier: 0.2, usd_cny_rate: 6.7513,
          usage: {
            input_tokens: 11_813,
            uncached_input_tokens: 1_061,
            cached_input_tokens: 10_752,
            cache_creation_tokens: 0,
            output_tokens: 1_483,
          },
        },
      },
    });

    expect(detail.dimensions).toEqual([
      expect.objectContaining({ label: '普通输入 Token', usage: 1_061, amount: 0.0071631293 }),
      expect.objectContaining({ label: '缓存输入 Token', usage: 10_752, amount: 0.00725899776 }),
      expect.objectContaining({ label: '输出 Token', usage: 1_483, amount: 0.0600730674 }),
    ]);
    expect(detail.priceCalculationTotal).toBeCloseTo(0.07449519446, 12);
    expect(detail.reconciled).toBe(true);
    expect(detail.dimensions.some(item => item.isAdjustment)).toBe(false);
  });

  it('新 PostgreSQL 快照逐项展示 Claude 普通输入、缓存读写和输出', () => {
    const detail = buildBillingDetailFromSnapshot({
      model_code: 'claude-opus-4-8',
      input_tokens: '36832',
      output_tokens: '101',
      total_cost: '0.08839991876625',
      billing_mode: 'token',
      billing_snapshot: {
        charge: {
          mode: 'token', snapshot_version: 2, currency: 'USD', unit_tokens: 1,
          input_price: 0.000005, cached_input_price: 0.0000005,
          cache_creation_price: 0.00000625, cache_creation_5m_price: 0.00000625,
          cache_creation_1h_price: 0.00001, output_price: 0.000025,
          input_multiplier: 0.15, output_multiplier: 0.15, usd_cny_rate: 6.7513,
          usage: {
            input_tokens: 36_832,
            uncached_input_tokens: 491,
            cached_input_tokens: 25_186,
            cache_creation_tokens: 11_155,
            cache_creation_5m_tokens: 11_155,
            cache_creation_1h_tokens: 0,
            output_tokens: 101,
          },
        },
      },
    });

    expect(detail.dimensions).toEqual([
      expect.objectContaining({ label: '普通输入 Token', usage: 491, amount: 0.002486166225 }),
      expect.objectContaining({ label: '缓存输入 Token', usage: 25_186, amount: 0.012752868135 }),
      expect.objectContaining({ label: '缓存写入 Token', usage: 11_155, amount: 0.070603829531 }),
      expect.objectContaining({ label: '输出 Token', usage: 101, amount: 0.002557054875 }),
    ]);
    expect(detail.priceCalculationTotal).toBeCloseTo(0.08839991876625, 12);
    expect(detail.reconciled).toBe(true);
    expect(detail.dimensions.some(item => item.isAdjustment)).toBe(false);
  });

  it('旧 PostgreSQL 快照不伪造缓存用量并保留原金额差额', () => {
    const detail = buildBillingDetailFromSnapshot({
      model_code: 'gpt-5.6-sol',
      input_tokens: '11813',
      output_tokens: '1483',
      total_cost: '0.07449519446',
      billing_mode: 'token',
      billing_snapshot: {
        charge: {
          mode: 'token', currency: 'USD', unit_tokens: 1,
          input_price: 0.000005, output_price: 0.00003,
          input_multiplier: 0.2, output_multiplier: 0.2, usd_cny_rate: 6.7513,
        },
      },
    });

    expect(detail.dimensions.some(item => item.label === '缓存输入 Token')).toBe(false);
    expect(detail.dimensions.at(-1)).toEqual(expect.objectContaining({
      label: '实际结算差额', amount: -0.06533097984, isAdjustment: true,
    }));
    expect(detail.actualTotal).toBe(0.07449519446);
    expect(detail.reconciled).toBe(true);
  });

  it('未标版本的部分 usage 快照仍按旧账单字段还原', () => {
    const detail = buildBillingDetailFromSnapshot({
      model_code: 'legacy-model',
      input_tokens: '100',
      output_tokens: '20',
      total_cost: '0.00018',
      billing_mode: 'token',
      billing_snapshot: {
        charge: {
          mode: 'token', currency: 'CNY', unit_tokens: 1,
          input_price: 0.000001, output_price: 0.000004,
          input_multiplier: 1, output_multiplier: 1,
          usage: { cached_input_tokens: 25 },
        },
      },
    });

    expect(detail.dimensions).toEqual([
      expect.objectContaining({ label: '普通输入 Token', usage: 100, amount: 0.0001 }),
      expect.objectContaining({ label: '输出 Token', usage: 20, amount: 0.00008 }),
    ]);
    expect(detail.dimensions.some(item => item.label === '缓存输入 Token')).toBe(false);
    expect(detail.reconciled).toBe(true);
  });
});
