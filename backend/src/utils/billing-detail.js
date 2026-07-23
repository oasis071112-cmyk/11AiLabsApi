const { calculatePricing } = require('./pricing-engine');

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value) {
  return Number(number(value).toFixed(12));
}

const DISPLAY_UNIT_TOKENS = 1_000_000;

function perMillionPrice(price, sourceUnitTokens) {
  return number(price) * DISPLAY_UNIT_TOKENS / Math.max(number(sourceUnitTokens, DISPLAY_UNIT_TOKENS), 1);
}

function buildBillingDetail({
  modelCode = '', inputTokens = 0, cachedInputTokens = 0, cacheCreationTokens = 0,
  imageInputTokens = 0, outputTokens = 0, imageOutputTokens = 0, totalCost = 0,
  billingMode = 'token', image = {}, official = {}, legacy = {}, multipliers = {}, usdCnyRate = 1,
  serviceTier = '',
} = {}) {
  if (billingMode === 'per_request') {
    const unitPrice = Math.max(number(image.unitPrice), 0);
    const multiplier = number(multipliers.input, 1);
    const fxRate = String(official.currency).toUpperCase() === 'USD' ? number(usdCnyRate, 7) : 1;
    const amount = rounded(unitPrice * multiplier * fxRate);
    const actualTotal = rounded(totalCost);
    const difference = rounded(actualTotal - amount);
    const dimensions = [{ label: '固定请求', usage: 1, unit: '次', unitPrice, multiplier, fxRate, amount }];
    if (difference !== 0) dimensions.push({
      label: '实际结算差额', usage: null, amount: difference, isAdjustment: true,
    });
    return {
      mode: 'fixed_snapshot',
      currency: String(official.currency || 'USD').toUpperCase(),
      dimensions,
      priceCalculationTotal: amount,
      calculatedTotal: rounded(dimensions.reduce((sum, item) => sum + item.amount, 0)),
      actualTotal,
      reconciled: rounded(dimensions.reduce((sum, item) => sum + item.amount, 0)) === actualTotal,
      notice: '每请求单价、倍率和汇率均使用本次调用发生时保存的快照；钱包仍按点数结算。',
    };
  }
  if (billingMode === 'image') {
    const count = Math.max(Math.floor(number(image.count)), 0);
    const unitPrice = Math.max(number(image.unitPrice), 0);
    const multiplier = number(multipliers.image, 1);
    const fxRate = String(official.currency).toUpperCase() === 'USD' ? number(usdCnyRate, 7) : 1;
    const amount = rounded(count * unitPrice * multiplier * fxRate);
    const actualTotal = rounded(totalCost);
    const dimensions = [{
      label: '生成图片',
      usage: count,
      unit: '张',
      unitPrice,
      multiplier,
      fxRate,
      amount,
      size: image.size,
      quality: image.quality,
    }];
    const difference = rounded(actualTotal - amount);
    if (difference !== 0) dimensions.push({
      label: '实际结算差额', usage: null, unitPrice: null, multiplier: null,
      fxRate: 1, amount: difference, isAdjustment: true,
    });
    return {
      mode: 'image_snapshot',
      currency: String(official.currency || 'CNY').toUpperCase(),
      dimensions,
      priceCalculationTotal: amount,
      calculatedTotal: rounded(dimensions.reduce((sum, item) => sum + item.amount, 0)),
      actualTotal,
      reconciled: rounded(dimensions.reduce((sum, item) => sum + item.amount, 0)) === actualTotal,
      notice: '图片数量来自上游成功响应；尺寸、单价、倍率和汇率均使用本次请求发生时保存的快照。',
    };
  }
  const input = Math.max(number(inputTokens), 0);
  const cached = Math.min(Math.max(number(cachedInputTokens), 0), input);
  const uncached = input - cached;
  const output = Math.max(number(outputTokens), 0);
  const dimensions = [];

  if (official.currency) {
    const inputMultiplier = number(multipliers.input, 1);
    const outputMultiplier = number(multipliers.output, 1);
    const sourceUnitTokens = Math.max(number(official.unitTokens, DISPLAY_UNIT_TOKENS), 1);
    const unitTokens = DISPLAY_UNIT_TOKENS;
    const fxRate = String(official.currency).toUpperCase() === 'USD' ? number(usdCnyRate, 7) : 1;
    const pricing = calculatePricing({
      modelCode,
      inputTokens: input,
      cachedInputTokens: cached,
      cacheCreationTokens,
      imageInputTokens,
      outputTokens: output,
      imageOutputTokens,
      official,
      multipliers: { input: inputMultiplier, output: outputMultiplier },
      usdCnyRate: fxRate,
      serviceTier,
    });
    const calculated = pricing.official;
    if (calculated.textInputTokens > 0) dimensions.push({ label: '普通输入 Token', usage: calculated.textInputTokens, unitTokens, unitPrice: perMillionPrice(official.input, sourceUnitTokens), multiplier: inputMultiplier, fxRate, amount: rounded(calculated.inputCost) });
    if (calculated.imageInputTokens > 0) dimensions.push({ label: '图片输入 Token', usage: calculated.imageInputTokens, unitTokens, unitPrice: perMillionPrice(official.imageInput ?? official.input, sourceUnitTokens), multiplier: inputMultiplier, fxRate, amount: rounded(calculated.imageInputCost) });
    if (calculated.cachedInputTokens > 0) dimensions.push({ label: '缓存输入 Token', usage: calculated.cachedInputTokens, unitTokens, unitPrice: perMillionPrice(official.cachedInput ?? official.input, sourceUnitTokens), multiplier: inputMultiplier, fxRate, amount: rounded(calculated.cachedInputCost) });
    if (calculated.cacheCreationTokens > 0) dimensions.push({ label: '缓存写入 Token', usage: calculated.cacheCreationTokens, unitTokens, unitPrice: perMillionPrice(official.cacheCreation ?? official.input, sourceUnitTokens), multiplier: inputMultiplier, fxRate, amount: rounded(calculated.cacheCreationCost) });
    if (calculated.textOutputTokens > 0) dimensions.push({ label: '输出 Token', usage: calculated.textOutputTokens, unitTokens, unitPrice: perMillionPrice(official.output, sourceUnitTokens), multiplier: outputMultiplier, fxRate, amount: rounded(calculated.outputCost) });
    if (calculated.imageOutputTokens > 0) dimensions.push({ label: '图片输出 Token', usage: calculated.imageOutputTokens, unitTokens, unitPrice: perMillionPrice(official.imageOutput ?? official.output, sourceUnitTokens), multiplier: outputMultiplier, fxRate, amount: rounded(calculated.imageOutputCost) });
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
    if (uncached > 0) dimensions.push({ label: '普通输入 Token', usage: uncached, unitTokens: DISPLAY_UNIT_TOKENS, unitPrice: 0, multiplier: 1, fxRate: 1, amount: 0 });
    if (cached > 0) dimensions.push({ label: '缓存输入 Token', usage: cached, unitTokens: DISPLAY_UNIT_TOKENS, unitPrice: 0, multiplier: 1, fxRate: 1, amount: 0 });
    if (output > 0) dimensions.push({ label: '输出 Token', usage: output, unitTokens: DISPLAY_UNIT_TOKENS, unitPrice: 0, multiplier: 1, fxRate: 1, amount: 0 });

    return {
      mode: 'legacy_zero',
      dimensions,
      calculatedTotal: 0,
      actualTotal,
      reconciled: true,
      notice: '该历史请求发生时扣费价格未生效，实际扣除 0 点；历史记录不追溯补扣。',
    };
  }

  const sourceUnitTokens = Math.max(number(legacy.unitTokens, 1_000), 1);
  const unitTokens = DISPLAY_UNIT_TOKENS;
  const inputMultiplier = number(multipliers.input, 1);
  const outputMultiplier = number(multipliers.output, 1);
  const inputPrice = perMillionPrice(legacy.input, sourceUnitTokens);
  const outputPrice = perMillionPrice(legacy.output, sourceUnitTokens);
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
      ? '旧版价格已换算为每 1M Token 展示。'
      : '旧版记录未保存完整价格快照，差额行用于对齐原系统实际扣点。',
  };
}

module.exports = { buildBillingDetail };
