const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticateApiKey } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { selectChannel, reportResult } = require('../utils/channel-selector');
const { apiKeyCanUseModel, listModelsForApiKey } = require('../utils/routing-group-models');
const {
  calculateImagePricing,
  calculatePricing,
  configuredImageUnitPrice,
  extractUsage,
  resolveImageUnitPrice,
} = require('../utils/pricing-engine');
const {
  classifyImageBillingTier,
  countGeneratedImages,
  generatedImageOutputSizes,
  imageBillingIntent,
  resolveImageBillingSize,
} = require('../utils/image-billing');
const { resolveChatOutputLimit } = require('../utils/request-limits');
const {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveFixedUnitPrice,
} = require('../utils/billing-policy');
const {
  releaseWalletReservation,
  reserveWalletBalance,
  settleWalletReservation,
  walletBalances,
} = require('../utils/wallet-billing');

function positiveOrOne(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function getEffectiveMultiplier(db, modelCode, userId) {
  const now = new Date().toISOString();
  const rules = db.prepare("SELECT * FROM pricing_rules WHERE (model_code=? OR model_code IS NULL) AND status='active' AND (start_time IS NULL OR start_time<=?) AND (end_time IS NULL OR end_time>=?) AND ((scope_type='user' AND scope_id=?) OR scope_type='platform') ORDER BY CASE scope_type WHEN 'user' THEN 2 WHEN 'platform' THEN 1 END DESC, priority DESC").all(modelCode, now, now, userId);
  for (const rule of rules) {
    if (rule.scope_type === 'user' && String(rule.scope_id) === String(userId)) return rule;
    if (rule.scope_type === 'platform') return rule;
  }
  return null;
}

function getUsdCnyRate(db) {
  const value = Number(db.prepare("SELECT config_value FROM system_config WHERE config_key='usd_cny_exchange_rate'").get()?.config_value);
  return Number.isFinite(value) && value > 0 ? value : 7;
}

function channelHasTokenPricing(channel = {}) {
  channel = channel || {};
  return ['input_price', 'output_price', 'cache_write_price', 'cache_read_price', 'image_input_price', 'image_output_price']
    .some(field => channel[field] !== null && channel[field] !== undefined && channel[field] !== '');
}

function channelBillingForModel(db, channel, modelCode) {
  if (!channel?.id || !modelCode) return channel;
  const mapping = db.prepare(`SELECT upstream_model_name,billing_mode,billing_model_source,
    input_price,output_price,cache_write_price,cache_read_price,image_input_price,image_output_price,
    per_request_price,image_price_1k,image_price_2k,image_price_4k
    FROM channel_models WHERE channel_id=? AND model_code=? AND status='active'`).get(channel.id, modelCode);
  return mapping ? { ...channel, ...mapping } : channel;
}

function pricingModelForChannel(db, requestedModel, channel, usage = {}) {
  const billingModel = resolveBillingModel(channel?.billing_model_source, {
    requested: requestedModel.model_code,
    channelMapped: channel?.upstream_model_name,
    upstream: usage.upstreamModel,
  });
  if (!billingModel || billingModel === requestedModel.model_code) return requestedModel;
  return db.prepare(`SELECT * FROM models WHERE status='active'
    AND (model_code=? OR official_model_id=? OR upstream_model_name=?)
    ORDER BY CASE WHEN model_code=? THEN 0 WHEN official_model_id=? THEN 1 ELSE 2 END LIMIT 1`)
    .get(billingModel, billingModel, billingModel, billingModel, billingModel) || requestedModel;
}

function buildPricing(db, model, usage, multipliers, { channel = null, serviceTier = '' } = {}) {
  const usdCnyRate = getUsdCnyRate(db);
  const official = channelHasTokenPricing(channel)
    ? channelTokenOfficial(model, channel, usdCnyRate)
    : {
      currency: model.official_currency,
      input: model.official_input_price,
      output: model.official_output_price,
      cachedInput: model.official_cached_input_price,
      unitTokens: model.official_unit_tokens,
    };
  const prices = calculatePricing({
    modelCode: model.model_code,
    ...usage,
    official,
    multipliers,
    usdCnyRate,
    serviceTier,
  });
  return { ...prices, currency: official.currency, officialPrices: official, usdCnyRate };
}

function buildImagePricing(db, model, { imageCount, size, multiplier }) {
  const usdCnyRate = getUsdCnyRate(db);
  const configuredPrice = configuredImageUnitPrice(model.official_image_prices, size);
  const unitPrice = resolveImageUnitPrice({
    serializedPrices: model.official_image_prices,
    sizeTier: size,
  });
  const currency = configuredPrice === null ? 'USD' : model.official_currency;
  const prices = calculateImagePricing({
    imageCount,
    unitPrice,
    currency,
    multiplier,
    usdCnyRate,
  });
  return { ...prices, currency, unitPrice, usdCnyRate };
}

function buildChannelImagePricing(db, model, channel, { imageCount, size, multiplier }) {
  const configuredUnitPrice = resolveFixedUnitPrice(channel, size);
  if (configuredUnitPrice === null) {
    return buildImagePricing(db, model, { imageCount, size, multiplier });
  }
  const usdCnyRate = getUsdCnyRate(db);
  return {
    ...calculateImagePricing({
      imageCount,
      unitPrice: configuredUnitPrice,
      currency: 'USD',
      multiplier,
      usdCnyRate,
    }),
    currency: 'USD',
    unitPrice: configuredUnitPrice,
    usdCnyRate,
  };
}

function buildRequestPricing(db, model, channel, usage, multipliers, serviceTier = '') {
  const pricingModel = pricingModelForChannel(db, model, channel, usage);
  const mode = billingModeForRequest(channel, false);
  if (mode === 'token') {
    return {
      ...buildPricing(db, pricingModel, usage, multipliers, { channel, serviceTier }),
      pricingModel,
    };
  }
  const unitPrice = resolveFixedUnitPrice(channel, '2K');
  if (unitPrice === null) throw new Error(`渠道 ${mode} 计费模式尚未配置固定价格`);
  const usdCnyRate = getUsdCnyRate(db);
  return {
    ...calculateImagePricing({
      imageCount: 1,
      unitPrice,
      currency: 'USD',
      multiplier: positiveOrOne(multipliers.input),
      usdCnyRate,
    }),
    currency: 'USD',
    unitPrice,
    pricingModel,
    usdCnyRate,
  };
}

function insertSuccessLog(db, { requestId, userId, apiKeyId, modelCode, channelId, usage, pricing, model, multipliers, requestIp, latencyMs }) {
  const channelBilling = db.prepare(`SELECT upstream_model_name,billing_mode,billing_model_source,
    input_price,output_price,cache_write_price,cache_read_price,image_input_price,image_output_price,
    per_request_price,image_price_1k,image_price_2k,image_price_4k
    FROM channel_models WHERE channel_id=? AND model_code=? AND status='active'`).get(channelId, modelCode) || {};
  const logBillingMode = billingModeForRequest(channelBilling, false);
  const official = logBillingMode !== 'token'
    ? { currency: 'USD', input: 0, output: 0, cachedInput: 0, unitTokens: 1 }
    : channelHasTokenPricing(channelBilling)
      ? channelTokenOfficial(model, channelBilling, getUsdCnyRate(db))
      : {
      currency: model.official_currency,
      input: model.official_input_price,
      output: model.official_output_price,
      cachedInput: model.official_cached_input_price,
      unitTokens: model.official_unit_tokens,
      };
  let billingModelSource = channelBilling.billing_model_source || 'channel_mapped';
  let billingModel = resolveBillingModel(billingModelSource, {
    requested: modelCode,
    channelMapped: channelBilling.upstream_model_name,
    upstream: usage.upstreamModel,
  });
  const hasExplicitChannelPrice = logBillingMode === 'token'
    ? channelHasTokenPricing(channelBilling)
    : resolveFixedUnitPrice(channelBilling, '2K') !== null;
  if (!hasExplicitChannelPrice && billingModel !== model.model_code) {
    billingModel = model.model_code;
    billingModelSource = 'requested';
  }
  db.prepare(`INSERT INTO api_request_logs (
    request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,cached_input_tokens,output_tokens,total_cost,
    official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,
    usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny,status,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'success',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, channelId, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, pricing.userCostPoints,
    model.official_provider, official.currency, official.input, official.output, official.cachedInput, official.unitTokens,
    pricing.usdCnyRate, multipliers.input, multipliers.output, pricing.officialCostCny, requestIp, latencyMs,
  );
  db.prepare(`UPDATE api_request_logs SET
    billing_mode=?,billing_model=?,billing_model_source=?,
    cache_creation_tokens=?,image_input_tokens=?,image_output_tokens=?,
    service_tier=?,long_context_billing_applied=?,
    official_cache_creation_price=?,official_image_input_price=?,official_image_output_price=?,
    official_image_unit_price=?
    WHERE request_id=?`).run(
    logBillingMode, billingModel, billingModelSource,
    usage.cacheCreationTokens || 0, usage.imageInputTokens || 0, usage.imageOutputTokens || 0,
    usage.serviceTier || '', pricing.longContextBillingApplied ? 1 : 0,
    pricing.officialPrices?.cacheCreation ?? null,
    pricing.officialPrices?.imageInput ?? null,
    pricing.officialPrices?.imageOutput ?? null,
    pricing.unitPrice || 0,
    requestId,
  );
}

function insertSettlementFailureLog(db, { requestId, userId, apiKeyId, modelCode, channelId, usage, pricing, model, multipliers, requestIp, latencyMs, error }) {
  db.prepare(`INSERT OR IGNORE INTO api_request_logs (
    request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,cached_input_tokens,output_tokens,total_cost,
    official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,
    usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny,status,error_message,error_type,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'failed',?,'settlement_failed',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, channelId, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, pricing.userCostPoints,
    model.official_provider, model.official_currency, model.official_input_price, model.official_output_price, model.official_cached_input_price, model.official_unit_tokens,
    pricing.usdCnyRate, multipliers.input, multipliers.output, pricing.officialCostCny, error, requestIp, latencyMs,
  );
}

function insertUpstreamFailureLog(db, {
  requestId, userId, apiKeyId, modelCode, channelId, requestIp, latencyMs, error, billingMode = 'token',
}) {
  db.prepare("INSERT OR IGNORE INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,billing_mode,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,?,?,'failed',?,'upstream_error',?,?)")
    .run(requestId, userId, apiKeyId, modelCode, channelId || null, billingMode, error, requestIp, latencyMs);
}

function insertImageSuccessLog(db, {
  requestId, userId, apiKeyId, modelCode, billingModel, channelId, imageCount,
  size, inputSize, outputSize, sizeSource, sizeBreakdown, quality, pricing, model,
  multiplier, requestIp, latencyMs, billingModelSource = 'channel_mapped',
  billingMode = 'image', usage = {}, tokenMultipliers = { input: 1, output: 1 },
}) {
  db.prepare(`INSERT INTO api_request_logs (
    request_id,user_id,api_key_id,model_code,billing_model,upstream_channel_id,total_cost,
    official_provider,official_currency,usd_cny_rate,official_cost_cny,billing_mode,
    image_count,image_size,image_quality,official_image_unit_price,billing_multiplier_image,
    status,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'success',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, billingModel, channelId, pricing.userCostPoints,
    model.official_provider, pricing.currency || model.official_currency, pricing.usdCnyRate, pricing.officialCostCny,
    billingMode, imageCount, size, quality, pricing.unitPrice || 0, multiplier,
    requestIp, latencyMs,
  );
  db.prepare(`UPDATE api_request_logs SET
    image_input_size=?,image_output_size=?,image_size_source=?,image_size_breakdown=?,billing_model_source=?,
    input_tokens=?,cached_input_tokens=?,cache_creation_tokens=?,output_tokens=?,image_input_tokens=?,image_output_tokens=?,
    service_tier=?,long_context_billing_applied=?,
    official_input_price=?,official_output_price=?,official_cached_input_price=?,official_unit_tokens=?,
    official_cache_creation_price=?,official_image_input_price=?,official_image_output_price=?,
    billing_multiplier_input=?,billing_multiplier_output=?
    WHERE request_id=?`).run(
    inputSize, outputSize, sizeSource, JSON.stringify(sizeBreakdown || []), billingModelSource,
    usage.inputTokens || 0, usage.cachedInputTokens || 0, usage.cacheCreationTokens || 0,
    usage.outputTokens || 0, usage.imageInputTokens || 0, usage.imageOutputTokens || 0,
    usage.serviceTier || '', pricing.longContextBillingApplied ? 1 : 0,
    pricing.officialPrices?.input ?? 0,
    pricing.officialPrices?.output ?? 0,
    pricing.officialPrices?.cachedInput ?? 0,
    pricing.officialPrices?.unitTokens ?? model.official_unit_tokens,
    pricing.officialPrices?.cacheCreation ?? null,
    pricing.officialPrices?.imageInput ?? null,
    pricing.officialPrices?.imageOutput ?? null,
    tokenMultipliers.input, tokenMultipliers.output,
    requestId,
  );
}

function insertImageSettlementFailureLog(db, {
  requestId, userId, apiKeyId, modelCode, billingModel, channelId, imageCount, size, quality,
  pricing, model, multiplier, requestIp, latencyMs, error,
}) {
  db.prepare(`INSERT OR IGNORE INTO api_request_logs (
    request_id,user_id,api_key_id,model_code,billing_model,upstream_channel_id,total_cost,
    official_provider,official_currency,usd_cny_rate,official_cost_cny,billing_mode,
    image_count,image_size,image_quality,official_image_unit_price,billing_multiplier_image,
    status,error_message,error_type,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'image',?,?,?,?,?,'failed',?,'settlement_failed',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, billingModel, channelId, pricing.userCostPoints,
    model.official_provider, model.official_currency, pricing.usdCnyRate, pricing.officialCostCny,
    imageCount, size, quality, pricing.unitPrice, multiplier, error, requestIp, latencyMs,
  );
}

function listModels(req, res) {
  const db = getDatabase();
  const models = listModelsForApiKey(db, req.apiKey);
  res.json({ object: 'list', data: models.map(m => ({
    id: m.model_code,
    object: 'model',
    created: 0,
    owned_by: 'ai-proxy',
    capabilities: m.capabilities || { chat_completions: true, image_input: false, image_generations: false, responses: false },
  })) });
}

function estimatedInputTokens(value) {
  // 对纯文本使用 UTF-8 字节数上界，再留出结构余量；BPE tokenizer 的 Token 数不会高于字节数。
  return Math.max(1, Buffer.byteLength(String(value ?? ''), 'utf8') + 256);
}

function billableTextProjection(value, key = '') {
  const normalizedKey = String(key).toLowerCase();
  // 图片 URL（包括 data: Base64）只是传输载体，绝不能作为文本 Token 计入。
  if (normalizedKey === 'image_url' || normalizedKey === 'input_image') return '[image]';
  if (Array.isArray(value)) return value.map(item => billableTextProjection(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, childValue]) => [childKey, billableTextProjection(childValue, childKey)]));
}

function imageDimensionsFromDataUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('data:image/')) return null;
  const comma = url.indexOf(',');
  if (comma < 0 || !/;base64/i.test(url.slice(0, comma))) return null;
  let bytes;
  try { bytes = Buffer.from(url.slice(comma + 1), 'base64'); } catch (error) { return null; }
  if (bytes.length < 10) return null;
  // PNG / GIF / JPEG / WebP 的尺寸读取只用于请求前保守冻结；最终金额一律以上游 usage 为准。
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if ((bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a') && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && length >= 7) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      if (!length) break;
      offset += 2 + length;
    }
  }
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' && bytes.subarray(12, 16).toString() === 'VP8X' && bytes.length >= 30) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  return null;
}

