const { calculatePricing } = require('./pricing-engine');

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value) {
  return Number(number(value).toFixed(12));
}

function buildBillingDetail({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, totalCost = 0, official = {}, legacy = {}, multipliers = {}, usdCnyRate = 1 } = {}) {
  const input = Math.max(number(inputTokens), 0);
  const cached = Math.min(Math.max(number(cachedInputTokens), 0), input);
  const uncached = input - cached;
  const output = Math.max(number(outputTokens), 0);
  const dimensions = [];

  if (official.currency) {
    const inputMultiplier = number(multipliers.input, 1);
    const outputMultiplier = number(multipliers.output, 1);
    const unitTokens = Math.max(number(official.unitTokens, 1_000_000), 1);
    const fxRate = String(official.currency).toUpperCase() === 'USD' ? number(usdCnyRate, 7) : 1;
    const pricing = calculatePricing({ inputTokens: input, cachedInputTokens: cached, outputTokens: output, official, multipliers: { input: inputMultiplier, output: outputMultiplier }, usdCnyRate: fxRate });
    const calculated = pricing.official;
    if (calculated.uncachedInputTokens > 0) dimensions.push({ label: '普通输入 Token', usage: calculated.uncachedInputTokens, unitTokens, unitPrice: number(official.input), multiplier: inputMultiplier, fxRate, amount: rounded(calculated.inputCost) });
    if (calculated.cachedInputTokens > 0) dimensions.push({ label: '缓存输入 Token', usage: calculated.cachedInputTokens, unitTokens, unitPrice: number(official.cachedInput, official.input), multiplier: inputMultiplier, fxRate, amount: rounded(calculated.cachedInputCost) });
    if (calculated.outputTokens > 0) dimensions.push({ label: '输出 Token', usage: calculated.outputTokens, unitTokens, unitPrice: number(official.output), multiplier: outputMultiplier, fxRate, amount: rounded(calculated.outputCost) });
    const priceCalculationTotal = rounded(dimensions.reduce((sum, item) => sum + item.amount, 0));
    const actualTotal = rounded(totalCost);
    const difference = rounded(actualTotal - priceCalculationTotal);
    if (difference !== 0) {
      dimensions.push({ label: '实际结算差额', usage: null, unitTokens: null, unitPrice: null, multiplier: null, fxRate: 1, amount: difference, isAdjustment: true });
    }
    const calculatedTotal = rounded(dimensions.reduce((sum, item) => sum + item.amount, 0));
    return {
      mode: 'snapshot',
      currency: String(official.currency).toUpperCase(),
      dimensions,
      priceCalculationTotal,
      calculatedTotal,
      actualTotal,
      reconciled: calculatedTotal === actualTotal,
      notice: difference === 0
        ? '价格、倍率和汇率均使用本次请求发生时保存的快照。'
        : '价格、倍率和汇率使用调用时快照；差额行用于对齐钱包最终实际结算金额。',
    };
  }

  const actualTotal = rounded(totalCost);
  if (actualTotal === 0) {
    if (uncached > 0) dimensions.push({ label: '普通输入 Token', usage: uncached, unitTokens: 1_000, unitPrice: 0, multiplier: 1, fxRate: 1, amount: 0 });
    if (cached > 0) dimensions.push({ label: '缓存输入 Token', usage: cached, unitTokens: 1_000, unitPrice: 0, multiplier: 1, fxRate: 1, amount: 0 });
    if (output > 0) dimensions.push({ label: '输出 Token', usage: output, unitTokens: 1_000, unitPrice: 0, multiplier: 1, fxRate: 1, amount: 0 });

    return {
      mode: 'legacy_zero',
      dimensions,
      calculatedTotal: 0,
      actualTotal,
      reconciled: true,
      notice: '该历史请求发生时扣费价格未生效，实际扣除 0 点；历史记录不追溯补扣。',
    };
  }

  const unitTokens = Math.max(number(legacy.unitTokens, 1_000), 1);
  const inputMultiplier = number(multipliers.input, 1);
  const outputMultiplier = number(multipliers.output, 1);
  const inputPrice = number(legacy.input);
  const outputPrice = number(legacy.output);
  if (uncached > 0) dimensions.push({ label: '普通输入 Token', usage: uncached, unitTokens, unitPrice: inputPrice, multiplier: inputMultiplier, fxRate: 1, amount: rounded(uncached / unitTokens * inputPrice * inputMultiplier) });
  if (cached > 0) dimensions.push({ label: '缓存输入 Token', usage: cached, unitTokens, unitPrice: inputPrice, multiplier: inputMultiplier, fxRate: 1, amount: rounded(cached / unitTokens * inputPrice * inputMultiplier) });
  if (output > 0) dimensions.push({ label: '输出 Token', usage: output, unitTokens, unitPrice: outputPrice, multiplier: outputMultiplier, fxRate: 1, amount: rounded(output / unitTokens * outputPrice * outputMultiplier) });
  const priceCalculationTotal = rounded(dimensions.reduce((sum, item) => sum + item.amount, 0));
  const difference = rounded(actualTotal - priceCalculationTotal);
  if (difference !== 0) {
    dimensions.push({ label: '历史实际扣费差额', usage: null, unitTokens: null, unitPrice: null, multiplier: null, fxRate: 1, amount: difference, isAdjustment: true });
  }
  const calculatedTotal = rounded(dimensions.reduce((sum, item) => sum + item.amount, 0));
  return {
    mode: 'legacy',
    dimensions,
    priceCalculationTotal,
    calculatedTotal,
    actualTotal,
    reconciled: calculatedTotal === actualTotal,
    notice: difference === 0
      ? '旧版记录按原系统每 1000 Token 的基础价格还原。'
      : '旧版记录未保存完整价格快照，差额行用于对齐原系统实际扣点。',
  };
}

module.exports = { buildBillingDetail };
