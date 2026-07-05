const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticateApiKey } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

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

router.get('/models', authenticateApiKey, (req, res) => {
  const db = getDatabase();
  const models = db.prepare("SELECT DISTINCT m.model_code,m.model_name FROM models m JOIN api_key_permissions akp ON m.model_code=akp.model_code AND akp.status='active' WHERE m.status='active' AND akp.api_key_id=?").all(req.apiKey.id);
  res.json({ object: 'list', data: models.map(m=>({ id: m.model_code, object: 'model', created: 0, owned_by: 'ai-proxy' })) });
});

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
  const bmi = pricingRule ? pricingRule.billing_multiplier_input : model.billing_multiplier_input;
  const bmo = pricingRule ? pricingRule.billing_multiplier_output : model.billing_multiplier_output;

  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.userId);
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const gq = wallet.gift_quota || wallet.gift_balance || 0;
  const availableBalance = qb + gq - (wallet.frozen_balance || 0);
  if (availableBalance < model.base_input_price * bmi * 10) {
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,'blocked',?,'insufficient_balance',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, '额度不足，请购买额度包', req.ip, Date.now()-startTime);
    return res.status(402).json({ error: { message: '额度不足，请购买额度包后重试', type: 'insufficient_balance', current_balance: availableBalance } });
  }

  const channels = db.prepare("SELECT * FROM upstream_channels WHERE status='active' ORDER BY priority ASC, weight DESC").all();
  if (channels.length === 0) return res.status(503).json({ error: { message: '暂无可用上游渠道', type: 'no_channel' } });
  const channel = channels[0];

  try {
    const upstreamBody = { ...req.body, model: model.upstream_model_name || modelCode };
    const upstreamResponse = await axios.post(`${channel.base_url}/chat/completions`, upstreamBody, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${channel.api_key}` },
      timeout: 120000
    });

    const usage = upstreamResponse.data?.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const inputCost = (inputTokens/1000) * model.base_input_price * bmi;
    const outputCost = (outputTokens/1000) * model.base_output_price * bmo;
    const totalCost = inputCost + outputCost;

    try { deductBalance(db, req.userId, totalCost); } catch(e) { console.error('[扣费失败]', e); }

    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,output_tokens,total_cost,status,request_ip,latency_ms) VALUES (?,?,?,?,?,?,?,?,'success',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, channel.id, inputTokens, outputTokens, totalCost, req.ip, Date.now()-startTime);
    db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(req.apiKey.id);

    res.json(upstreamResponse.data);
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,?,'failed',?,'upstream_error',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, channel?.id||null, err.response?.data?.error?.message||err.message, req.ip, latencyMs);
    res.status(err.response?.status||500).json({ error: { message: `上游请求失败: ${err.response?.data?.error?.message||err.message}`, type: 'upstream_error' } });
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

  const channels = db.prepare("SELECT * FROM upstream_channels WHERE status='active' ORDER BY priority ASC LIMIT 1").all();
  if (channels.length===0) return res.status(503).json({ error: { message: '暂无可用上游渠道', type: 'no_channel' } });
  const channel = channels[0];

  try {
    const upstreamResponse = await axios.post(`${channel.base_url}/embeddings`, { ...req.body, model: model.upstream_model_name||modelCode }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${channel.api_key}` }, timeout: 60000 });
    const inputTokens = upstreamResponse.data?.usage?.prompt_tokens || 0;
    const totalCost = (inputTokens/1000) * model.base_input_price * model.billing_multiplier_input;
    try { deductBalance(db, req.userId, totalCost); } catch(e) {}
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,output_tokens,total_cost,status,request_ip,latency_ms) VALUES (?,?,?,?,?,?,0,?,'success',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, channel.id, inputTokens, totalCost, req.ip, Date.now()-startTime);
    res.json(upstreamResponse.data);
  } catch (err) {
    db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,status,error_message,error_type,request_ip,latency_ms) VALUES (?,?,?,?,?,'failed',?,'upstream_error',?,?)").run(requestId, req.userId, req.apiKey.id, modelCode, channel.id, err.message, req.ip, Date.now()-startTime);
    res.status(err.response?.status||500).json({ error: { message: `上游请求失败: ${err.message}`, type: 'upstream_error' } });
  }
});

module.exports = router;