function listImageInputs(value, key = '') {
  const normalizedKey = String(key).toLowerCase();
  if (normalizedKey === 'image_url' || normalizedKey === 'input_image') {
    const image = value && typeof value === 'object' ? value : {};
    return [{ url: image.url || image.image_url || image.source?.url || '', detail: image.detail || 'auto' }];
  }
  if (Array.isArray(value)) return value.flatMap(item => listImageInputs(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, childValue]) => listImageInputs(childValue, childKey));
}

function estimatedImageReservationTokens(requestBody) {
  return listImageInputs(requestBody.messages ?? requestBody.input ?? requestBody)
    .reduce((total, image) => {
      if (String(image.detail).toLowerCase() === 'low') return total + 512;
      // URL 图片在请求前无法安全取得分辨率，按上游通常会缩放到的 2048px 上限预留。
      const dimensions = imageDimensionsFromDataUrl(image.url) || { width: 2048, height: 2048 };
      const width = Math.max(1, Number(dimensions.width) || 2048);
      const height = Math.max(1, Number(dimensions.height) || 2048);
      const scale = Math.min(1, 2048 / Math.max(width, height));
      const tiles = Math.ceil(width * scale / 512) * Math.ceil(height * scale / 512);
      // 高/自动模式每个 512px 视觉块预留 1,024 Token，并加基础视觉开销。
      return total + 1024 + tiles * 1024;
    }, 0);
}

