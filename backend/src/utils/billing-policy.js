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

function channelTokenOfficial(model, channel = {}, usdCnyRate = 7) {
  const input = finitePrice(channel.input_price)
    ?? modelPricePerToken(model, 'official_input_price', '', usdCnyRate);
  const output = finitePrice(channel.output_price)
    ?? modelPricePerToken(model, 'official_output_price', '', usdCnyRate);
  const official = {
    currency: 'USD',
    unitTokens: 1,
    input,
    output,
    cachedInput: finitePrice(channel.cache_read_price)
      ?? modelPricePerToken(model, 'official_cached_input_price', 'official_input_price', usdCnyRate),
    cacheCreation: finitePrice(channel.cache_write_price) ?? input,
    imageInput: finitePrice(channel.image_input_price) ?? input,
    imageOutput: finitePrice(channel.image_output_price) ?? output,
  };
  if (finitePrice(channel.cache_write_price) === null
      && String(model?.model_code || '').toLowerCase().replace(/^openai\//, '').startsWith('gpt-5.6')) {
    delete official.cacheCreation;
  }
  return official;
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
    return finitePrice(channel.per_request_price);
  }
  const tierField = {
    '1K': 'image_price_1k',
    '2K': 'image_price_2k',
    '4K': 'image_price_4k',
  }[String(sizeTier || '2K').toUpperCase()];
  return finitePrice(channel[tierField]) ?? finitePrice(channel.per_request_price);
}

module.exports = {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveFixedUnitPrice,
};
