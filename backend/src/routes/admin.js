const express = require('express');
const axios = require('axios');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { desensitize } = require('../utils/crypto');
const { normalizeUpstreamModels, inferModelType } = require('../utils/model-sync');
const { syncOfficialPricing, syncUsdCnyRate, inferProvider } = require('../utils/pricing-sync');
const { listModelsForApiKey, listRoutingGroupModels } = require('../utils/routing-group-models');
const { parseChannelCapabilities, serializeChannelCapabilities } = require('../utils/channel-capabilities');

const SUPPORTED_PROVIDERS = ['openai', 'deepseek', 'anthropic'];
function supportedProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(provider) ? provider : null;
}

function positiveMultiplier(value) {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function nonNegativePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function pricingPayload(body) {
  const mode = body.official_pricing_mode === 'manual' ? 'manual' : 'auto';
  const provider = supportedProvider(body.official_provider);
  if (!provider) return { error: '官方价格提供方仅支持 OpenAI、DeepSeek、Anthropic' };
  const currency = String(body.official_currency || (provider === 'deepseek' ? 'CNY' : 'USD')).toUpperCase();
  if (!['CNY', 'USD'].includes(currency)) return { error: '价格币种仅支持 CNY 或 USD' };
  const input = nonNegativePrice(body.official_input_price ?? 0);
  const cached = nonNegativePrice(body.official_cached_input_price ?? body.official_input_price ?? 0);
  const output = nonNegativePrice(body.official_output_price ?? 0);
  if (input === null || cached === null || output === null) return { error: '官方价格必须是大于等于 0 的数字' };
  if (mode === 'manual' && input <= 0 && output <= 0) return { error: '手动价格的输入或输出至少一项必须大于 0' };
  return { mode, provider, currency, input, cached, output, unitTokens: 1_000_000 };
}

function supportedPricingScope(value) {
  return ['platform', 'user'].includes(value) ? value : null;
}

function routeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function grantQuotaOrder(db, orderId, operatorId) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM quota_orders WHERE id=?').get(orderId);
    if (!order) throw routeError(404, 'ORDER_NOT_FOUND', '订单不存在');
    if (!['pending', 'paid'].includes(order.status)) {
      throw routeError(409, 'ORDER_ALREADY_PROCESSED', '订单已处理，请勿重复发放');
    }
    const existingGrant = db.prepare("SELECT id FROM wallet_transactions WHERE related_order_id=? AND transaction_type='purchase'").get(orderId);
    if (existingGrant) throw routeError(409, 'ORDER_ALREADY_GRANTED', '该订单已有到账流水，请勿重复发放');
    const updated = db.prepare("UPDATE quota_orders SET status='granted',granted_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','paid')").run(orderId);
    if (updated.changes !== 1) throw routeError(409, 'ORDER_ALREADY_PROCESSED', '订单状态已变化，请刷新后重试');
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(order.user_id);
    if (!wallet) throw routeError(409, 'WALLET_NOT_FOUND', '用户钱包不存在，无法发放');
    const beforeBalance = Number(wallet.quota_balance ?? wallet.recharge_balance ?? 0);
    const afterBalance = beforeBalance + Number(order.amount);
    db.prepare('UPDATE wallets SET quota_balance=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, order.user_id);
    db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,related_order_id,remark,operator_id) VALUES (?,'purchase','quota',?,?,?,?,'额度包发放到账',?)")
      .run(order.user_id, Number(order.amount), beforeBalance, afterBalance, orderId, operatorId || null);
  });
}

function sendRouteError(res, error) {
  if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
  throw error;
}

router.get('/dashboard', authenticate, requireAdmin('admin','operator','finance'), (req, res) => {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];
  const todayRecharge = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM quota_orders WHERE status='granted' AND date(granted_at)=?").get(today);
  const todayConsume = db.prepare("SELECT COALESCE(SUM(total_cost),0) as total FROM api_request_logs WHERE status='success' AND date(created_at)=?").get(today);
  const newUsersToday = db.prepare('SELECT COUNT(*) as count FROM users WHERE date(register_time)=?').get(today);
  const todayCalls = db.prepare('SELECT COUNT(*) as count FROM api_request_logs WHERE date(created_at)=?').get(today);
  const failedCalls = db.prepare("SELECT COUNT(*) as count FROM api_request_logs WHERE date(created_at)=? AND status='failed'").get(today);
  const activeChannels = db.prepare("SELECT COUNT(*) as count FROM upstream_channels WHERE status='active'").get();
  const sevenDaysAgo = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  const dailyTrend = db.prepare("SELECT date(created_at) as date, COUNT(*) as calls, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success_calls, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed_calls, COALESCE(SUM(total_cost),0) as cost FROM api_request_logs WHERE created_at>=? GROUP BY date(created_at) ORDER BY date ASC").all(sevenDaysAgo);
  const modelRanking = db.prepare("SELECT model_code,COUNT(*) as calls,COALESCE(SUM(total_cost),0) as cost FROM api_request_logs WHERE status='success' GROUP BY model_code ORDER BY calls DESC LIMIT 10").all();
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM quota_orders WHERE status='granted'").get();
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  res.json({ today_recharge: todayRecharge.total, today_consumption: todayConsume.total, new_users_today: newUsersToday.count, today_calls: todayCalls.count, failed_calls: failedCalls.count, active_channels: activeChannels.count, daily_trend: dailyTrend, model_ranking: modelRanking, total_revenue: totalRevenue.total, total_users: totalUsers.count });
});