function estimatedChatInputTokens(requestBody) {
  const requestInput = requestBody.messages ?? requestBody.input ?? requestBody;
  return estimatedInputTokens(JSON.stringify(billableTextProjection(requestInput)))
    + estimatedImageReservationTokens(requestBody);
}

function unsupportedContentError(message) {
  const error = new Error(message);
  error.status = 400;
  error.type = 'unsupported_content';
  return error;
}

function requestContainsImage(value, key = '') {
  const normalizedKey = String(key).toLowerCase();
  if (normalizedKey === 'image_url' || normalizedKey === 'input_image') return true;
  if (Array.isArray(value)) return value.some(item => requestContainsImage(item, key));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([childKey, childValue]) => requestContainsImage(childValue, childKey));
}

function assertSupportedBillableInput(value, model, key = '') {
  const normalizedKey = String(key).toLowerCase();
  const imageKeys = new Set(['image_url', 'input_image']);
  const unsupportedKeys = new Set(['input_audio', 'audio', 'file', 'file_id']);
  if (imageKeys.has(normalizedKey)) {
    return;
  }
  if (unsupportedKeys.has(normalizedKey)) throw unsupportedContentError('当前仅支持文本和已配置的图片输入');
  if (Array.isArray(value)) {
    for (const item of value) assertSupportedBillableInput(item, model, key);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (key === 'content' && value.type) {
    if (['image_url', 'input_image'].includes(value.type)) {
      return;
    }
    if (!['text', 'input_text', 'output_text'].includes(value.type)) {
      throw unsupportedContentError('当前仅支持文本和已配置的图片输入');
    }
  }
  for (const [childKey, childValue] of Object.entries(value)) assertSupportedBillableInput(childValue, model, childKey);
}

function assertEmbeddingTextInput(input) {
  if (typeof input === 'string') return;
  if (Array.isArray(input) && input.every(item => typeof item === 'string')) return;
  throw new Error('向量接口当前仅支持文本或文本数组输入');
}

function hasBillableUsage(payload) {
  if (!payload?.usage) return false;
  const usage = extractUsage(payload.usage);
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedInputTokens > 0
    || usage.cacheCreationTokens > 0 || usage.imageInputTokens > 0 || usage.imageOutputTokens > 0;
}

function normalizeVisibleChatContent(payload, streaming = false, allowReasoningFallback = false) {
  if (!payload || !Array.isArray(payload.choices)) return payload;
  for (const choice of payload.choices) {
    const target = streaming ? choice?.delta : choice?.message;
    if (!target || (typeof target.content === 'string' && target.content.length > 0)) continue;
    const fallback = target.output_text ?? target.text ?? choice?.text
      ?? (allowReasoningFallback ? target.reasoning_content : undefined);
    if (typeof fallback === 'string' && fallback.length > 0) target.content = fallback;
  }
  return payload;
}

function fallbackChatUsage(requestBody, responseBody = {}) {
  const content = responseBody?.choices?.map(choice => choice?.message?.content || '').join('') || '';
  return {
    inputTokens: estimatedChatInputTokens(requestBody),
    outputTokens: content ? estimatedInputTokens(content) : 0,
    cachedInputTokens: 0,
  };
}

function fallbackEmbeddingUsage(requestBody) {
  return {
    inputTokens: estimatedInputTokens(JSON.stringify(requestBody.input ?? requestBody)),
    outputTokens: 0,
    cachedInputTokens: 0,
  };
}

function capChatRequestToReservedBalance(db, model, channel, multipliers, requestBody, availableBalance) {
  if (billingModeForRequest(channel, false) !== 'token') {
    const reservationAmount = buildRequestPricing(
      db, model, channel, {}, multipliers, requestBody.service_tier || '',
    ).userCostPoints;
    if (reservationAmount <= 0 || reservationAmount > availableBalance + 1e-9) {
      throw new Error('额度不足以覆盖本次请求预算');
    }
    return { body: { ...requestBody }, reservationAmount };
  }
  const inputTokens = estimatedChatInputTokens(requestBody);
  const pricingModel = pricingModelForChannel(db, model, channel);
  const pricingOptions = { channel, serviceTier: requestBody.service_tier || '' };
  const inputCost = buildPricing(db, pricingModel, { inputTokens, cachedInputTokens: 0, outputTokens: 0 }, multipliers, pricingOptions).userCostPoints;
  const outputOneToken = buildPricing(db, pricingModel, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 1 }, multipliers, pricingOptions).userCostPoints;
  if (inputCost + 1e-9 >= availableBalance || outputOneToken <= 0) throw new Error('额度不足以覆盖本次请求的输入与最小输出');

  const maxAffordableOutput = Math.floor((availableBalance - inputCost) / outputOneToken);
  if (maxAffordableOutput < 1) throw new Error('额度不足以覆盖本次请求的最小输出');

  const body = { ...requestBody };
  const { limitField, maxTokens } = resolveChatOutputLimit({
    model, requestBody: body, estimatedInputTokens: inputTokens, maxAffordableOutput,
  });
  body[limitField] = maxTokens;
  const reservationAmount = buildPricing(db, pricingModel, {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens: maxTokens,
  }, multipliers, pricingOptions).userCostPoints;
  if (reservationAmount <= 0 || reservationAmount > availableBalance + 1e-9) {
    throw new Error('额度不足以覆盖本次请求预算');
  }
  return { body, reservationAmount };
}

