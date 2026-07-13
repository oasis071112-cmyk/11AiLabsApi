const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticateApiKey } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { selectChannel, reportResult } = require('../utils/channel-selector');
const { calculatePricing, extractUsage } = require('../utils/pricing-engine');

function getEffectiveMultiplier(db, modelCode, userId, apiKeyId) {
  const now = new Date().toISOString();
  const rules = db.prepare("SELECT * FROM pricing_rules WHERE (model_code=? OR model_code IS NULL) AND status='active' AND (start_time IS NULL OR start_time<=?) AND (end_time IS NULL OR end_time>=?) ORDER BY CASE scope_type WHEN 'api_key' THEN 4 WHEN 'user' THEN 3 WHEN 'user_group' THEN 2 WHEN 'platform' THEN 1 END DESC, priority DESC").all(modelCode, now, now);
  for (const r of rules) {
    if (r.scope_type==='api_key' && r.scope_id===apiKeyId) return r;
    if (r.scope_type==='user' && r.scope_id===userId) return r;
    if (r.scope_type==='platform') return r;
  }
  return null;
}

function deductBalance(db, userId, amount) {
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
  if (!wallet) throw new Error('钱包不存在');
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const gq = wallet.gift_quota || wallet.gift_balance || 0;
  const available = qb + gq - (wallet.frozen_balance || 0);
  if (available < amount) throw new Error('额度不足');
  let remaining = amount;
  if (gq > 0) {
    const dg = Math.min(gq, remaining);
    db.prepare('UPDATE wallets SET gift_quota=COALESCE(gift_quota,gift_balance,0)-?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(dg, userId);
    db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,remark) VALUES (?,'consume','gift_quota',?,?,?,'API调用扣费')").run(userId, -dg, gq, gq-dg);
    remaining -= dg;
  }
  if (remaining > 0) {
    db.prepare('UPDATE wallets SET quota_balance=COALESCE(quota_balance,recharge_balance,0)-?, total_spent=total_spent+?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(remaining, remaining, userId);
    db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,remark) VALUES (?,'consume','quota',?,?,?,'API调用扣费')").run(userId, -remaining, qb, qb-remaining);
  }
}

function getUsdCnyRate(db) {
  const value = Number(db.prepare("SELECT config_value FROM system_config WHERE config_key='usd_cny_exchange_rate'").get()?.config_value);
  return Number.isFinite(value) && value > 0 ? value : 7;
}

function getChannelCost(db, channelId, modelCode) {
  return db.prepare('SELECT * FROM channel_model_costs WHERE channel_id=? AND model_code=?').get(channelId, modelCode) || {
    currency: 'CNY', input_price: 0, output_price: 0, cached_input_price: 0, unit_tokens: 1000000,
  };
}

