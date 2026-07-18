const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticateApiKey } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { selectChannel, reportResult } = require('../utils/channel-selector');
const { apiKeyCanUseModel, listModelsForApiKey } = require('../utils/routing-group-models');
const { calculatePricing, extractUsage } = require('../utils/pricing-engine');
const { resolveChatOutputLimit } = require('../utils/request-limits');
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

function buildPricing(db, model, usage, multipliers) {
  const usdCnyRate = getUsdCnyRate(db);
  const prices = calculatePricing({
    ...usage,
    official: {
      currency: model.official_currency,
      input: model.official_input_price,
      output: model.official_output_price,
      cachedInput: model.official_cached_input_price,
      unitTokens: model.official_unit_tokens,
    },
    multipliers,
    usdCnyRate,
  });
  return { ...prices, usdCnyRate };
}

function insertSuccessLog(db, { requestId, userId, apiKeyId, modelCode, channelId, usage, pricing, model, multipliers, requestIp, latencyMs }) {
  db.prepare(`INSERT INTO api_request_logs (
    request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,cached_input_tokens,output_tokens,total_cost,
    official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,
    usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny,status,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'success',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, channelId, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, pricing.userCostPoints,
    model.official_provider, model.official_currency, model.official_input_price, model.official_output_price, model.official_cached_input_price, model.official_unit_tokens,
    pricing.usdCnyRate, multipliers.input, multipliers.output, pricing.officialCostCny, requestIp, latencyMs,
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

function insertUpstreamFailureLog(db, { requestId, userId, apiKeyId, modelCode, channelId, requestIp, latencyMs, error }) {
  db.prepare("INSERT OR IGNORE INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,?,'failed',?,'upstream_error',?,?)")
    .run(requestId, userId, apiKeyId, modelCode, channelId || null, error, requestIp, latencyMs);
}

function listModels(req, res) {
  const db = getDatabase();
  const models = listModelsForApiKey(db, req.apiKey);
  res.json({ object: 'list', data: models.map(m => ({
    id: m.model_code,
    object: 'model',
    created: 0,
    owned_by: 'ai-proxy',
    capabilities: m.capabilities || { chat_completions: true, image_input: false },
  })) });
}

function estimatedInputTokens(value) {
  // 对纯文本使用 UTF-8 字节数上界，再留出结构余量；BPE tokenizer 的 Token 数不会高于字节数。
  return Math.max(1, Buffer.byteLength(String(value ?? ''), 'utf8') + 256);
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
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedInputTokens > 0;
}

function normalizeVisibleChatContent(payload, streaming = false) {
  if (!payload || !Array.isArray(payload.choices)) return payload;
  for (const choice of payload.choices) {
    const target = streaming ? choice?.delta : choice?.message;
    if (!target || (typeof target.content === 'string' && target.content.length > 0)) continue;
    const fallback = target.output_text ?? target.text ?? target.reasoning_content ?? choice?.text;
    if (typeof fallback === 'string' && fallback.length > 0) target.content = fallback;
  }
  return payload;
}

function fallbackChatUsage(requestBody, responseBody = {}) {
  const content = responseBody?.choices?.map(choice => choice?.message?.content || '').join('') || '';
  return {
    inputTokens: estimatedInputTokens(JSON.stringify(requestBody.messages ?? requestBody.input ?? requestBody)),
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

function capChatRequestToReservedBalance(db, model, multipliers, requestBody, availableBalance) {
  const inputTokens = estimatedInputTokens(JSON.stringify(requestBody.messages ?? requestBody.input ?? requestBody));
  const inputCost = buildPricing(db, model, { inputTokens, cachedInputTokens: 0, outputTokens: 0 }, multipliers).userCostPoints;
  const outputOneToken = buildPricing(db, model, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 1 }, multipliers).userCostPoints;
  if (inputCost + 1e-9 >= availableBalance || outputOneToken <= 0) throw new Error('额度不足以覆盖本次请求的输入与最小输出');

  const maxAffordableOutput = Math.floor((availableBalance - inputCost) / outputOneToken);
  if (maxAffordableOutput < 1) throw new Error('额度不足以覆盖本次请求的最小输出');

  const body = { ...requestBody };
  const { limitField, maxTokens } = resolveChatOutputLimit({
    model, requestBody: body, estimatedInputTokens: inputTokens, maxAffordableOutput,
  });
  body[limitField] = maxTokens;
  const reservationAmount = buildPricing(db, model, {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens: maxTokens,
  }, multipliers).userCostPoints;
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

async function postWithSafeFailover({ db, modelCode, routingGroupId, initialChannel, endpoint, body, config, requirements = {} }) {
  let channel = initialChannel;
  const excludedChannelIds = new Set();
  while (channel) {
    const requestBody = { ...body, model: channel.upstream_model_name || body.model || modelCode };
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
  if (Number(model.official_input_price) <= 0 && Number(model.official_output_price) <= 0) {
    return res.status(503).json({ error: { message: '该模型的官方价格尚未同步完成，暂不能计费调用', type: 'official_price_unavailable' } });
  }

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

  let upstreamBody;
  try {
    const available = availableWalletBalance(db, req.userId);
    // 先按保守输入估算并限制最大输出，再只冻结本次请求预算，兼顾扣费安全与并发调用。
    const capped = capChatRequestToReservedBalance(db, model, multipliers, req.body, available);
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
      let fullContent = '';
      let buffer = '';
      let finalized = false;
      let receivedSseEvent = false;
      let receivedBillableUsage = false;

      const settleStream = () => {
        if (finalized) return;
        finalized = true;
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
          const pricing = buildPricing(db, model, usage, multipliers);
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
        if (inputTokens === 0) inputTokens = estimatedInputTokens(JSON.stringify(upstreamBody.messages ?? upstreamBody.input ?? upstreamBody));
        const usage = { inputTokens, outputTokens, cachedInputTokens };
        const pricing = buildPricing(db, model, usage, multipliers);
        try {
          settleWalletReservation(db, {
            userId: req.userId,
            reservedAmount,
            chargeAmount: pricing.userCostPoints,
            requestId,
            writeSuccessLog: () => insertSuccessLog(db, {
              requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
              usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
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
              inputTokens = usage.inputTokens;
              outputTokens = usage.outputTokens;
              cachedInputTokens = usage.cachedInputTokens;
              receivedBillableUsage = usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedInputTokens > 0;
            }
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
          inputTokens: inputTokens || estimatedInputTokens(JSON.stringify(upstreamBody.messages ?? upstreamBody.input ?? upstreamBody)),
          outputTokens: outputTokens || (fullContent ? Math.max(1, Math.ceil(fullContent.length / 4)) : 0),
          cachedInputTokens,
        };
        const pricing = buildPricing(db, model, usage, multipliers);
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
    normalizeVisibleChatContent(upstreamResponse.data, false);
    channel = upstreamResult.channel;
    upstreamBody = upstreamResult.requestBody;
    upstreamConfirmed = true;
    if (!hasBillableUsage(upstreamResponse.data)) {
      const usage = fallbackChatUsage(upstreamBody, upstreamResponse.data);
      const pricing = buildPricing(db, model, usage, multipliers);
      insertSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
        error: `上游未返回真实 usage，已保留 ${reservedAmount} 点冻结额度等待核对`,
      });
      reportResult(db, channel.id, false);
      return res.status(502).json({ error: { message: '上游未返回用量，本次调用正在结算；余额已冻结等待核对，请勿重试', type: 'settlement_pending' } });
    }
    const usage = extractUsage(upstreamResponse.data?.usage || {});
    const pricing = buildPricing(db, model, usage, multipliers);
    settleWalletReservation(db, {
      userId: req.userId,
      reservedAmount,
      chargeAmount: pricing.userCostPoints,
      requestId,
      writeSuccessLog: () => insertSuccessLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
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
        pricing: buildPricing(db, model, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, multipliers),
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
  if (Number(model.official_input_price) <= 0) return res.status(503).json({ error: { message: '该模型的官方价格尚未同步完成，暂不能计费调用', type: 'official_price_unavailable' } });

  const pricingRule = getEffectiveMultiplier(db, modelCode, req.userId);
  const multipliers = {
    input: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_input : model.billing_multiplier_input),
    output: positiveOrOne(pricingRule ? pricingRule.billing_multiplier_output : model.billing_multiplier_output),
  };
  const channelRequirements = { endpointCapability: 'embeddings' };
  let channel = selectChannel(db, modelCode, req.apiKey.routing_group_id, new Set(), new Set(), channelRequirements);
  if (!channel) return res.status(503).json({ error: { message: '暂无支持向量接口的可用上游渠道', type: 'no_channel' } });
  try {
    const available = availableWalletBalance(db, req.userId);
    assertEmbeddingTextInput(req.body.input);
    const conservativeTokens = estimatedInputTokens(JSON.stringify(req.body.input ?? req.body));
    const estimate = buildPricing(db, model, { inputTokens: conservativeTokens, cachedInputTokens: 0, outputTokens: 0 }, multipliers).userCostPoints;
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
    if (!hasBillableUsage(upstreamResponse.data)) {
      const usage = fallbackEmbeddingUsage(req.body);
      const pricing = buildPricing(db, model, usage, multipliers);
      insertSettlementFailureLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
        error: `上游未返回真实 usage，已保留 ${reservedAmount} 点冻结额度等待核对`,
      });
      reportResult(db, channel.id, false);
      return res.status(502).json({ error: { message: '上游未返回用量，本次调用正在结算；余额已冻结等待核对，请勿重试', type: 'settlement_pending' } });
    }
    const usage = extractUsage(upstreamResponse.data?.usage || {});
    const pricing = buildPricing(db, model, usage, multipliers);
    settleWalletReservation(db, {
      userId: req.userId, reservedAmount, chargeAmount: pricing.userCostPoints, requestId,
      writeSuccessLog: () => insertSuccessLog(db, {
        requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id,
        usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now() - startTime,
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
        pricing: buildPricing(db, model, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, multipliers),
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
