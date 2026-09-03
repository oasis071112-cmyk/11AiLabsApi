function finitePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function modelPricePerToken(model, field, fallbackField = '', usdCnyRate = 7) {
  const unit = Math.max(Number(model?.official_unit_tokens) || 1_000_000, 1);
  const primary = finitePrice(model?.[field]);
  const fallback = fallbackField ? finitePrice(model?.[fallbackField]) : null;
  const pricePerToken = (primary ?? fallback ?? 0) / unit;
  return String(model?.official_currency || 'CNY').trim().toUpperCase() === 'USD'
    ? pricePerToken
    : pricePerToken / Math.max(Number(usdCnyRate) || 7, 1e-12);
}

function billingModeForRequest(channel, isImageRequest = false) {
  const configured = String(channel?.billing_mode || '').trim().toLowerCase();
  if (['token', 'per_request', 'image'].includes(configured)) return configured;
  return isImageRequest ? 'image' : 'token';
}

function withProviderCachePricing(official, model, {
  explicitCacheWrite = false,
  nativeAnthropic = false,
} = {}) {
  const prices = { ...official };
  if (nativeAnthropic
      && String(model?.official_provider || '').trim().toLowerCase() === 'anthropic'
      && !explicitCacheWrite) {
    const input = finitePrice(prices.input) ?? 0;
    prices.cacheCreation = input * 1.25;
    prices.cacheCreation5m = input * 1.25;
    prices.cacheCreation1h = input * 2;
  }
  return prices;
}

function resolveCachePrices({
  modelCode = '', officialProvider = '', officialInput = 0, officialCachedInput = 0,
  officialCacheCreation = 0, officialCacheCreation5m = 0, officialCacheCreation1h = 0,
  channelCachedInput, channelCacheCreation, fallbackInput = 0, nativeAnthropic = false,
} = {}) {
  const hasOfficialCacheCreation = Number(officialCacheCreation) > 0;
  const official = withProviderCachePricing({
    input: officialInput,
    ...(Number(officialCachedInput) > 0 ? { cachedInput: officialCachedInput } : {}),
    ...(hasOfficialCacheCreation ? { cacheCreation: officialCacheCreation } : {}),
    ...(Number(officialCacheCreation5m) > 0 ? { cacheCreation5m: officialCacheCreation5m } : {}),
    ...(Number(officialCacheCreation1h) > 0 ? { cacheCreation1h: officialCacheCreation1h } : {}),
  }, { official_provider: officialProvider }, {
    explicitCacheWrite: hasOfficialCacheCreation,
    nativeAnthropic,
  });
  const derivesGptCacheCreation = String(modelCode || '').toLowerCase()
    .replace(/^openai\//, '').startsWith('gpt-5.6')
    && Number(officialInput) > 0
    && !hasOfficialCacheCreation;
  if (derivesGptCacheCreation) official.cacheCreation = Number(officialInput) * 1.25;

  return {
    cachedInput: Number(official.cachedInput) > 0
      ? official.cachedInput
      : finitePrice(channelCachedInput) ?? fallbackInput,
    cacheCreation: Number(official.cacheCreation) > 0
      ? official.cacheCreation
      : finitePrice(channelCacheCreation) ?? fallbackInput,
    ...(Number(official.cacheCreation5m) > 0 ? { cacheCreation5m: official.cacheCreation5m } : {}),
    ...(Number(official.cacheCreation1h) > 0 ? { cacheCreation1h: official.cacheCreation1h } : {}),
  };
}

function channelTokenOfficial(model, channel = {}, usdCnyRate = 7) {
  const officialInput = modelPricePerToken(model, 'official_input_price', '', usdCnyRate);
  const officialCachedInput = modelPricePerToken(model, 'official_cached_input_price', '', usdCnyRate);
  const officialCacheCreation = modelPricePerToken(model, 'official_cache_creation_price', '', usdCnyRate);
  const input = finitePrice(channel.input_price)
    ?? officialInput;
  const output = finitePrice(channel.output_price)
    ?? modelPricePerToken(model, 'official_output_price', '', usdCnyRate);
  const cachePrices = resolveCachePrices({
    modelCode: model?.model_code,
    officialProvider: model?.official_provider,
    officialInput,
    officialCachedInput,
    officialCacheCreation,
    channelCachedInput: channel.cache_read_price,
    channelCacheCreation: channel.cache_write_price,
    fallbackInput: input,
    nativeAnthropic: channel.protocol_type === 'anthropic',
  });

  return {
    currency: 'USD',
    unitTokens: 1,
    input,
    output,
    ...cachePrices,
    imageInput: finitePrice(channel.image_input_price) ?? input,
    imageOutput: finitePrice(channel.image_output_price) ?? output,
  };
}

function resolveBillingModel(source, {
  requested = '',
  channelMapped = '',
  upstream = '',
} = {}) {
  const normalized = String(source || 'channel_mapped').trim().toLowerCase();
  if (normalized === 'requested') return requested || channelMapped || upstream;
  if (normalized === 'upstream') return upstream || channelMapped || requested;
  return channelMapped || requested || upstream;
}

function resolveFixedUnitPrice(channel = {}, sizeTier = '2K') {
  if (String(channel.billing_mode || '').trim().toLowerCase() === 'per_request') {
    const unitPrice = finitePrice(channel.per_request_price);
    return unitPrice > 0 ? unitPrice : null;
  }
  const tierField = {
    '1K': 'image_price_1k',
    '2K': 'image_price_2k',
    '4K': 'image_price_4k',
  }[String(sizeTier || '2K').toUpperCase()];
  const unitPrice = finitePrice(channel[tierField]);
  return unitPrice > 0 ? unitPrice : null;
}

module.exports = {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveCachePrices,
  resolveFixedUnitPrice,
  withProviderCachePricing,
};