function buildPricing(db, model, channelId, modelCode, usage, multipliers) {
  const usdCnyRate = getUsdCnyRate(db);
  const channelCost = getChannelCost(db, channelId, modelCode);
  const prices = calculatePricing({
    ...usage,
    official: {
      currency: model.official_currency,
      input: model.official_input_price,
      output: model.official_output_price,
      cachedInput: model.official_cached_input_price,
      unitTokens: model.official_unit_tokens,
    },
    channel: {
      currency: channelCost.currency,
      input: channelCost.input_price,
      output: channelCost.output_price,
      cachedInput: channelCost.cached_input_price,
      unitTokens: channelCost.unit_tokens,
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
    usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny,channel_cost_cny,profit_cny,status,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'success',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, channelId, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, pricing.userCostPoints,
    model.official_provider, model.official_currency, model.official_input_price, model.official_output_price, model.official_cached_input_price, model.official_unit_tokens,
    pricing.usdCnyRate, multipliers.input, multipliers.output, pricing.officialCostCny, pricing.channelCostCny, pricing.profitCny, requestIp, latencyMs,
  );
}

function insertSettlementFailureLog(db, { requestId, userId, apiKeyId, modelCode, channelId, usage, pricing, model, multipliers, requestIp, latencyMs, error }) {
  db.prepare(`INSERT INTO api_request_logs (
    request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,cached_input_tokens,output_tokens,total_cost,
    official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,
    usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny,channel_cost_cny,profit_cny,status,error_message,error_type,request_ip,latency_ms
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'failed',?,'settlement_failed',?,?)`).run(
    requestId, userId, apiKeyId, modelCode, channelId, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, pricing.userCostPoints,
    model.official_provider, model.official_currency, model.official_input_price, model.official_output_price, model.official_cached_input_price, model.official_unit_tokens,
    pricing.usdCnyRate, multipliers.input, multipliers.output, pricing.officialCostCny, pricing.channelCostCny, pricing.profitCny, error, requestIp, latencyMs,
  );
}

function listModels(req, res) {
  const db = getDatabase();
  const models = db.prepare("SELECT DISTINCT m.model_code,m.model_name FROM models m JOIN api_key_permissions akp ON m.model_code=akp.model_code AND akp.status='active' WHERE m.status='active' AND akp.api_key_id=?").all(req.apiKey.id);
  res.json({ object: 'list', data: models.map(m=>({ id: m.model_code, object: 'model', created: 0, owned_by: 'ai-proxy' })) });
}

// 兼容部分客户端直接 GET Base URL 来刷新模型列表。
router.get('/', authenticateApiKey, listModels);
router.get('/models', authenticateApiKey, listModels);

router.post('/chat/completions', authenticateApiKey, async (req, res) => {
  const db = getDatabase();
  const requestId = 'req_'+uuidv4().replace(/-/g,'').substring(0,16);
  const modelCode = req.body.model;
  const startTime = Date.now();

  const permission = db.prepare("SELECT * FROM api_key_permissions WHERE api_key_id=? AND model_code=? AND status='active'").get(req.apiKey.id, modelCode);
  if (!permission) {
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,'unauthorized_model',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, `模型 ${modelCode} 未授权`, req.ip, Date.now()-startTime);
    return res.status(403).json({ error: { message: `模型 ${modelCode} 未授权`, type: 'unauthorized_model' } });
  }

  const model = db.prepare("SELECT * FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model) return res.status(404).json({ error: { message: `模型 ${modelCode} 不可用`, type: 'model_unavailable' } });
  const pricingRule = getEffectiveMultiplier(db, modelCode, req.userId, req.apiKey.id);
  const bmi = Number(pricingRule ? pricingRule.billing_multiplier_input : model.billing_multiplier_input) || 1;
  const bmo = Number(pricingRule ? pricingRule.billing_multiplier_output : model.billing_multiplier_output) || 1;

  if (Number(model.official_input_price) <= 0 && Number(model.official_output_price) <= 0) {
    return res.status(503).json({ error: { message: '该模型的官方价格尚未同步完成，暂不能计费调用', type: 'official_price_unavailable' } });
  }

  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.userId);
  if (!wallet) {
    return res.status(402).json({
      error: { message: '账户钱包尚未初始化，请联系管理员', type: 'wallet_not_initialized' }
    });
  }
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const gq = wallet.gift_quota || wallet.gift_balance || 0;
  const availableBalance = qb + gq - (wallet.frozen_balance || 0);
  // 用 1K 输入 Token 的官方人民币参考成本做预检；最终按上游返回的真实用量结算。
  const minimumEstimate = buildPricing(db, model, 0, modelCode, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 0 }, { input: bmi, output: bmo }).userCostPoints;
  if (availableBalance < Math.max(minimumEstimate, 0.000001)) {
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,'insufficient_balance',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, '额度不足，请购买额度包', req.ip, Date.now()-startTime);
    return res.status(402).json({ error: { message: '额度不足，请购买额度包后重试', type: 'insufficient_balance', current_balance: availableBalance } });
  }

  const channel = selectChannel(db, modelCode);
  if (!channel) return res.status(503).json({ error: { message: '暂无可用上游渠道', type: 'no_channel' } });

  const upstreamBody = { ...req.body, model: model.upstream_model_name || modelCode };
  const isStream = req.body.stream === true;

  try {
    if (isStream) {
      // ========== 流式响应 ==========
      const upstreamResp = await axios.post(`${channel.base_url}/chat/completions`, upstreamBody, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${channel.api_key}` },
        responseType: 'stream',
        timeout: 300000,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let inputTokens = 0, outputTokens = 0, cachedInputTokens = 0;
      let fullContent = '';
      let buffer = '';

      upstreamResp.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) {
              const usage = extractUsage(parsed.usage);
              inputTokens = usage.inputTokens;
              outputTokens = usage.outputTokens;
              cachedInputTokens = usage.cachedInputTokens;
            }
            if (parsed.choices?.[0]?.delta?.content) fullContent += parsed.choices[0].delta.content;
            res.write(`data: ${data}\n\n`);
          } catch(e) { /* skip malformed chunk — JSON parse failed */ }
        }
      });

      upstreamResp.data.on('end', () => {
        res.end();
        // 兜底：如果上游没返回 usage，用内容长度估算 token
        if (outputTokens === 0 && fullContent) {
          outputTokens = Math.max(1, Math.ceil(fullContent.length / 4));
        }
        if (inputTokens === 0) {
          try { inputTokens = Math.max(1, Math.ceil(JSON.stringify(upstreamBody.messages).length / 4)); } catch(e) {}
        }
        const usage = { inputTokens, outputTokens, cachedInputTokens };
        const pricing = buildPricing(db, model, channel.id, modelCode, usage, { input: bmi, output: bmo });
        try {
          deductBalance(db, req.userId, pricing.userCostPoints);
          insertSuccessLog(db, { requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id, usage, pricing, model, multipliers: { input: bmi, output: bmo }, requestIp: req.ip, latencyMs: Date.now()-startTime });
        } catch (error) {
          console.error('[流式结算失败]', error);
          insertSettlementFailureLog(db, { requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id, usage, pricing, model, multipliers: { input: bmi, output: bmo }, requestIp: req.ip, latencyMs: Date.now()-startTime, error: error.message });
        }
        db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);
        reportResult(db, channel.id, true);
      });

      upstreamResp.data.on('error', (err) => {
        res.end();
        reportResult(db, channel.id, false);
      });

    } else {
      // ========== 非流式响应 ==========
      const upstreamResponse = await axios.post(`${channel.base_url}/chat/completions`, upstreamBody, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${channel.api_key}` },
        timeout: 120000
      });

      const usage = extractUsage(upstreamResponse.data?.usage || {});
      const pricing = buildPricing(db, model, channel.id, modelCode, usage, { input: bmi, output: bmo });

      try {
        deductBalance(db, req.userId, pricing.userCostPoints);
      } catch (error) {
        console.error('[结算失败]', error);
        insertSettlementFailureLog(db, { requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id, usage, pricing, model, multipliers: { input: bmi, output: bmo }, requestIp: req.ip, latencyMs: Date.now()-startTime, error: error.message });
        reportResult(db, channel.id, true);
        return res.status(402).json({ error: { message: '响应已生成，但账户余额不足以完成结算；本次调用已记录，请充值后联系管理员处理', type: 'settlement_failed' } });
      }

      insertSuccessLog(db, { requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id, usage, pricing, model, multipliers: { input: bmi, output: bmo }, requestIp: req.ip, latencyMs: Date.now()-startTime });
      db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);
      reportResult(db, channel.id, true);

      res.json(upstreamResponse.data);
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    reportResult(db, channel.id, false);
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,?,'failed',?,'upstream_error',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, channel?.id||null, err.response?.data?.error?.message||err.message, req.ip, latencyMs);
    if (!isStream) {
      res.status(err.response?.status||500).json({ error: { message: `上游请求失败: ${err.response?.data?.error?.message||err.message}`, type: 'upstream_error' } });
    }
  }
});