function availableWalletBalance(db, userId) {
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
  const { available } = walletBalances(wallet);
  if (available <= 0) throw new Error('额度不足，请购买额度包后重试');
  return available;
}

const SAFE_FAILOVER_STATUSES = new Set([401, 403, 404, 429]);

async function postWithSafeFailover({
  db, modelCode, routingGroupId, initialChannel, endpoint, body, config, requirements = {}, transformBody,
}) {
  let channel = initialChannel;
  const excludedChannelIds = new Set();
  while (channel) {
    const mappedBody = { ...body, model: channel.upstream_model_name || body.model || modelCode };
    const requestBody = transformBody ? transformBody(mappedBody, channel) : mappedBody;
    try {
      const response = await axios.post(`${channel.base_url}/${endpoint}`, requestBody, config(channel));
      return { response, channel, requestBody };
    } catch (error) {
      if (!SAFE_FAILOVER_STATUSES.has(Number(error.response?.status))) {
        error.upstreamChannel = channel;
        throw error;
      }
      const failedChannel = channel;
      reportResult(db, channel.id, false);
      error.failoverReported = true;
      excludedChannelIds.add(channel.id);
      channel = selectChannel(db, modelCode, routingGroupId, new Set(), excludedChannelIds, requirements);
      if (!channel) {
        error.upstreamChannel = failedChannel;
        throw error;
      }
    }
  }
  throw new Error('暂无可用上游渠道');
}

async function upstreamErrorMessage(error) {
  const upstreamBody = error.response?.data;
  if (upstreamBody?.error?.message) return upstreamBody.error.message;
  if (typeof upstreamBody === 'string') return upstreamBody;
  if (!upstreamBody || typeof upstreamBody.on !== 'function') return error.message;

  const raw = await new Promise(resolve => {
    let content = '';
    upstreamBody.on('data', chunk => { content += chunk.toString(); });
    upstreamBody.on('end', () => resolve(content));
    upstreamBody.on('error', () => resolve(content));
  });
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw || error.message;
  } catch (parseError) {
    return raw || error.message;
  }
}

// 兼容部分客户端直接 GET Base URL 来刷新模型列表。
router.get('/', authenticateApiKey, listModels);
router.get('/models', authenticateApiKey, listModels);

