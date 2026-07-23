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

function hasNumericPrice(prices, key) {
  return Object.prototype.hasOwnProperty.call(prices || {}, key) && Number.isFinite(Number(prices[key]));
}

function normalizedModelCode(modelCode) {
  return String(modelCode || '').trim().toLowerCase().replace(/^openai\//, '');
}

function usesSub2ApiLongContextPricing(modelCode) {
  const model = normalizedModelCode(modelCode);
  return (model.startsWith('gpt-5.4')
      && !model.startsWith('gpt-5.4-mini')
      && !model.startsWith('gpt-5.4-nano'))
    || model.startsWith('gpt-5.5')
    || model === 'gpt-5.6'
    || model.startsWith('gpt-5.6-');
}

function serviceTierMultiplier(serviceTier, hasPriorityPrices) {
  if (hasPriorityPrices) return 1;
  const tier = String(serviceTier || '').trim().toLowerCase();
  if (tier === 'priority') return 2;
  if (tier === 'flex') return 0.5;
  return 1;
}

function calculateDimensions({
  modelCode = '',
  inputTokens = 0,
  cachedInputTokens = 0,
  cacheCreationTokens = 0,
  cacheCreation5mTokens = 0,
  cacheCreation1hTokens = 0,
  imageInputTokens = 0,
  outputTokens = 0,
  imageOutputTokens = 0,
  prices = {},
  currency = 'CNY',
  unitTokens = 1_000_000,
  usdCnyRate = 7,
  multipliers = { input: 1, output: 1 },
  serviceTier = '',
}) {
  const unit = Math.max(number(unitTokens, 1_000_000), 1);
  const input = Math.max(number(inputTokens), 0);
  const cached = Math.min(Math.max(number(cachedInputTokens), 0), input);
  const cacheCreation = Math.min(Math.max(number(cacheCreationTokens), 0), Math.max(input - cached, 0));
  const ordinaryInput = Math.max(input - cached - cacheCreation, 0);
  const imageInput = Math.min(Math.max(number(imageInputTokens), 0), ordinaryInput);
  const textInput = ordinaryInput - imageInput;
  const output = Math.max(number(outputTokens), 0);
  const imageOutput = Math.min(Math.max(number(imageOutputTokens), 0), output);
  const textOutput = output - imageOutput;
  const inputMultiplier = number(multipliers.input, 1);
  const outputMultiplier = number(multipliers.output, 1);
  const hasPriorityPrices = ['priorityInput', 'priorityOutput', 'priorityCachedInput', 'priorityCacheCreation']
    .some(key => Number(prices[key]) > 0);
  const priorityTier = String(serviceTier || '').trim().toLowerCase() === 'priority' && hasPriorityPrices;
  let inputPrice = priorityTier && Number(prices.priorityInput) > 0 ? prices.priorityInput : prices.input;
  let cachedInputPrice = priorityTier && Number(prices.priorityCachedInput) > 0
    ? prices.priorityCachedInput
    : hasNumericPrice(prices, 'cachedInput') ? prices.cachedInput : inputPrice;
  let cacheCreationPrice = priorityTier && Number(prices.priorityCacheCreation) > 0
    ? prices.priorityCacheCreation
    : hasNumericPrice(prices, 'cacheCreation') ? prices.cacheCreation : inputPrice;
  let outputPrice = priorityTier && Number(prices.priorityOutput) > 0 ? prices.priorityOutput : prices.output;
  let imageInputPrice = hasNumericPrice(prices, 'imageInput') ? prices.imageInput : inputPrice;
  let imageOutputPrice = hasNumericPrice(prices, 'imageOutput') ? prices.imageOutput : outputPrice;
  if (!hasNumericPrice(prices, 'cacheCreation') && normalizedModelCode(modelCode).startsWith('gpt-5.6')) {
    cacheCreationPrice = number(inputPrice) * 1.25;
  }

  const longContext = usesSub2ApiLongContextPricing(modelCode)
    && ordinaryInput + cached + cacheCreation > 272_000;
  if (longContext) {
    inputPrice = number(inputPrice) * 2;
    imageInputPrice = number(imageInputPrice) * 2;
    cachedInputPrice = number(cachedInputPrice) * 2;
    cacheCreationPrice = number(cacheCreationPrice) * 2;
    outputPrice = number(outputPrice) * 1.5;
    imageOutputPrice = number(imageOutputPrice) * 1.5;
  }

  const tierMultiplier = serviceTierMultiplier(serviceTier, hasPriorityPrices);
  const inputPriceCny = toCny(number(inputPrice), currency, usdCnyRate);
  const imageInputPriceCny = toCny(number(imageInputPrice), currency, usdCnyRate);
  const cachedInputPriceCny = toCny(number(cachedInputPrice), currency, usdCnyRate);
  const cacheCreationPriceCny = toCny(number(cacheCreationPrice), currency, usdCnyRate);
  const outputPriceCny = toCny(number(outputPrice), currency, usdCnyRate);
  const imageOutputPriceCny = toCny(number(imageOutputPrice), currency, usdCnyRate);

  const inputCost = (textInput / unit) * inputPriceCny * inputMultiplier * tierMultiplier;
  const imageInputCost = (imageInput / unit) * imageInputPriceCny * inputMultiplier * tierMultiplier;
  const cachedInputCost = (cached / unit) * cachedInputPriceCny * inputMultiplier * tierMultiplier;
  const cacheCreationCost = (cacheCreation / unit) * cacheCreationPriceCny * inputMultiplier * tierMultiplier;
  const outputCost = (textOutput / unit) * outputPriceCny * outputMultiplier * tierMultiplier;
  const imageOutputCost = (imageOutput / unit) * imageOutputPriceCny * outputMultiplier * tierMultiplier;
  const totalCost = inputCost + imageInputCost + cachedInputCost + cacheCreationCost + outputCost + imageOutputCost;

  return {
    inputTokens: input,
    textInputTokens: textInput,
    imageInputTokens: imageInput,
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    cacheCreation5mTokens: Math.max(number(cacheCreation5mTokens), 0),
    cacheCreation1hTokens: Math.max(number(cacheCreation1hTokens), 0),
    uncachedInputTokens: ordinaryInput,
    outputTokens: output,
    textOutputTokens: textOutput,
    imageOutputTokens: imageOutput,
    inputCost,
    imageInputCost,
    cachedInputCost,
    cacheCreationCost,
    outputCost,
    imageOutputCost,
    totalCost,
    longContextBillingApplied: longContext,
    serviceTierMultiplier: tierMultiplier,
  };
}

function calculatePricing({
  modelCode = '',
  inputTokens = 0,
  cachedInputTokens = 0,
  cacheCreationTokens = 0,
  cacheCreation5mTokens = 0,
  cacheCreation1hTokens = 0,
  imageInputTokens = 0,
  outputTokens = 0,
  imageOutputTokens = 0,
  official = {},
  multipliers = { input: 1, output: 1 },
  usdCnyRate = 7,
  serviceTier = '',
}) {
  const officialDimensions = calculateDimensions({
    modelCode,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    imageInputTokens,
    outputTokens,
    imageOutputTokens,
    prices: official,
    currency: official.currency,
    unitTokens: official.unitTokens,
    usdCnyRate,
    multipliers,
    serviceTier,
  });
  return {
    userCostPoints: officialDimensions.totalCost,
    officialCostCny: officialDimensions.totalCost,
    official: officialDimensions,
    longContextBillingApplied: officialDimensions.longContextBillingApplied,
  };
}

function calculateImagePricing({ imageCount = 0, unitPrice = 0, currency = 'CNY', multiplier = 1, usdCnyRate = 7 }) {
  const count = Math.max(Math.floor(number(imageCount)), 0);
  const price = Math.max(number(unitPrice), 0);
  const imageMultiplier = Math.max(number(multiplier, 1), 0);
  const officialUnitPriceCny = toCny(price, currency, usdCnyRate);
  const officialCostCny = count * officialUnitPriceCny;
  return {
    userCostPoints: officialCostCny * imageMultiplier,
    officialCostCny,
    image: {
      imageCount: count,
      unitPrice: price,
      unitPriceCny: officialUnitPriceCny,
      multiplier: imageMultiplier,
      totalCost: officialCostCny * imageMultiplier,
    },
  };
}

function parseImagePrices(serializedPrices) {
  if (serializedPrices && typeof serializedPrices === 'object' && !Array.isArray(serializedPrices)) {
    return serializedPrices;
  }
  if (typeof serializedPrices !== 'string' || !serializedPrices.trim()) return {};
  try {
    const parsed = JSON.parse(serializedPrices);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function configuredImageUnitPrice(serializedPrices, sizeTier) {
  const prices = parseImagePrices(serializedPrices);
  const tier = String(sizeTier || '2K').trim().toUpperCase();
  const legacyKeys = {
    '1K': ['1024x1024'],
    '2K': ['2048x2048', '2048x1152', '1536x1024', '1024x1536'],
    '4K': ['3840x2160', '2160x3840'],
  };
  for (const key of [tier, ...(legacyKeys[tier] || []), 'default']) {
    if (!Object.prototype.hasOwnProperty.call(prices, key)) continue;
    const price = Number(prices[key]);
    if (Number.isFinite(price) && price >= 0) return price;
  }
  return null;
}

function resolveImageUnitPrice({ serializedPrices, sizeTier = '2K', defaultPrice = 0.134 } = {}) {
  const configured = configuredImageUnitPrice(serializedPrices, sizeTier);
  if (configured !== null) return configured;
  const basePrice = Math.max(number(defaultPrice, 0.134), 0);
  const tier = String(sizeTier || '2K').trim().toUpperCase();
  if (tier === '4K') return basePrice * 2;
  if (tier === '2K') return basePrice * 1.5;
  return basePrice;
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
  const cacheCreation5mTokens = number(
    usage.cache_creation_5m_input_tokens
    ?? details.cache_creation_5m_tokens,
  );
  const cacheCreation1hTokens = number(
    usage.cache_creation_1h_input_tokens
    ?? details.cache_creation_1h_tokens,
  );
  const nestedCacheWriteField = ['cache_write_tokens', 'cache_creation_tokens']
    .find(field => Object.prototype.hasOwnProperty.call(details, field));
  const cacheCreationTokens = nestedCacheWriteField
    ? number(details[nestedCacheWriteField])
    : number(
      usage.cache_write_tokens
      ?? usage.cache_write_input_tokens
      ?? usage.cache_creation_input_tokens
      ?? usage.cache_creation_tokens
      ?? details.cache_creation_input_tokens,
      cacheCreation5mTokens + cacheCreation1hTokens,
    );
  const outputDetails = usage.output_tokens_details || usage.completion_tokens_details || {};
  const imageInputTokens = number(
    details.image_tokens
    ?? usage.image_input_tokens
    ?? usage.input_image_tokens,
  );
  const imageOutputTokens = number(
    outputDetails.image_tokens
    ?? usage.image_output_tokens
    ?? usage.output_image_tokens,
  );
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    imageInputTokens,
    imageOutputTokens,
  };
}

module.exports = {
  calculateImagePricing,
  calculatePricing,
  configuredImageUnitPrice,
  extractUsage,
  normalizeCurrency,
  resolveImageUnitPrice,
  toCny,
};