router.get('/users', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, status, search } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE 1=1'; const p = [];
  if (status) { where += ' AND u.status=?'; p.push(status); }
  if (search) { where += ' AND (u.username LIKE ? OR u.email LIKE ?)'; p.push(`%${search}%`,`%${search}%`); }
  const users = db.prepare(`SELECT u.id,u.username,u.email,u.role,u.status,u.register_time,u.last_login_time,COALESCE(w.quota_balance,w.recharge_balance,0) as quota_balance,COALESCE(w.gift_quota,w.gift_balance,0) as gift_quota,w.frozen_balance,w.total_spent FROM users u LEFT JOIN wallets w ON u.id=w.user_id ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM users u ${where}`).get(...p);
  // 兼容前端读取 recharge_balance / gift_balance
  const mapped = users.map(u => ({ ...u, recharge_balance: u.quota_balance, gift_balance: u.gift_quota }));
  res.json({ data: mapped, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

router.get('/users/:id', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const user = db.prepare('SELECT u.*,COALESCE(w.quota_balance,w.recharge_balance,0) as quota_balance,COALESCE(w.gift_quota,w.gift_balance,0) as gift_quota,w.frozen_balance,w.total_spent FROM users u LEFT JOIN wallets w ON u.id=w.user_id WHERE u.id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  user.recharge_balance = user.quota_balance;
  user.gift_balance = user.gift_quota;
  const keys = db.prepare('SELECT * FROM api_keys WHERE user_id=?').all(req.params.id);
  const recentLogs = db.prepare('SELECT * FROM api_request_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
  const recentTransactions = db.prepare('SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
  const pendingOrders = db.prepare("SELECT id,order_no,amount,status,created_at FROM quota_orders WHERE user_id=? AND status IN ('pending','paid') ORDER BY created_at DESC").all(req.params.id);
  res.json({ user, keys, recent_logs: recentLogs, recent_transactions: recentTransactions, pending_orders: pendingOrders });
});

router.patch('/users/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  const { status } = req.body;
  if (!['active','disabled','banned'].includes(status)) return res.status(400).json({ error: '状态值无效' });
  const db = getDatabase();
  db.prepare('UPDATE users SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.post('/users/:id/adjust-balance', authenticate, requireAdmin('admin','finance'), (req, res) => {
  const { amount, type, balance_type, remark, allow_pending_order_conflict: allowPendingOrderConflict } = req.body;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !type || !['manual_add','manual_deduct'].includes(type)) return res.status(400).json({ error: '参数无效' });
  const db = getDatabase();
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.params.id);
  if (!wallet) return res.status(404).json({ error: '钱包不存在' });
  const balanceType = (balance_type === 'recharge') ? 'quota' : (balance_type === 'gift') ? 'gift_quota' : (balance_type || 'quota');
  if (!['quota', 'gift_quota'].includes(balanceType)) return res.status(400).json({ error: '点数类型无效' });
  if (type === 'manual_add' && balanceType === 'quota' && allowPendingOrderConflict !== true) {
    const pendingOrder = db.prepare("SELECT id,order_no,amount,status FROM quota_orders WHERE user_id=? AND amount=? AND status IN ('pending','paid') ORDER BY created_at DESC LIMIT 1")
      .get(req.params.id, numericAmount);
    if (pendingOrder) {
      return res.status(409).json({
        error: `该用户有一笔同额待处理订单（${pendingOrder.order_no}），请前往额度订单确认发放，避免重复入账`,
        code: 'PENDING_ORDER_CONFLICT',
        pending_order: pendingOrder,
      });
    }
  }
  const changeAmount = type === 'manual_add' ? numericAmount : -numericAmount;
  const quotaBalance = wallet.quota_balance ?? wallet.recharge_balance ?? 0;
  const giftQuotaBalance = wallet.gift_quota ?? wallet.gift_balance ?? 0;
  const beforeBalance = balanceType === 'quota' ? quotaBalance : giftQuotaBalance;
  const afterBalance = beforeBalance + changeAmount;
  if (afterBalance < 0) return res.status(400).json({ error: '额度不足' });
  db.transaction(() => {
    if (balanceType === 'quota') db.prepare('UPDATE wallets SET quota_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, req.params.id);
    else db.prepare('UPDATE wallets SET gift_quota=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, req.params.id);
    const transactionRemark = allowPendingOrderConflict === true ? `${remark||'管理员调额'}（已确认与待处理订单无关）` : (remark||'管理员调额');
    db.prepare('INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,remark,operator_id) VALUES (?,?,?,?,?,?,?,?)').run(req.params.id, type, balanceType, changeAmount, beforeBalance, afterBalance, transactionRemark, req.user.id);
  });
  res.json({ message: '调额成功', before_balance: beforeBalance, after_balance: afterBalance });
});

// ========== 额度包订单管理 ==========

router.get('/recharge-orders', authenticate, requireAdmin('admin','operator','finance'), (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, status } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE 1=1'; const p = [];
  if (status) {
    // Map frontend status to DB status
    const dbStatus = status === 'credited' ? 'granted' : status;
    where += ' AND qo.status=?'; p.push(dbStatus);
  }
  try {
    const orders = db.prepare(`SELECT qo.*,u.username FROM quota_orders qo JOIN users u ON qo.user_id=u.id ${where} ORDER BY qo.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM quota_orders qo ${where}`).get(...p);
    // Map granted_at -> credited_at for frontend compatibility
    const mapped = orders.map(o => ({ ...o, credited_at: o.granted_at }));
    return res.json({ data: mapped, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
  } catch(e) {
    // Fallback to old recharge_orders table
    const orders = db.prepare(`SELECT ro.*,u.username FROM recharge_orders ro JOIN users u ON ro.user_id=u.id ${where.replace('qo.','ro.')} ORDER BY ro.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM recharge_orders ro ${where.replace('qo.','ro.')}`).get(...p);
    // Map status 'credited' -> 'granted' for frontend
    const mapped = orders.map(o => ({ ...o, status: o.status === 'credited' ? 'granted' : o.status }));
    return res.json({ data: mapped, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
  }
});

router.get('/quota-orders', authenticate, requireAdmin('admin','operator','finance'), (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, status } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE 1=1'; const p = [];
  if (status) { where += ' AND qo.status=?'; p.push(status); }
  try {
    const orders = db.prepare(`SELECT qo.*,u.username FROM quota_orders qo JOIN users u ON qo.user_id=u.id ${where} ORDER BY qo.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM quota_orders qo ${where}`).get(...p);
    const mapped = orders.map(o => ({ ...o, credited_at: o.granted_at }));
    return res.json({ data: mapped, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
  } catch(e) {
    const mappedWhere = where.replace(/qo\./g, 'ro.');
    const orders = db.prepare(`SELECT ro.*,u.username FROM recharge_orders ro JOIN users u ON ro.user_id=u.id ${mappedWhere} ORDER BY ro.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM recharge_orders ro ${mappedWhere}`).get(...p);
    const mapped = orders.map(o => ({ ...o, status: o.status === 'credited' ? 'granted' : o.status }));
    return res.json({ data: mapped, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
  }
});

router.patch('/recharge-orders/:id/confirm', authenticate, requireAdmin('admin','finance'), (req, res) => {
  const db = getDatabase();
  try {
    grantQuotaOrder(db, req.params.id, req.user.id);
    res.json({ message: '额度包已发放到账' });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.patch('/recharge-orders/:id/reject', authenticate, requireAdmin('admin','finance'), (req, res) => {
  const { remark } = req.body;
  const db = getDatabase();
  try {
    db.prepare("UPDATE quota_orders SET status='cancelled', admin_remark=? WHERE id=?").run(remark||'审核驳回', req.params.id);
  } catch(e) {
    db.prepare("UPDATE recharge_orders SET status='cancelled', admin_remark=? WHERE id=?").run(remark||'审核驳回', req.params.id);
  }
  res.json({ message: '已驳回' });
});

router.patch('/quota-orders/:id/grant', authenticate, requireAdmin('admin','finance'), (req, res) => {
  const db = getDatabase();
  try {
    grantQuotaOrder(db, req.params.id, req.user.id);
    res.json({ message: '额度包已发放到账' });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.patch('/quota-orders/:id/reject', authenticate, requireAdmin('admin','finance'), (req, res) => {
  const { remark } = req.body;
  const db = getDatabase();
  const order = db.prepare('SELECT * FROM quota_orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  db.prepare("UPDATE quota_orders SET status='cancelled', admin_remark=? WHERE id=?").run(remark||'审核驳回', req.params.id);
  res.json({ message: '已驳回' });
});

router.get('/models', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const models = db.prepare(`
    SELECT m.*,GROUP_CONCAT(DISTINCT uc.channel_name) AS channel_names
    FROM models m
    LEFT JOIN channel_models cm ON cm.model_code=m.model_code
    LEFT JOIN upstream_channels uc ON uc.id=cm.channel_id
    GROUP BY m.id ORDER BY CASE WHEN m.status='active' THEN 0 ELSE 1 END,m.sort_order ASC
  `).all();
  res.json({ data: models.map(model => ({ ...model, is_multimodal: Number(model.is_multimodal) === 1 })) });
});

router.post('/models', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { model_code, model_name, upstream_model_name, model_type, context_length, is_multimodal, description, official_model_id, sort_order } = req.body;
  const inputMultiplier = positiveMultiplier(req.body.multiplier_input ?? req.body.billing_multiplier_input ?? 1);
  const outputMultiplier = positiveMultiplier(req.body.multiplier_output ?? req.body.billing_multiplier_output ?? 1);
  const pricing = pricingPayload(req.body);
  if (!model_code || !model_name) return res.status(400).json({ error: '模型编码和名称不能为空' });
  if (pricing.error) return res.status(400).json({ error: pricing.error });
  if (!inputMultiplier || !outputMultiplier) return res.status(400).json({ error: '用户扣费倍率必须大于 0' });
  db.prepare(`INSERT INTO models (
    model_code,model_name,upstream_model_name,model_type,context_length,is_multimodal,description,
    display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,
    official_provider,official_model_id,official_currency,official_input_price,official_cached_input_price,
    official_output_price,official_unit_tokens,official_pricing_mode,official_price_source,official_price_updated_at,sort_order
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`).run(
    model_code, model_name, upstream_model_name||model_code, model_type||'llm', context_length||4096,
    is_multimodal?1:0, description||'', inputMultiplier, outputMultiplier, inputMultiplier, outputMultiplier,
    pricing.provider, official_model_id||model_code, pricing.currency, pricing.input, pricing.cached, pricing.output,
    pricing.unitTokens, pricing.mode, pricing.mode === 'manual' ? '管理员手动录入' : null, sort_order||0
  );
  res.status(201).json({ message: '模型创建成功' });
});

router.put('/models/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { model_name, upstream_model_name, model_type, context_length, is_multimodal, description, official_model_id, status, sort_order } = req.body;
  const inputMultiplier = positiveMultiplier(req.body.multiplier_input ?? req.body.billing_multiplier_input ?? 1);
  const outputMultiplier = positiveMultiplier(req.body.multiplier_output ?? req.body.billing_multiplier_output ?? 1);
  const pricing = pricingPayload(req.body);
  if (pricing.error) return res.status(400).json({ error: pricing.error });
  if (!inputMultiplier || !outputMultiplier) return res.status(400).json({ error: '用户扣费倍率必须大于 0' });
  db.prepare(`UPDATE models SET
    model_name=?,upstream_model_name=?,model_type=?,context_length=?,is_multimodal=?,description=?,
    display_multiplier_input=?,display_multiplier_output=?,billing_multiplier_input=?,billing_multiplier_output=?,
    official_provider=?,official_model_id=?,official_currency=?,official_input_price=?,official_cached_input_price=?,
    official_output_price=?,official_unit_tokens=?,official_pricing_mode=?,official_price_source=?,
    official_price_updated_at=CURRENT_TIMESTAMP,status=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    model_name, upstream_model_name, model_type, context_length, is_multimodal?1:0, description||'',
    inputMultiplier, outputMultiplier, inputMultiplier, outputMultiplier,
    pricing.provider, official_model_id||null, pricing.currency, pricing.input, pricing.cached, pricing.output,
    pricing.unitTokens, pricing.mode, pricing.mode === 'manual' ? '管理员手动录入' : null,
    status, sort_order, req.params.id
  );
  res.json({ message: '模型更新成功' });
});

router.patch('/models/:id/status', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  db.prepare('UPDATE models SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.get('/pricing-sync/status', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const config = db.prepare("SELECT config_key,config_value FROM system_config WHERE config_key IN ('usd_cny_exchange_rate','usd_cny_rate_updated_at','official_pricing_last_sync_at','official_pricing_last_sync_status')").all();
  res.json({ data: Object.fromEntries(config.map(item => [item.config_key, item.config_value])) });
});

router.post('/pricing-sync', authenticate, requireAdmin('admin'), async (req, res) => {
  const db = getDatabase();
  const [exchangeRate, officialPricing] = await Promise.all([syncUsdCnyRate(db), syncOfficialPricing(db)]);
  res.json({ message: '官方价格与汇率同步完成', exchange_rate: exchangeRate, official_pricing: officialPricing });
});

router.get('/pricing-rules', authenticate, requireAdmin('admin','operator'), (req, res) => {
  res.json({ data: getDatabase().prepare('SELECT * FROM pricing_rules ORDER BY priority DESC, created_at DESC').all() });
});

router.post('/pricing-rules', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { rule_name, model_code, scope_type, scope_id, priority, start_time, end_time, status } = req.body;
  const inputMultiplier = positiveMultiplier(req.body.multiplier_input ?? req.body.billing_multiplier_input ?? 1);
  const outputMultiplier = positiveMultiplier(req.body.multiplier_output ?? req.body.billing_multiplier_output ?? 1);
  if (!rule_name) return res.status(400).json({ error: '规则名称不能为空' });
  if (!inputMultiplier || !outputMultiplier) return res.status(400).json({ error: '用户扣费倍率必须大于 0' });
  const scope = supportedPricingScope(scope_type || 'platform');
  if (!scope || (scope === 'user' && !scope_id)) return res.status(400).json({ error: '仅支持平台默认或指定用户的倍率规则' });
  db.prepare('INSERT INTO pricing_rules (rule_name,model_code,scope_type,scope_id,display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,priority,start_time,end_time,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(rule_name, model_code||null, scope, scope === 'user' ? scope_id : null, inputMultiplier, outputMultiplier, inputMultiplier, outputMultiplier, priority||0, start_time||null, end_time||null, status||'active');
  res.status(201).json({ message: '倍率规则创建成功' });
});

router.put('/pricing-rules/:id', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { rule_name, model_code, scope_type, scope_id, priority, start_time, end_time, status } = req.body;
  const inputMultiplier = positiveMultiplier(req.body.multiplier_input ?? req.body.billing_multiplier_input ?? 1);
  const outputMultiplier = positiveMultiplier(req.body.multiplier_output ?? req.body.billing_multiplier_output ?? 1);
  if (!rule_name) return res.status(400).json({ error: '规则名称不能为空' });
  if (!inputMultiplier || !outputMultiplier) return res.status(400).json({ error: '用户扣费倍率必须大于 0' });
  const scope = supportedPricingScope(scope_type || 'platform');
  if (!scope || (scope === 'user' && !scope_id)) return res.status(400).json({ error: '仅支持平台默认或指定用户的倍率规则' });
  db.prepare('UPDATE pricing_rules SET rule_name=?,model_code=?,scope_type=?,scope_id=?,display_multiplier_input=?,display_multiplier_output=?,billing_multiplier_input=?,billing_multiplier_output=?,priority=?,start_time=?,end_time=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(rule_name, model_code||null, scope, scope === 'user' ? scope_id : null, inputMultiplier, outputMultiplier, inputMultiplier, outputMultiplier, priority, start_time, end_time, status, req.params.id);
  res.json({ message: '倍率规则更新成功' });
});

router.delete('/pricing-rules/:id', authenticate, requireAdmin('admin'), (req, res) => {
  getDatabase().prepare('DELETE FROM pricing_rules WHERE id=?').run(req.params.id);
  res.json({ message: '已删除' });
});

router.get('/keys', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, user_id, group_by } = req.query;
  const offset = (page-1)*limit;
  if (group_by === 'user') {
    const users = db.prepare(`SELECT u.id as user_id,u.username,u.role,u.status as user_status,
      COUNT(ak.id) as key_count,
      SUM(CASE WHEN ak.status='active' THEN 1 ELSE 0 END) as active_key_count
      FROM users u JOIN api_keys ak ON ak.user_id=u.id
      GROUP BY u.id,u.username,u.role,u.status
      ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(Number(limit), offset);
    const total = db.prepare("SELECT COUNT(DISTINCT user_id) as count FROM api_keys").get();
    const userIds = users.map(user => user.user_id);
    const placeholders = userIds.map(() => '?').join(',');
    const keys = userIds.length ? db.prepare(`SELECT ak.id,ak.user_id,ak.key_name,ak.key_prefix,ak.status,
      ak.rate_limit_per_min,ak.max_spend_limit,ak.created_at,ak.expired_at,ak.last_used_at,
      ak.routing_group_id,ak.permission_mode,rg.group_name
      FROM api_keys ak LEFT JOIN routing_groups rg ON rg.id=ak.routing_group_id
      WHERE ak.user_id IN (${placeholders}) ORDER BY ak.created_at DESC`).all(...userIds) : [];
    const keyIds = keys.map(key => key.id);
    const keyPlaceholders = keyIds.map(() => '?').join(',');
    const permissions = keyIds.length ? db.prepare(`SELECT api_key_id,model_code FROM api_key_permissions
      WHERE api_key_id IN (${keyPlaceholders}) AND status='active' ORDER BY model_code`).all(...keyIds) : [];
    const permissionsByKey = new Map();
    for (const permission of permissions) {
      if (!permissionsByKey.has(permission.api_key_id)) permissionsByKey.set(permission.api_key_id, []);
      permissionsByKey.get(permission.api_key_id).push(permission.model_code);
    }
    const keysByUser = new Map();
    for (const key of keys) {
      if (!keysByUser.has(key.user_id)) keysByUser.set(key.user_id, []);
      const effectiveModels = listModelsForApiKey(db, key).map(item=>item.model_code);
      keysByUser.get(key.user_id).push({ ...key, permissions: effectiveModels });
    }
    const groups = users.map(user => ({ ...user, keys: keysByUser.get(user.user_id) || [] }));
    return res.json({ data: groups, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
  }
  let where = 'WHERE 1=1'; const p = [];
  if (user_id) { where += ' AND ak.user_id=?'; p.push(user_id); }
  const keys = db.prepare(`SELECT ak.id,ak.user_id,ak.key_name,ak.key_prefix,ak.status,ak.rate_limit_per_min,
    ak.max_spend_limit,ak.created_at,ak.expired_at,ak.last_used_at,ak.routing_group_id,ak.permission_mode,rg.group_name,u.username
    FROM api_keys ak JOIN users u ON ak.user_id=u.id LEFT JOIN routing_groups rg ON rg.id=ak.routing_group_id
    ${where} ORDER BY ak.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM api_keys ak ${where}`).get(...p);
  const keysWithPerms = keys.map(k => ({ ...k, permissions: db.prepare('SELECT model_code FROM api_key_permissions WHERE api_key_id=?').all(k.id).map(x=>x.model_code) }));
  res.json({ data: keysWithPerms, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

router.patch('/keys/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  if (!['active', 'disabled'].includes(req.body.status)) return res.status(400).json({ error: '无效的 Key 状态' });
  const key = db.prepare('SELECT status FROM api_keys WHERE id=?').get(req.params.id);
  if (!key) return res.status(404).json({ error: 'Key 不存在' });
  if (key.status === 'revoked') return res.status(409).json({ error: '已撤销的 Key 不能重新启用' });
  db.prepare('UPDATE api_keys SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.put('/keys/:id/permissions', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const key = db.prepare('SELECT routing_group_id,permission_mode FROM api_keys WHERE id=?').get(req.params.id);
  if (!key) return res.status(404).json({ error: 'Key 不存在' });
  if (key.permission_mode === 'group_dynamic') return res.status(409).json({ error: '分组 Key 的模型权限由路由分组动态管理' });
  db.prepare('DELETE FROM api_key_permissions WHERE api_key_id=?').run(req.params.id);
  const ins = db.prepare('INSERT OR IGNORE INTO api_key_permissions (api_key_id,model_code) VALUES (?,?)');
  for (const c of req.body.model_codes) ins.run(req.params.id, c);
  res.json({ message: '权限已更新' });
});

router.get('/logs', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { page=1, limit=50, user_id, model, status } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE 1=1'; const p = [];
  if (user_id) { where += ' AND arl.user_id=?'; p.push(user_id); }
  if (model) { where += ' AND arl.model_code=?'; p.push(model); }
  if (status) { where += ' AND arl.status=?'; p.push(status); }
  const logs = db.prepare(`SELECT arl.*,u.username FROM api_request_logs arl LEFT JOIN users u ON arl.user_id=u.id ${where} ORDER BY arl.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM api_request_logs arl ${where}`).get(...p);
  res.json({ data: logs, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

// ========== 渠道模型管理 ==========
router.get('/channels/:id/models', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const models = db.prepare('SELECT * FROM models ORDER BY sort_order ASC').all();
  const mappings = db.prepare('SELECT model_code,upstream_model_name,supports_image_input,status FROM channel_models WHERE channel_id=?').all(req.params.id);
  res.json({ data: models, channel_model_codes: mappings.filter(m=>m.status==='active').map(m=>m.model_code), mappings });
});

router.put('/channels/:id/models', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { model_codes, mappings = {}, models } = req.body;
  const requestedModels = Array.isArray(models)
    ? models.map(item => ({
      model_code: item.model_code,
      upstream_model_name: item.upstream_model_name || item.model_code,
      supports_image_input: item.supports_image_input === true ? 1 : item.supports_image_input === false ? 0 : null,
    }))
    : (model_codes || []).map(modelCode => ({
      model_code: modelCode,
      upstream_model_name: mappings[modelCode] || modelCode,
      supports_image_input: null,
    }));
  db.transaction(() => {
    db.prepare('UPDATE channel_models SET status=\'inactive\',updated_at=CURRENT_TIMESTAMP WHERE channel_id=?').run(req.params.id);
    const upsert = db.prepare(`INSERT INTO channel_models (channel_id,model_code,upstream_model_name,supports_image_input,status)
      VALUES (?,?,?,?,'active') ON CONFLICT(channel_id,model_code) DO UPDATE SET
      upstream_model_name=excluded.upstream_model_name,supports_image_input=excluded.supports_image_input,
      status='active',updated_at=CURRENT_TIMESTAMP`);
    for (const item of requestedModels) {
      if (!item.model_code) continue;
      upsert.run(req.params.id, item.model_code, item.upstream_model_name, item.supports_image_input);
    }
  });
  res.json({ message: '渠道模型已更新' });
});

router.post('/channels/:id/sync-models', authenticate, requireAdmin('admin'), async (req, res) => {
  const db = getDatabase();
  const channel = db.prepare('SELECT * FROM upstream_channels WHERE id=?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: '渠道不存在' });
  try {
    const baseUrl = channel.base_url.replace(/\/+$/, '');
    const upstream = await axios.get(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${channel.api_key}` },
      timeout: 20000
    });
    const modelCodes = normalizeUpstreamModels(upstream.data);
    if (modelCodes.length === 0) return res.status(502).json({ error: '上游未返回任何模型' });

    let created = 0;
    let updated = 0;
    for (const modelCode of modelCodes) {
      const existing = db.prepare('SELECT id FROM models WHERE model_code=?').get(modelCode);
      const provider = inferProvider({ model_code: modelCode });
      if (existing) {
        db.prepare(`UPDATE models SET upstream_model_name=COALESCE(upstream_model_name,?),
          channel_id=COALESCE(channel_id,?),official_provider=COALESCE(?,official_provider),
          official_model_id=COALESCE(official_model_id,?),status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(modelCode, channel.id, provider, modelCode, existing.id);
        updated++;
      } else {
        db.prepare(`INSERT INTO models (model_code,model_name,upstream_model_name,model_type,context_length,
          display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,
          official_provider,official_model_id,official_pricing_mode,channel_id,status,sort_order)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`)
          .run(modelCode, modelCode, modelCode, inferModelType(modelCode), 128000, 1, 1, 1, 1,
            provider || 'manual', modelCode, provider ? 'auto' : 'manual', channel.id, 1000 + created);
        created++;
      }
      db.prepare(`INSERT INTO channel_models (channel_id,model_code,upstream_model_name,status)
        VALUES (?,?,?,'active') ON CONFLICT(channel_id,model_code) DO UPDATE SET
        upstream_model_name=excluded.upstream_model_name,status='active',updated_at=CURRENT_TIMESTAMP`)
        .run(channel.id, modelCode, modelCode);
    }

    res.json({ message: `同步完成：新增 ${created}，更新 ${updated}`, created, updated, models: modelCodes });
  } catch (error) {
    const status = error.response?.status;
    res.status(502).json({ error: `上游模型同步失败${status ? `（HTTP ${status}）` : ''}` });
  }
});

// ========== 路由分组：用户 Key 绑定分组，分组内再按优先级/权重/健康度选渠道 ==========
router.get('/routing-groups', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const groups = db.prepare(`
    SELECT rg.*,fallback.group_name AS fallback_group_name,
           COUNT(DISTINCT rgc.channel_id) AS channel_count,
           COUNT(DISTINCT CASE WHEN cm.status='active' AND m.status='active' THEN cm.model_code END) AS model_count,
           COUNT(DISTINCT ak.id) AS key_count
    FROM routing_groups rg
    LEFT JOIN routing_groups fallback ON fallback.id=rg.fallback_group_id
    LEFT JOIN routing_group_channels rgc ON rgc.group_id=rg.id AND rgc.status='active'
    LEFT JOIN channel_models cm ON cm.channel_id=rgc.channel_id
    LEFT JOIN models m ON m.model_code=cm.model_code
    LEFT JOIN api_keys ak ON ak.routing_group_id=rg.id AND ak.status!='revoked'
    GROUP BY rg.id ORDER BY CASE WHEN rg.status='active' THEN 0 ELSE 1 END,rg.id ASC
  `).all();
  const links = db.prepare(`
    SELECT rgc.*,uc.channel_name,uc.base_url,uc.health_score,uc.status AS channel_status
    FROM routing_group_channels rgc JOIN upstream_channels uc ON uc.id=rgc.channel_id
    ORDER BY rgc.priority DESC,rgc.id ASC
  `).all();
  const groupModels = db.prepare("SELECT group_id,model_code FROM routing_group_models WHERE status='active' ORDER BY model_code").all();
  res.json({ data: groups.map(group => ({
    ...group,
    model_count: listRoutingGroupModels(db, group.id).length,
    channels: links.filter(link => link.group_id === group.id),
    model_codes: groupModels.filter(item => item.group_id === group.id).map(item => item.model_code),
  })) });
});

router.post('/routing-groups', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { group_name, description, fallback_group_id, status='active', channels=[], model_codes=[] } = req.body;
  const restrictModels = req.body.restrict_models ? 1 : 0;
  if (!String(group_name||'').trim()) return res.status(400).json({ error: '分组名称不能为空' });
  if (!['active','inactive'].includes(status)) return res.status(400).json({ error: '分组状态无效' });
  try {
    const id = db.transaction(() => {
      const result = db.prepare(`INSERT INTO routing_groups
        (group_name,description,protocol_type,status,fallback_group_id,restrict_models) VALUES (?,?,'openai_compatible',?,?,?)`)
        .run(String(group_name).trim(), description||'', status, fallback_group_id||null, restrictModels);
      const insert = db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,priority,weight,status) VALUES (?,?,?,?,?)`);
      for (const channel of channels) insert.run(result.lastInsertRowid, channel.channel_id, channel.priority??0, channel.weight??100, channel.status||'active');
      const insertModel = db.prepare("INSERT INTO routing_group_models (group_id,model_code,status) VALUES (?,?,'active')");
      for (const modelCode of model_codes) insertModel.run(result.lastInsertRowid, modelCode);
      return result.lastInsertRowid;
    });
    res.status(201).json({ message: '路由分组创建成功', id });
  } catch (error) {
    res.status(409).json({ error: error.message.includes('UNIQUE') ? '分组名称已存在' : '路由分组创建失败' });
  }
});

router.put('/routing-groups/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { group_name, description, fallback_group_id, status='active', channels=[], model_codes=[] } = req.body;
  const restrictModels = req.body.restrict_models ? 1 : 0;
  if (!String(group_name||'').trim()) return res.status(400).json({ error: '分组名称不能为空' });
  if (Number(fallback_group_id) === Number(req.params.id)) return res.status(400).json({ error: '备用分组不能指向自己' });
  try {
    db.transaction(() => {
      db.prepare(`UPDATE routing_groups SET group_name=?,description=?,fallback_group_id=?,status=?,restrict_models=?,
        legacy_channel_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(String(group_name).trim(), description||'', fallback_group_id||null, status, restrictModels, req.params.id);
      db.prepare('DELETE FROM routing_group_channels WHERE group_id=?').run(req.params.id);
      const insert = db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,priority,weight,status) VALUES (?,?,?,?,?)`);
      for (const channel of channels) insert.run(req.params.id, channel.channel_id, channel.priority??0, channel.weight??100, channel.status||'active');
      db.prepare('DELETE FROM routing_group_models WHERE group_id=?').run(req.params.id);
      const insertModel = db.prepare("INSERT INTO routing_group_models (group_id,model_code,status) VALUES (?,?,'active')");
      for (const modelCode of model_codes) insertModel.run(req.params.id, modelCode);
    });
    res.json({ message: '路由分组已更新' });
  } catch (error) {
    res.status(409).json({ error: error.message.includes('UNIQUE') ? '分组名称已存在' : '路由分组更新失败' });
  }
});

router.patch('/routing-groups/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  if (!['active','inactive'].includes(req.body.status)) return res.status(400).json({ error: '分组状态无效' });
  getDatabase().prepare('UPDATE routing_groups SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '分组状态已更新' });
});

router.delete('/routing-groups/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const group = db.prepare('SELECT id FROM routing_groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '路由分组不存在' });
  const used = db.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE routing_group_id=? AND status!='revoked'").get(req.params.id);
  if (used.count > 0) return res.status(409).json({ error: '该分组仍有 API Key 使用，不能删除' });
  const fallbackUsed = db.prepare(`SELECT COUNT(*) AS count FROM routing_groups
    WHERE fallback_group_id=? AND status='active'`).get(req.params.id);
  if (fallbackUsed.count > 0) return res.status(409).json({ error: '该分组仍被启用分组设为备用，请先解除备用关系后再删除' });
  db.transaction(() => {
    db.prepare('UPDATE api_keys SET routing_group_id=NULL WHERE routing_group_id=?').run(req.params.id);
    db.prepare('UPDATE routing_groups SET fallback_group_id=NULL WHERE fallback_group_id=?').run(req.params.id);
    db.prepare('DELETE FROM routing_group_channels WHERE group_id=?').run(req.params.id);
    db.prepare('DELETE FROM routing_group_models WHERE group_id=?').run(req.params.id);
    db.prepare('DELETE FROM routing_groups WHERE id=?').run(req.params.id);
  });
  res.json({ message: '路由分组已删除' });
});

router.get('/channels', authenticate, requireAdmin('admin'), (req, res) => {
  const channels = getDatabase().prepare(`SELECT uc.*,GROUP_CONCAT(DISTINCT rg.group_name) AS group_names,
    COUNT(DISTINCT cm.model_code) AS model_count FROM upstream_channels uc
    LEFT JOIN routing_group_channels rgc ON rgc.channel_id=uc.id
    LEFT JOIN routing_groups rg ON rg.id=rgc.group_id
    LEFT JOIN channel_models cm ON cm.channel_id=uc.id AND cm.status='active'
    GROUP BY uc.id ORDER BY uc.priority DESC,uc.id ASC`).all();
  res.json({ data: channels.map(c=>({
    ...c,
    api_key: desensitize(c.api_key),
    capabilities: parseChannelCapabilities(c.capabilities),
  })) });
});

router.post('/channels', authenticate, requireAdmin('admin'), (req, res) => {
  const { channel_name, base_url, api_key, priority, weight, protocol_type='openai_compatible', capabilities } = req.body;
  if (!String(channel_name||'').trim() || !String(base_url||'').trim() || !String(api_key||'').trim()) return res.status(400).json({ error: '渠道名称、上游地址和 API Key 不能为空' });
  if (protocol_type !== 'openai_compatible') return res.status(400).json({ error: '当前版本仅支持 OpenAI 兼容协议' });
  let serializedCapabilities;
  try { serializedCapabilities = serializeChannelCapabilities(capabilities); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  getDatabase().prepare('INSERT INTO upstream_channels (channel_name,base_url,api_key,priority,weight,protocol_type,capabilities) VALUES (?,?,?,?,?,?,?)').run(String(channel_name).trim(), String(base_url).replace(/\/+$/, ''), api_key, priority||0, weight||100, protocol_type, serializedCapabilities);
  res.status(201).json({ message: '渠道创建成功' });
});

router.patch('/channels/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  getDatabase().prepare('UPDATE upstream_channels SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.delete('/channels/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const channel = db.prepare('SELECT id FROM upstream_channels WHERE id=?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: '渠道不存在' });
  const linkedGroups = db.prepare('SELECT COUNT(*) AS count FROM routing_group_channels WHERE channel_id=?').get(req.params.id);
  if (linkedGroups.count > 0) {
    return res.status(409).json({ error: `该渠道仍被 ${linkedGroups.count} 个路由分组使用，请先在分组中移除后再删除` });
  }
  const legacyGroups = db.prepare('SELECT COUNT(*) AS count FROM routing_groups WHERE legacy_channel_id=?').get(req.params.id);
  if (legacyGroups.count > 0) {
    return res.status(409).json({ error: `该渠道仍被 ${legacyGroups.count} 个历史路由分组引用，请先解除引用后再删除` });
  }
  const legacyKeys = db.prepare(`SELECT COUNT(*) AS count FROM models m
    JOIN api_key_permissions permission ON permission.model_code=m.model_code AND permission.status='active'
    JOIN api_keys ak ON ak.id=permission.api_key_id AND ak.status!='revoked'
    WHERE m.channel_id=? AND m.status='active' AND ak.routing_group_id IS NULL`).get(req.params.id);
  if (legacyKeys.count > 0) {
    return res.status(409).json({ error: '该渠道仍被旧版直连 API Key 使用，不能删除' });
  }
  db.transaction(() => {
    db.prepare('UPDATE models SET channel_id=NULL WHERE channel_id=?').run(req.params.id);
    db.prepare('DELETE FROM channel_models WHERE channel_id=?').run(req.params.id);
    db.prepare('DELETE FROM upstream_channels WHERE id=?').run(req.params.id);
  });
  res.json({ message: '渠道已删除' });
});

// 更新渠道信息（名称/地址/Key/权重）
router.put('/channels/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const { channel_name, base_url, api_key, priority, weight, protocol_type='openai_compatible', capabilities } = req.body;
  const db = getDatabase();
  if (!String(channel_name||'').trim() || !String(base_url||'').trim()) return res.status(400).json({ error: '渠道名称和上游地址不能为空' });
  if (protocol_type !== 'openai_compatible') return res.status(400).json({ error: '当前版本仅支持 OpenAI 兼容协议' });
  const existingChannel = db.prepare('SELECT capabilities FROM upstream_channels WHERE id=?').get(req.params.id);
  if (!existingChannel) return res.status(404).json({ error: '渠道不存在' });
  let serializedCapabilities;
  try {
    serializedCapabilities = capabilities === undefined
      ? (existingChannel.capabilities || JSON.stringify(['chat_completions']))
      : serializeChannelCapabilities(capabilities);
  }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (api_key && api_key.trim()) {
    db.prepare('UPDATE upstream_channels SET channel_name=?, base_url=?, api_key=?, priority=?, weight=?, protocol_type=?, capabilities=?, health_score=50, consecutive_failures=0, circuit_breaker_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(String(channel_name).trim(), String(base_url).replace(/\/+$/, ''), api_key, priority||0, weight||100, protocol_type, serializedCapabilities, req.params.id);
  } else {
    db.prepare('UPDATE upstream_channels SET channel_name=?, base_url=?, priority=?, weight=?, protocol_type=?, capabilities=?, health_score=50, consecutive_failures=0, circuit_breaker_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(String(channel_name).trim(), String(base_url).replace(/\/+$/, ''), priority||0, weight||100, protocol_type, serializedCapabilities, req.params.id);
  }
  res.json({ message: '渠道已更新' });
});

router.get('/config', authenticate, requireAdmin('admin'), (req, res) => {
  res.json({ data: getDatabase().prepare('SELECT * FROM system_config').all() });
});

router.put('/config/:key', authenticate, requireAdmin('admin'), (req, res) => {
  getDatabase().prepare('UPDATE system_config SET config_value=?, updated_at=CURRENT_TIMESTAMP WHERE config_key=?').run(req.body.config_value, req.params.key);
  res.json({ message: '已更新' });
});

module.exports = router;