async function handleImageBilledRequest(req, res, { endpoint, endpointCapability }) {
  const db = getDatabase();
  const requestId = 'req_' + uuidv4().replace(/-/g, '').substring(0, 16);
  const modelCode = String(req.body.model || '').trim();
  const startTime = Date.now();
  const intent = imageBillingIntent({ endpoint, body: req.body });
  let channel = null;
  let reservedAmount = 0;
  let upstreamConfirmed = false;
  let actualImageCount = 0;
  let settlementPricing = null;
  let confirmedBillingModel = intent?.billingModel || modelCode;
  let resolvedImageSize = resolveImageBillingSize({ inputSize: intent?.size });
  let billingMode = 'image';
  let billingChannel = null;

  if (!intent) {
    return res.status(400).json({ error: {
      message: 'Responses 图片计费仅接受 image_generation 工具或图片模型请求',
      type: 'image_generation_intent_required',
    } });
  }
  const imageTools = Array.isArray(req.body.tools)
    ? req.body.tools.filter(tool => tool?.type === 'image_generation')
    : [];
  if (imageTools.length > 1) {
    return res.status(400).json({ error: {
      message: '每个 Responses 请求只能声明一个 image_generation 工具',
      type: 'multiple_image_generation_tools',
    } });
  }
  if (endpoint === 'responses' && req.body.stream === true) {
    return res.status(400).json({ error: {
      message: '当前图片计费模式暂不支持流式 Responses，请设置 stream=false',
      type: 'streaming_image_generation_unsupported',
    } });
  }

  if (!modelCode || !apiKeyCanUseModel(db, req.apiKey, modelCode)) {
    const message = modelCode ? `模型 ${modelCode} 未授权` : '图片生成请求必须指定模型';
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,billing_mode,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'image','blocked',?,'unauthorized_model',?,?)")
      .run(requestId, req.userId, req.apiKey.id, modelCode || null, message, req.ip, Date.now() - startTime);
    return res.status(modelCode ? 403 : 400).json({ error: { message, type: 'unauthorized_model' } });
  }

  const model = db.prepare("SELECT * FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model) return res.status(404).json({ error: { message: `模型 ${modelCode} 不可用`, type: 'model_unavailable' } });
  if (intent.billingModel !== modelCode && !apiKeyCanUseModel(db, req.apiKey, intent.billingModel)) {
    return res.status(403).json({ error: {
      message: `图片计费模型 ${intent.billingModel} 未授权`,
      type: 'unauthorized_image_model',
    } });
  }
  const billingModelCandidate = intent.billingModel !== modelCode
    ? db.prepare("SELECT * FROM models WHERE model_code=? AND status='active'").get(intent.billingModel)
    : null;
  const pricingModel = billingModelCandidate || model;
  const pricingRule = getEffectiveMultiplier(db, pricingModel.model_code, req.userId);
  const imageMultiplier = positiveOrOne(pricingRule
    ? pricingRule.billing_multiplier_image
    : pricingModel.billing_multiplier_image);
  const requirements = {
    endpointCapability,
    requiredMappedModelCode: intent.billingModel !== modelCode ? intent.billingModel : null,
  };
  channel = selectChannel(db, modelCode, req.apiKey.routing_group_id, new Set(), new Set(), requirements);
  if (!channel) {
    return res.status(503).json({ error: { message: `暂无支持 ${endpoint} 的可用上游渠道`, type: 'no_channel' } });
  }
  billingChannel = channelBillingForModel(db, channel, intent.billingModel);
  billingMode = billingModeForRequest(billingChannel, true);
  const reservationPricingModel = pricingModelForChannel(db, pricingModel, billingChannel);
  const reservationPricing = billingMode === 'token'
    ? buildImagePricing(db, reservationPricingModel, {
      imageCount: intent.requestedCount,
      size: resolvedImageSize.billingSize,
      multiplier: imageMultiplier,
    })
    : buildChannelImagePricing(db, reservationPricingModel, billingChannel, {
    imageCount: intent.requestedCount,
    size: resolvedImageSize.billingSize,
    multiplier: imageMultiplier,
  });

  try {
    const available = availableWalletBalance(db, req.userId);
    if (available + 1e-9 < reservationPricing.userCostPoints) throw new Error('额度不足，请购买额度包后重试');
    reservedAmount = reserveWalletBalance(db, req.userId, reservationPricing.userCostPoints, requestId).reserved;
  } catch (error) {
    return res.status(402).json({ error: { message: error.message, type: 'insufficient_balance' } });
  }

  try {
    const upstreamResult = await postWithSafeFailover({
      db,
      modelCode,
      routingGroupId: req.apiKey.routing_group_id,
      initialChannel: channel,
      endpoint,
      body: req.body,
      requirements,
      transformBody: endpoint === 'responses' ? (body, selected) => {
        const mappedImageModel = intent.billingModel === modelCode
          ? selected.upstream_model_name
          : db.prepare("SELECT upstream_model_name FROM channel_models WHERE channel_id=? AND model_code=? AND status='active'")
            .get(selected.id, intent.billingModel)?.upstream_model_name;
        if (!mappedImageModel || !Array.isArray(body.tools)) return body;
        return {
          ...body,
          tools: body.tools.map(tool => tool?.type === 'image_generation'
            ? { ...tool, model: mappedImageModel }
            : tool),
        };
      } : undefined,
      config: selected => ({
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.api_key}` },
        timeout: 300000,
      }),
    });
    channel = upstreamResult.channel;
    billingChannel = channelBillingForModel(db, channel, intent.billingModel);
    billingMode = billingModeForRequest(billingChannel, true);
    upstreamConfirmed = true;
    const channelMappedBillingModel = endpoint === 'images/generations'
      ? String(upstreamResult.requestBody.model || intent.billingModel)
      : String(upstreamResult.requestBody.tools?.find(tool => tool?.type === 'image_generation')?.model || intent.billingModel);
    let effectiveBillingModelSource = billingChannel.billing_model_source || 'channel_mapped';
    confirmedBillingModel = resolveBillingModel(effectiveBillingModelSource, {
      requested: intent.billingModel,
      channelMapped: channelMappedBillingModel,
      upstream: String(upstreamResult.response.data?.model || channelMappedBillingModel),
    });
    actualImageCount = countGeneratedImages(upstreamResult.response.data);
    if (actualImageCount <= 0) {
      releaseWalletReservation(db, req.userId, reservedAmount, requestId, '上游未返回有效图片，释放冻结额度');
      reservedAmount = 0;
      insertUpstreamFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        requestIp: req.ip, latencyMs: Date.now() - startTime, error: '上游未返回有效图片结果', billingMode: 'image',
      });
      reportResult(db, channel.id, false);
      return res.status(502).json({ error: { message: '上游未返回有效图片，本次未扣费', type: 'empty_image_result' } });
    }
    const outputSizes = generatedImageOutputSizes(upstreamResult.response.data);
    resolvedImageSize = resolveImageBillingSize({ inputSize: intent.size, outputSizes });
    const usage = extractUsage(upstreamResult.response.data?.usage || {});
    usage.serviceTier = upstreamResult.response.data?.service_tier || req.body.service_tier || '';
    usage.upstreamModel = String(upstreamResult.response.data?.model || channelMappedBillingModel);
    const settlementPricingModel = pricingModelForChannel(db, pricingModel, billingChannel, usage);
    const hasExplicitChannelPrice = billingMode === 'token'
      ? channelHasTokenPricing(billingChannel)
      : resolveFixedUnitPrice(billingChannel, resolvedImageSize.billingSize) !== null;
    if (!hasExplicitChannelPrice && confirmedBillingModel !== settlementPricingModel.model_code) {
      confirmedBillingModel = settlementPricingModel.model_code;
      effectiveBillingModelSource = 'requested';
    }
    const tokenMultipliers = {
      input: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_input : pricingModel.billing_multiplier_input),
      output: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_output : pricingModel.billing_multiplier_output),
    };
    settlementPricing = billingMode === 'token'
      ? buildPricing(db, settlementPricingModel, usage, tokenMultipliers, {
        channel: billingChannel, serviceTier: usage.serviceTier,
      })
      : buildChannelImagePricing(db, settlementPricingModel, billingChannel, {
        imageCount: actualImageCount, size: resolvedImageSize.billingSize, multiplier: imageMultiplier,
      });
    settleWalletReservation(db, {
      userId: req.userId,
      reservedAmount,
      chargeAmount: settlementPricing.userCostPoints,
      requestId,
      writeSuccessLog: () => insertImageSuccessLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode,
        billingModel: confirmedBillingModel, channelId: channel.id, imageCount: actualImageCount,
        size: resolvedImageSize.billingSize,
        inputSize: classifyImageBillingTier(intent.size) || '',
        outputSize: resolvedImageSize.source === 'output' ? resolvedImageSize.billingSize : '',
        sizeSource: resolvedImageSize.source,
        sizeBreakdown: outputSizes.map(size => classifyImageBillingTier(size)).filter(Boolean),
        quality: intent.quality, pricing: settlementPricing, model: settlementPricingModel,
        billingMode, billingModelSource: effectiveBillingModelSource,
        usage, tokenMultipliers,
        multiplier: imageMultiplier, requestIp: req.ip, latencyMs: Date.now() - startTime,
      }),
    });
    reservedAmount = 0;
    db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);
    reportResult(db, channel.id, true);
    return res.json(upstreamResult.response.data);
  } catch (error) {
    if (error.upstreamChannel) channel = error.upstreamChannel;
    if (reservedAmount > 0 && !upstreamConfirmed && error.response) {
      try { releaseWalletReservation(db, req.userId, reservedAmount, requestId); reservedAmount = 0; } catch (releaseError) { console.error('[释放图片冻结额度失败]', releaseError); }
    }
    if (channel && !upstreamConfirmed && !error.failoverReported) reportResult(db, channel.id, false);
    const executionUncertain = !upstreamConfirmed && !error.response;
    if (upstreamConfirmed || executionUncertain) {
      const message = executionUncertain
        ? `上游响应不确定，已保留 ${reservedAmount} 点冻结额度等待核对：${error.message}`
        : `图片生成成功但结算失败，已保留 ${reservedAmount} 点冻结额度等待核对：${error.message}`;
      insertImageSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode,
        billingModel: confirmedBillingModel, channelId: channel?.id, imageCount: actualImageCount,
        size: intent.size, quality: intent.quality, pricing: settlementPricing || reservationPricing,
        model: pricingModel, multiplier: imageMultiplier,
        requestIp: req.ip, latencyMs: Date.now() - startTime, error: message,
      });
      return res.status(executionUncertain ? 504 : 500).json({ error: {
        message: '图片请求正在结算；余额已冻结等待管理员核对，请勿重试',
        type: 'settlement_pending',
      } });
    }
    const upstreamMessage = await upstreamErrorMessage(error);
    insertUpstreamFailureLog(db, {
      requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel?.id,
      requestIp: req.ip, latencyMs: Date.now() - startTime, error: upstreamMessage, billingMode: 'image',
    });
    return res.status(error.response?.status || 500).json({ error: { message: `上游图片生成失败: ${upstreamMessage}`, type: 'upstream_error' } });
  }
}

router.post('/images/generations', authenticateApiKey, (req, res) => handleImageBilledRequest(
  req, res, { endpoint: 'images/generations', endpointCapability: 'image_generations' },
));
router.post('/responses', authenticateApiKey, (req, res) => handleImageBilledRequest(
  req, res, { endpoint: 'responses', endpointCapability: 'responses' },
));

router.post('/chat/completions', authenticateApiKey, async (req, res) => {
  const db = getDatabase();
  const requestId = 'req_' + uuidv4().replace(/-/g, '').substring(0, 16);
  const modelCode = req.body.model;
  const startTime = Date.now();
  let reservedAmount = 0;
  let channel = null;
  let isStream = req.body.stream === true;
  let upstreamConfirmed = false;
  const requiresImageInput = requestContainsImage(req.body.messages ?? req.body.input ?? req.body);

  if (!apiKeyCanUseModel(db, req.apiKey, modelCode)) {
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,'unauthorized_model',?,?)")
      .run(requestId, req.userId, req.apiKey.id, modelCode, `模型 ${modelCode} 未授权`, req.ip, Date.now() - startTime);
    return res.status(403).json({ error: { message: `模型 ${modelCode} 未授权`, type: 'unauthorized_model' } });
  }

  const model = db.prepare("SELECT * FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model) return res.status(404).json({ error: { message: `模型 ${modelCode} 不可用`, type: 'model_unavailable' } });
  const pricingRule = getEffectiveMultiplier(db, modelCode, req.userId);
  const multipliers = {
    input: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_input : model.billing_multiplier_input),
    output: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_output : model.billing_multiplier_output),
  };
  try {
    assertSupportedBillableInput(req.body.messages ?? req.body.input ?? req.body, model);
  } catch (error) {
    const message = error.message || '请求内容不受支持';
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,'unsupported_content',?,?)")
      .run(requestId, req.userId, req.apiKey.id, modelCode, message, req.ip, Date.now() - startTime);
    return res.status(400).json({ error: { message, type: 'unsupported_content' } });
  }

  const channelRequirements = { endpointCapability: 'chat_completions', requiresImageInput };
  channel = selectChannel(db, modelCode, req.apiKey.routing_group_id, new Set(), new Set(), channelRequirements);
  if (!channel) {
    const type = requiresImageInput ? 'model_capability_unavailable' : 'no_channel';
    const message = requiresImageInput ? `模型 ${modelCode} 当前没有可用的图片输入渠道` : '暂无可用上游渠道';
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,?,?,?)")
      .run(requestId, req.userId, req.apiKey.id, modelCode, message, type, req.ip, Date.now() - startTime);
    return res.status(requiresImageInput ? 400 : 503).json({ error: { message, type } });
  }
  if (billingModeForRequest(channel, false) === 'token'
      && !channelHasTokenPricing(channel)
      && Number(model.official_input_price) <= 0
      && Number(model.official_output_price) <= 0) {
    return res.status(503).json({ error: { message: '该模型的官方价格尚未同步完成，暂不能计费调用', type: 'official_price_unavailable' } });
  }
  if (billingModeForRequest(channel, false) === 'per_request'
      && resolveFixedUnitPrice(channel, '2K') === null) {
    return res.status(503).json({ error: { message: '该渠道尚未配置每请求价格', type: 'channel_price_unavailable' } });
  }

  let upstreamBody;
  try {
    const available = availableWalletBalance(db, req.userId);
    // 先按保守输入估算并限制最大输出，再只冻结本次请求预算，兼顾扣费安全与并发调用。
    const capped = capChatRequestToReservedBalance(db, model, channel, multipliers, req.body, available);
    upstreamBody = capped.body;
    reservedAmount = reserveWalletBalance(db, req.userId, capped.reservationAmount, requestId).reserved;
  } catch (error) {
    const isInputError = Number(error.status) === 400 && error.type === 'unsupported_content';
    const message = error.message || (isInputError ? '请求内容不受支持' : '额度不足，请购买额度包后重试');
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,?,?,?)")
      .run(requestId, req.userId, req.apiKey.id, modelCode, message, isInputError ? 'unsupported_content' : 'insufficient_balance', req.ip, Date.now() - startTime);
    return res.status(isInputError ? 400 : 402).json({ error: { message, type: isInputError ? 'unsupported_content' : 'insufficient_balance' } });
  }

  upstreamBody.model = channel.upstream_model_name || model.upstream_model_name || modelCode;

  try {
    if (isStream) {
      upstreamBody.stream_options = { ...(upstreamBody.stream_options || {}), include_usage: true };
      const upstreamResult = await postWithSafeFailover({
        db, modelCode, routingGroupId: req.apiKey.routing_group_id, initialChannel: channel,
        endpoint: 'chat/completions', body: upstreamBody,
        requirements: channelRequirements,
        config: selected => ({
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.api_key}` },
          responseType: 'stream', timeout: 300000,
        }),
      });
      const upstreamResp = upstreamResult.response;
      channel = upstreamResult.channel;
      upstreamBody = upstreamResult.requestBody;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let streamedUsage = {};
      let fullContent = '';
      let reasoningContent = '';
      let buffer = '';
      let finalized = false;
      let receivedSseEvent = false;
      let receivedBillableUsage = billingModeForRequest(channel, false) !== 'token';

      const settleStream = () => {
        if (finalized) return;
        finalized = true;
        // 兼容少数上游整条流只有 reasoning_content 的情况。等待流结束确认确实没有普通 content 后，
        // 才补发一次标准 content，避免把推理片段和随后到达的正式回答混在一起。
        if (!fullContent && reasoningContent) {
          fullContent = reasoningContent;
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reasoningContent } }] })}\n\n`);
        }
        // 部分兼容上游不会在流尾回传 usage。只要已有有效内容，就按保守字节上界估算并结算，
        // 不能因为计量字段缺失冻结用户全部余额或把健康渠道错误熔断。
        if (!receivedBillableUsage && fullContent) {
          const fallbackUsage = fallbackChatUsage(upstreamBody, { choices: [{ message: { content: fullContent } }] });
          inputTokens = fallbackUsage.inputTokens;
          outputTokens = fallbackUsage.outputTokens;
          cachedInputTokens = fallbackUsage.cachedInputTokens;
          receivedBillableUsage = true;
        }
        if (!receivedBillableUsage) {
          const usage = fallbackChatUsage(upstreamBody, { choices: [{ message: { content: fullContent } }] });
          const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
          insertSettlementFailureLog(db, {
            requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
            usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
            error: `上游流未返回真实 usage，已保留 ${reservedAmount} 点冻结额度等待核对`,
          });
          res.write(`data: ${JSON.stringify({ error: { message: '上游未返回用量，本次调用正在结算；余额已冻结等待核对，请勿重试', type: 'settlement_pending' } })}\n\n`);
          res.end();
          reportResult(db, channel.id, false);
          return;
        }
        if (outputTokens === 0 && fullContent) outputTokens = Math.max(1, Math.ceil(fullContent.length / 4));
        if (inputTokens === 0) inputTokens = estimatedChatInputTokens(upstreamBody);
        const usage = {
          ...streamedUsage,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          serviceTier: streamedUsage.serviceTier || req.body.service_tier || '',
          upstreamModel: streamedUsage.upstreamModel || channel.upstream_model_name,
        };
        const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
        try {
          settleWalletReservation(db, {
            userId: req.userId,
            reservedAmount,
            chargeAmount: pricing.userCostPoints,
            requestId,
            writeSuccessLog: () => insertSuccessLog(db, {
              requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
              usage, pricing, model: pricing.pricingModel || model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
            }),
          });
          reservedAmount = 0;
          res.write('data: [DONE]\n\n');
          res.end();
          db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);
          reportResult(db, channel.id, true);
        } catch (error) {
          // 这里不能释放冻结额度：上游已经成功返回，保留额度让管理员按流水核对，避免免费调用。
          console.error('[流式结算冻结保护]', error);
          insertSettlementFailureLog(db, {
            requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
            usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime, error: error.message,
          });
          res.write(`data: ${JSON.stringify({ error: { message: '本次调用正在结算，请勿重试；余额已冻结等待核对', type: 'settlement_pending' } })}\n\n`);
          res.end();
          reportResult(db, channel.id, false);
        }
      };

      upstreamResp.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop();
        for (const event of events) {
          // SSE 的 data: 后空格可选，且事件可使用 CRLF；不能因为格式差异丢弃上游内容。
          const data = event.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, ''))
            .join('\n');
          if (!data) continue;
          if (data === '[DONE]') continue; // 仅在事务结算成功后再通知客户端完成。
          try {
            const parsed = JSON.parse(data);
            normalizeVisibleChatContent(parsed, true);
            receivedSseEvent = true;
            if (parsed.usage) {
              const usage = extractUsage(parsed.usage);
              usage.serviceTier = parsed.service_tier || req.body.service_tier || '';
              usage.upstreamModel = parsed.model || channel.upstream_model_name;
              streamedUsage = usage;
              inputTokens = usage.inputTokens;
              outputTokens = usage.outputTokens;
              cachedInputTokens = usage.cachedInputTokens;
              receivedBillableUsage = usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedInputTokens > 0;
            }
            if (parsed.choices?.[0]?.delta?.reasoning_content) reasoningContent += parsed.choices[0].delta.reasoning_content;
            if (parsed.choices?.[0]?.delta?.content) fullContent += parsed.choices[0].delta.content;
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch (error) { /* 忽略上游格式错误的事件 */ }
        }
      });
      upstreamResp.data.on('end', settleStream);
      upstreamResp.data.on('error', (error) => {
        if (finalized) return;
        finalized = true;
        // 已拿到流响应头后，连接中断也不能证明上游未执行；必须保留冻结额度。
        const usage = {
          inputTokens: inputTokens || estimatedChatInputTokens(upstreamBody),
          outputTokens: outputTokens || (fullContent ? Math.max(1, Math.ceil(fullContent.length / 4)) : 0),
          cachedInputTokens,
        };
        const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
        insertSettlementFailureLog(db, {
          requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
          usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
          error: `上游流中断${receivedSseEvent ? '' : '（尚未收到事件）'}，已保留 ${reservedAmount} 点冻结额度等待核对`,
        });
        res.end();
        reportResult(db, channel.id, false);
      });
      return;
    }

    const upstreamResult = await postWithSafeFailover({
      db, modelCode, routingGroupId: req.apiKey.routing_group_id, initialChannel: channel,
      endpoint: 'chat/completions', body: upstreamBody,
      requirements: channelRequirements,
      config: selected => ({
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.api_key}` }, timeout: 120000,
      }),
    });
    const upstreamResponse = upstreamResult.response;
    normalizeVisibleChatContent(upstreamResponse.data, false, true);
    channel = upstreamResult.channel;
    upstreamBody = upstreamResult.requestBody;
    upstreamConfirmed = true;
    if (billingModeForRequest(channel, false) === 'token' && !hasBillableUsage(upstreamResponse.data)) {
      const usage = fallbackChatUsage(upstreamBody, upstreamResponse.data);
      const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
      insertSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model: pricing.pricingModel || model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
        error: `上游未返回真实 usage，已保留 ${reservedAmount} 点冻结额度等待核对`,
      });
      reportResult(db, channel.id, false);
      return res.status(502).json({ error: { message: '上游未返回用量，本次调用正在结算；余额已冻结等待核对，请勿重试', type: 'settlement_pending' } });
    }
    const usage = extractUsage(upstreamResponse.data?.usage || {});
    usage.serviceTier = upstreamResponse.data?.service_tier || req.body.service_tier || '';
    usage.upstreamModel = upstreamResponse.data?.model || channel.upstream_model_name;
    const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
    settleWalletReservation(db, {
      userId: req.userId,
      reservedAmount,
      chargeAmount: pricing.userCostPoints,
      requestId,
      writeSuccessLog: () => insertSuccessLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model: pricing.pricingModel || model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
      }),
    });
    reservedAmount = 0;
    db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);
    reportResult(db, channel.id, true);
    return res.json(upstreamResponse.data);
  } catch (error) {
    if (error.upstreamChannel) channel = error.upstreamChannel;
    // 只有明确收到上游 HTTP 错误响应，才可确认本次没有成功结果并释放额度。
    // 网络超时/断连时上游可能已执行，必须保留冻结额度，不能免费放行。
    const executionUncertain = !upstreamConfirmed && !error.response;
    if (reservedAmount > 0 && !upstreamConfirmed && !executionUncertain) {
      try { releaseWalletReservation(db, req.userId, reservedAmount, requestId); reservedAmount = 0; } catch (releaseError) { console.error('[释放冻结额度失败]', releaseError); }
    }
    const upstreamValidationError = Number(error.response?.status) >= 400
      && Number(error.response?.status) < 500
      && !SAFE_FAILOVER_STATUSES.has(Number(error.response?.status));
    // 请求格式/内容被上游拒绝并不代表渠道不可用，不能因此熔断后续文字请求。
    if (channel?.id && !error.failoverReported && !upstreamValidationError) reportResult(db, channel.id, false);
    if (upstreamConfirmed || executionUncertain) {
      insertSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel?.id,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        pricing: buildRequestPricing(db, model, channel, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, multipliers, req.body.service_tier || ''),
        model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
        error: executionUncertain ? `上游响应不确定，已保留 ${reservedAmount} 点冻结额度等待核对：${error.message}` : error.message,
      });
      return res.status(executionUncertain ? 504 : 500).json({ error: { message: '本次调用正在结算；余额已冻结等待管理员核对，请勿重试', type: 'settlement_pending' } });
    }
    insertUpstreamFailureLog(db, {
      requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel?.id,
      requestIp: req.ip, latencyMs: Date.now() - startTime, error: error.response?.data?.error?.message || error.message,
    });
    // 上游尚未建立 SSE 响应时，无论客户端是否请求 stream 都必须返回明确 HTTP 错误，不能空连接结束。
    const message = await upstreamErrorMessage(error);
    return res.status(error.response?.status || 500).json({ error: { message: `上游请求失败: ${message}`, type: 'upstream_error' } });
  }
});

