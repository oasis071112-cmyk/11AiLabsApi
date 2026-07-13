function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrency(currency) {
  return String(currency || 'CNY').trim().toUpperCase();
}

function toCny(amount, currency, usdCnyRate) {
  const value = number(amount);
  return normalizeCurrency(currency) === 'USD' ? value * number(usdCnyRate, 7) : value;
}

function calculateDimensions({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, prices = {}, currency = 'CNY', unitTokens = 1_000_000, usdCnyRate = 7, multipliers = { input: 1, output: 1 } }) {
  const unit = Math.max(number(unitTokens, 1_000_000), 1);
  const input = Math.max(number(inputTokens), 0);
  const cached = Math.min(Math.max(number(cachedInputTokens), 0), input);
  const uncached = input - cached;
  const output = Math.max(number(outputTokens), 0);
  const inputMultiplier = number(multipliers.input, 1);
  const outputMultiplier = number(multipliers.output, 1);
  const inputPriceCny = toCny(number(prices.input), currency, usdCnyRate);
  const cachedInputPriceCny = toCny(number(prices.cachedInput, prices.input), currency, usdCnyRate);
  const outputPriceCny = toCny(number(prices.output), currency, usdCnyRate);

  const inputCost = (uncached / unit) * inputPriceCny * inputMultiplier;
  const cachedInputCost = (cached / unit) * cachedInputPriceCny * inputMultiplier;
  const outputCost = (output / unit) * outputPriceCny * outputMultiplier;

  return {
    inputTokens: input,
    cachedInputTokens: cached,
    uncachedInputTokens: uncached,
    outputTokens: output,
    inputCost,
    cachedInputCost,
    outputCost,
    totalCost: inputCost + cachedInputCost + outputCost,
  };
}

function calculatePricing({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, official = {}, channel = {}, multipliers = { input: 1, output: 1 }, usdCnyRate = 7 }) {
  const officialDimensions = calculateDimensions({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    prices: official,
    currency: official.currency,
    unitTokens: official.unitTokens,
    usdCnyRate,
    multipliers,
  });
  const channelDimensions = calculateDimensions({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    prices: channel,
    currency: channel.currency,
    unitTokens: channel.unitTokens,
    usdCnyRate,
    multipliers: { input: 1, output: 1 },
  });

  return {
    userCostPoints: officialDimensions.totalCost,
    officialCostCny: officialDimensions.totalCost,
    channelCostCny: channelDimensions.totalCost,
    profitCny: officialDimensions.totalCost - channelDimensions.totalCost,
    official: officialDimensions,
    channel: channelDimensions,
  };
}

function extractUsage(usage = {}) {
  const inputTokens = number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = number(usage.output_tokens ?? usage.completion_tokens);
  const details = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const cachedInputTokens = number(
    details.cached_tokens
    ?? usage.cached_input_tokens
    ?? usage.cache_read_input_tokens
    ?? usage.prompt_cache_hit_tokens,
  );
  return { inputTokens, outputTokens, cachedInputTokens };
}

module.exports = { calculatePricing, extractUsage, normalizeCurrency, toCny };