router.post('/embeddings', authenticateApiKey, async (req, res) => {
  const db = getDatabase();
  const requestId = 'req_'+uuidv4().replace(/-/g,'').substring(0,16);
  const modelCode = req.body.model;
  const startTime = Date.now();

  const permission = db.prepare("SELECT * FROM api_key_permissions WHERE api_key_id=? AND model_code=? AND status='active'").get(req.apiKey.id, modelCode);
  if (!permission) return res.status(403).json({ error: { message: `模型 ${modelCode} 未授权`, type: 'unauthorized_model' } });

  const model = db.prepare("SELECT * FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model) return res.status(404).json({ error: { message: `模型 ${modelCode} 不可用`, type: 'model_unavailable' } });
  if (Number(model.official_input_price) <= 0) return res.status(503).json({ error: { message: '该模型的官方价格尚未同步完成，暂不能计费调用', type: 'official_price_unavailable' } });

  const channel = selectChannel(db, modelCode);
  if (!channel) return res.status(503).json({ error: { message: '暂无可用上游渠道', type: 'no_channel' } });

  try {
    const upstreamResponse = await axios.post(`${channel.base_url}/embeddings`, { ...req.body, model: model.upstream_model_name||modelCode }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${channel.api_key}` }, timeout: 60000 });
    const usage = extractUsage(upstreamResponse.data?.usage || {});
    const multipliers = { input: Number(model.billing_multiplier_input) || 1, output: Number(model.billing_multiplier_output) || 1 };
    const pricing = buildPricing(db, model, channel.id, modelCode, usage, multipliers);
    try {
      deductBalance(db, req.userId, pricing.userCostPoints);
    } catch (error) {
      insertSettlementFailureLog(db, { requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id, usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now()-startTime, error: error.message });
      return res.status(402).json({ error: { message: '响应已生成，但账户余额不足以完成结算；本次调用已记录，请充值后联系管理员处理', type: 'settlement_failed' } });
    }
    insertSuccessLog(db, { requestId, userId: req.userId, apiKeyId: req.apiKey.id, modelCode, channelId: channel.id, usage, pricing, model, multipliers, requestIp: req.ip, latencyMs: Date.now()-startTime });
    res.json(upstreamResponse.data);
  } catch (err) {
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,?,'failed',?,'upstream_error',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, channel.id, err.message, req.ip, Date.now()-startTime);
    res.status(err.response?.status||500).json({ error: { message: `上游请求失败: ${err.message}`, type: 'upstream_error' } });
  }
});

module.exports = router;