router.post('/embeddings', authenticateApiKey, async (req, res) => {
  const db = getDatabase();
  const requestId = 'req_' + uuidv4().replace(/-/g, '').substring(0, 16);
  const modelCode = req.body.model;
  const startTime = Date.now();
  let reservedAmount = 0;
  let upstreamConfirmed = false;

  if (!apiKeyCanUseModel(db, req.apiKey, modelCode)) return res.status(403).json({ error: { message: `模型 ${modelCode} 未授权`, type: 'unauthorized_model' } });
  const model = db.prepare("SELECT * FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model) return res.status(404).json({ error: { message: `模型 ${modelCode} 不可用`, type: 'model_unavailable' } });
  const pricingRule = getEffectiveMultiplier(db, modelCode, req.userId);
  const multipliers = {
    input: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_input : model.billing_multiplier_input),
    output: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_output : model.billing_multiplier_output),
  };
  const channelRequirements = { endpointCapability: 'embeddings' };
  let channel = selectChannel(db, modelCode, req.apiKey.routing_group_id, new Set(), new Set(), channelRequirements);
  if (!channel) return res.status(503).json({ error: { message: '暂无支持向量接口的可用上游渠道', type: 'no_channel' } });
  if (billingModeForRequest(channel, false) === 'token'
      && !channelHasTokenPricing(channel)
      && Number(model.official_input_price) <= 0) {
    return res.status(503).json({ error: { message: '该模型的官方价格尚未同步完成，暂不能计费调用', type: 'official_price_unavailable' } });
  }
  if (billingModeForRequest(channel, false) === 'per_request'
      && resolveFixedUnitPrice(channel, '2K') === null) {
    return res.status(503).json({ error: { message: '该渠道尚未配置每请求价格', type: 'channel_price_unavailable' } });
  }
  try {
    const available = availableWalletBalance(db, req.userId);
    assertEmbeddingTextInput(req.body.input);
    const conservativeTokens = estimatedInputTokens(JSON.stringify(req.body.input ?? req.body));
    const estimate = buildRequestPricing(db, model, channel, { inputTokens: conservativeTokens, cachedInputTokens: 0, outputTokens: 0 }, multipliers, req.body.service_tier || '').userCostPoints;
    if (estimate + 1e-9 > available) throw new Error('额度不足以覆盖本次向量请求');
    reservedAmount = reserveWalletBalance(db, req.userId, estimate, requestId).reserved;
  } catch (error) {
    return res.status(402).json({ error: { message: error.message || '额度不足，请购买额度包后重试', type: 'insufficient_balance' } });
  }

  try {
    const upstreamResult = await postWithSafeFailover({
      db, modelCode, routingGroupId: req.apiKey.routing_group_id, initialChannel: channel,
      endpoint: 'embeddings', body: { ...req.body, model: channel.upstream_model_name || model.upstream_model_name || modelCode },
      requirements: channelRequirements,
      config: selected => ({
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.api_key}` }, timeout: 60000,
      }),
    });
    const upstreamResponse = upstreamResult.response;
    channel = upstreamResult.channel;
    upstreamConfirmed = true;
    if (billingModeForRequest(channel, false) === 'token' && !hasBillableUsage(upstreamResponse.data)) {
      const usage = fallbackEmbeddingUsage(req.body);
      const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
      insertSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model: pricing.pricingModel || model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
        error: `上游未返回真实 usage，已保留 ${reservedAmount} 点冻结额度等待核对`,
      });
      reportResult(db, channel.id, false);
      return res.status(502).json({ error: { message: '上游未返回用量，本次调用正在结算；余额已冻结等待核对，请勿重试', type: 'settlement_pending' } });
    }
    const usage = extractUsage(upstreamResponse.data?.usage || {});
    usage.serviceTier = upstreamResponse.data?.service_tier || req.body.service_tier || '';
    usage.upstreamModel = upstreamResponse.data?.model || channel.upstream_model_name;
    const pricing = buildRequestPricing(db, model, channel, usage, multipliers, usage.serviceTier || req.body.service_tier || '');
    settleWalletReservation(db, {
      userId: req.userId, reservedAmount, chargeAmount: pricing.userCostPoints, requestId,
      writeSuccessLog: () => insertSuccessLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model: pricing.pricingModel || model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
      }),
    });
    reservedAmount = 0;
    db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);
    reportResult(db, channel.id, true);
    return res.json(upstreamResponse.data);
  } catch (error) {
    if (error.upstreamChannel) channel = error.upstreamChannel;
    const executionUncertain = !upstreamConfirmed && !error.response;
    if (reservedAmount > 0 && !upstreamConfirmed && !executionUncertain) {
      try { releaseWalletReservation(db, req.userId, reservedAmount, requestId); reservedAmount = 0; } catch (releaseError) { console.error('[释放冻结额度失败]', releaseError); }
    }
    if (!error.failoverReported) reportResult(db, channel.id, false);
    if (upstreamConfirmed || executionUncertain) {
      insertSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        pricing: buildRequestPricing(db, model, channel, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, multipliers, req.body.service_tier || ''),
        model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
        error: executionUncertain ? `上游响应不确定，已保留 ${reservedAmount} 点冻结额度等待核对：${error.message}` : error.message,
      });
      return res.status(executionUncertain ? 504 : 500).json({ error: { message: '本次调用正在结算；余额已冻结等待管理员核对，请勿重试', type: 'settlement_pending' } });
    }
    insertUpstreamFailureLog(db, {
      requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
      requestIp: req.ip, latencyMs: Date.now() - startTime, error: error.response?.data?.error?.message || error.message,
    });
    return res.status(error.response?.status || 500).json({ error: { message: `上游请求失败: ${error.response?.data?.error?.message || error.message}`, type: 'upstream_error' } });
  }
});

module.exports = router;
