const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
  res.json({ user, keys, recent_logs: recentLogs, recent_transactions: recentTransactions });
});

router.patch('/users/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  const { status } = req.body;
  if (!['active','disabled','banned'].includes(status)) return res.status(400).json({ error: '状态值无效' });
  const db = getDatabase();
  db.prepare('UPDATE users SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.post('/users/:id/adjust-balance', authenticate, requireAdmin('admin','finance'), (req, res) => {
  const { amount, type, balance_type, remark } = req.body;
  if (!amount || !type || !['manual_add','manual_deduct'].includes(type)) return res.status(400).json({ error: '参数无效' });
  const db = getDatabase();
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.params.id);
  if (!wallet) return res.status(404).json({ error: '钱包不存在' });
  const changeAmount = type === 'manual_add' ? Math.abs(amount) : -Math.abs(amount);
  const bt = (balance_type === 'recharge') ? 'quota' : (balance_type === 'gift') ? 'gift_quota' : (balance_type || 'quota');
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const gq = wallet.gift_quota || wallet.gift_balance || 0;
  const beforeBalance = bt === 'quota' ? qb : gq;
  const afterBalance = beforeBalance + changeAmount;
  if (afterBalance < 0) return res.status(400).json({ error: '额度不足' });
  if (bt === 'quota') db.prepare('UPDATE wallets SET quota_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, req.params.id);
  else db.prepare('UPDATE wallets SET gift_quota=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, req.params.id);
  db.prepare('INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,remark,operator_id) VALUES (?,?,?,?,?,?,?,?)').run(req.params.id, type, bt, changeAmount, beforeBalance, afterBalance, remark||'管理员调额', req.user.id);
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
    const dbStatus = status === 'granted' ? 'granted' : status;
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
  let order;
  try {
    order = db.prepare('SELECT * FROM quota_orders WHERE id=?').get(req.params.id);
    if (!order) {
      order = db.prepare('SELECT * FROM recharge_orders WHERE id=?').get(req.params.id);
      if (!order) return res.status(404).json({ error: '订单不存在' });
    }
  } catch(e) {
    order = db.prepare('SELECT * FROM recharge_orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
  }
  if (order.status!=='pending' && order.status!=='paid') return res.status(400).json({ error: '订单状态不允许' });
  // Update quota_orders with granted status
  try {
    db.prepare("UPDATE quota_orders SET status='granted', granted_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  } catch(e) {
    db.prepare("UPDATE recharge_orders SET status='credited', credited_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  }
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(order.user_id);
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const afterBalance = qb + order.amount;
  db.prepare('UPDATE wallets SET quota_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, order.user_id);
  db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,related_order_id,remark) VALUES (?,'purchase','quota',?,?,?,?,'额度包发放到账')").run(order.user_id, order.amount, qb, afterBalance, req.params.id);
  res.json({ message: '额度包已发放到账' });
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
  const order = db.prepare('SELECT * FROM quota_orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status!=='pending' && order.status!=='paid') return res.status(400).json({ error: '订单状态不允许' });
  db.prepare("UPDATE quota_orders SET status='granted', granted_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(order.user_id);
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const afterBalance = qb + order.amount;
  db.prepare('UPDATE wallets SET quota_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, order.user_id);
  db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,related_order_id,remark) VALUES (?,'purchase','quota',?,?,?,?,'额度包发放到账')").run(order.user_id, order.amount, qb, afterBalance, req.params.id);
  res.json({ message: '额度包已发放到账' });
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
  const models = db.prepare('SELECT m.*, uc.channel_name FROM models m LEFT JOIN upstream_channels uc ON m.channel_id=uc.id ORDER BY m.sort_order ASC').all();
  res.json({ data: models });
});

router.post('/models', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { model_code, model_name, upstream_model_name, model_type, context_length, is_multimodal, description, base_input_price, base_output_price, display_multiplier_input, display_multiplier_output, billing_multiplier_input, billing_multiplier_output, sort_order } = req.body;
  if (!model_code || !model_name) return res.status(400).json({ error: '模型编码和名称不能为空' });
  db.prepare('INSERT INTO models (model_code,model_name,upstream_model_name,model_type,context_length,is_multimodal,description,base_input_price,base_output_price,display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(model_code, model_name, upstream_model_name||model_code, model_type||'llm', context_length||4096, is_multimodal?1:0, description||'', base_input_price||0, base_output_price||0, display_multiplier_input||1, display_multiplier_output||1, billing_multiplier_input||1, billing_multiplier_output||1, sort_order||0);
  res.status(201).json({ message: '模型创建成功' });
});

router.put('/models/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { model_name, upstream_model_name, model_type, context_length, is_multimodal, description, base_input_price, base_output_price, display_multiplier_input, display_multiplier_output, billing_multiplier_input, billing_multiplier_output, status, sort_order } = req.body;
  db.prepare('UPDATE models SET model_name=?,upstream_model_name=?,model_type=?,context_length=?,is_multimodal=?,description=?,base_input_price=?,base_output_price=?,display_multiplier_input=?,display_multiplier_output=?,billing_multiplier_input=?,billing_multiplier_output=?,status=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(model_name, upstream_model_name, model_type, context_length, is_multimodal?1:0, description, base_input_price, base_output_price, display_multiplier_input, display_multiplier_output, billing_multiplier_input, billing_multiplier_output, status, sort_order, req.params.id);
  res.json({ message: '模型更新成功' });
});

router.patch('/models/:id/status', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  db.prepare('UPDATE models SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.get('/pricing-rules', authenticate, requireAdmin('admin','operator'), (req, res) => {
  res.json({ data: getDatabase().prepare('SELECT * FROM pricing_rules ORDER BY priority DESC, created_at DESC').all() });
});

router.post('/pricing-rules', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { rule_name, model_code, scope_type, scope_id, display_multiplier_input, display_multiplier_output, billing_multiplier_input, billing_multiplier_output, priority, start_time, end_time, status } = req.body;
  db.prepare('INSERT INTO pricing_rules (rule_name,model_code,scope_type,scope_id,display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,priority,start_time,end_time,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(rule_name, model_code, scope_type||'platform', scope_id||null, display_multiplier_input||1, display_multiplier_output||1, billing_multiplier_input||1, billing_multiplier_output||1, priority||0, start_time||null, end_time||null, status||'active');
  res.status(201).json({ message: '倍率规则创建成功' });
});

router.put('/pricing-rules/:id', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { rule_name, model_code, scope_type, scope_id, display_multiplier_input, display_multiplier_output, billing_multiplier_input, billing_multiplier_output, priority, start_time, end_time, status } = req.body;
  db.prepare('UPDATE pricing_rules SET rule_name=?,model_code=?,scope_type=?,scope_id=?,display_multiplier_input=?,display_multiplier_output=?,billing_multiplier_input=?,billing_multiplier_output=?,priority=?,start_time=?,end_time=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(rule_name, model_code, scope_type, scope_id, display_multiplier_input, display_multiplier_output, billing_multiplier_input, billing_multiplier_output, priority, start_time, end_time, status, req.params.id);
  res.json({ message: '倍率规则更新成功' });
});

router.delete('/pricing-rules/:id', authenticate, requireAdmin('admin'), (req, res) => {
  getDatabase().prepare('DELETE FROM pricing_rules WHERE id=?').run(req.params.id);
  res.json({ message: '已删除' });
});

router.get('/keys', authenticate, requireAdmin('admin','operator'), (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, user_id } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE 1=1'; const p = [];
  if (user_id) { where += ' AND ak.user_id=?'; p.push(user_id); }
  const keys = db.prepare(`SELECT ak.*,u.username FROM api_keys ak JOIN users u ON ak.user_id=u.id ${where} ORDER BY ak.created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM api_keys ak ${where}`).get(...p);
  const keysWithPerms = keys.map(k => ({ ...k, permissions: db.prepare('SELECT model_code FROM api_key_permissions WHERE api_key_id=?').all(k.id).map(x=>x.model_code) }));
  res.json({ data: keysWithPerms, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

router.patch('/keys/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  getDatabase().prepare('UPDATE api_keys SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '状态已更新' });
});

router.put('/keys/:id/permissions', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
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
  const models = db.prepare('SELECT * FROM models WHERE channel_id=? OR channel_id IS NULL ORDER BY sort_order ASC').all(req.params.id);
  const channelModels = db.prepare('SELECT model_code FROM models WHERE channel_id=?').all(req.params.id).map(m=>m.model_code);
  res.json({ data: models, channel_model_codes: channelModels });
});

router.put('/channels/:id/models', authenticate, requireAdmin('admin'), (req, res) => {
  const db = getDatabase();
  const { model_codes } = req.body;
  db.prepare('UPDATE models SET channel_id=NULL WHERE channel_id=?').run(req.params.id);
  if (model_codes && model_codes.length>0) {
    const stmt = db.prepare('UPDATE models SET channel_id=?, updated_at=CURRENT_TIMESTAMP WHERE model_code=?');
    for (const mc of model_codes) stmt.run(req.params.id, mc);
  }
  res.json({ message: '渠道模型已更新' });
});

router.get('/channels', authenticate, requireAdmin('admin'), (req, res) => {
  const channels = getDatabase().prepare('SELECT * FROM upstream_channels ORDER BY priority ASC').all();
  res.json({ data: channels.map(c=>({...c, api_key: c.api_key.substring(0,8)+'***'})) });
});

router.post('/channels', authenticate, requireAdmin('admin'), (req, res) => {
  const { channel_name, base_url, api_key, priority, weight } = req.body;
  getDatabase().prepare('INSERT INTO upstream_channels (channel_name,base_url,api_key,priority,weight) VALUES (?,?,?,?,?)').run(channel_name, base_url, api_key, priority||0, weight||100);
  res.status(201).json({ message: '渠道创建成功' });
});

router.patch('/channels/:id/status', authenticate, requireAdmin('admin'), (req, res) => {
  getDatabase().prepare('UPDATE upstream_channels SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
  res.json({ message: '状态已更新' });
});

// 更新渠道信息（名称/地址/Key/权重）
router.put('/channels/:id', authenticate, requireAdmin('admin'), (req, res) => {
  const { channel_name, base_url, api_key, priority, weight } = req.body;
  getDatabase().prepare('UPDATE upstream_channels SET channel_name=?, base_url=?, api_key=COALESCE(?,api_key), priority=?, weight=?, health_score=50, consecutive_failures=0, circuit_breaker_until=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(channel_name, base_url, api_key||null, priority||0, weight||100, req.params.id);
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