const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt, desensitize } = require('../utils/crypto');
const { generateDocs } = require('../utils/channel-docs');

router.get('/wallet', authenticate, (req, res) => {
  const db = getDatabase();
  const w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.user.id) || {};
  const qb = w.quota_balance || w.recharge_balance || 0;
  const gq = w.gift_quota || w.gift_balance || 0;
  res.json({ quota_balance: qb, gift_quota: gq, frozen_balance: w.frozen_balance||0, total_balance: qb+gq-(w.frozen_balance||0), total_spent: w.total_spent||0 });
});

router.get('/transactions', authenticate, (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, type } = req.query;
  const offset = (page-1)*limit;
  let q = 'SELECT * FROM wallet_transactions WHERE user_id=?';
  const p = [req.user.id];
  if (type) { q += ' AND transaction_type=?'; p.push(type); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  p.push(Number(limit), offset);
  const data = db.prepare(q).all(...p);
  const total = db.prepare('SELECT COUNT(*) as count FROM wallet_transactions WHERE user_id=?').get(req.user.id);
  res.json({ data, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

router.post('/quota-order', authenticate, (req, res) => {
  const { amount, payment_method='manual_transfer' } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: '点数无效' });
  const db = getDatabase();
  const orderNo = 'QPO'+Date.now()+Math.random().toString(36).substring(2,8).toUpperCase();
  db.prepare("INSERT INTO quota_orders (order_no,user_id,amount,payment_method,status) VALUES (?,?,?,?,'pending')").run(orderNo, req.user.id, amount, payment_method);
  res.status(201).json({ message: '额度包订单已创建，请转账后联系管理员确认发放', order_no: orderNo, amount });
});

router.get('/quota-orders', authenticate, (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20 } = req.query;
  const offset = (page-1)*limit;
  const data = db.prepare('SELECT id,order_no,user_id,amount,payment_method,status,payment_proof,admin_remark,created_at,paid_at,granted_at as credited_at FROM quota_orders WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.user.id, Number(limit), offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM quota_orders WHERE user_id=?').get(req.user.id);
  res.json({ data, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

router.get('/models', authenticate, (req, res) => {
  const db = getDatabase();
  const models = db.prepare("SELECT model_code,model_name,model_type,context_length,is_multimodal,description,display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,official_price_updated_at,status FROM models WHERE status='active' ORDER BY sort_order ASC").all();
  const now = new Date().toISOString();
  const ruleForModel = db.prepare("SELECT * FROM pricing_rules WHERE (model_code=? OR model_code IS NULL) AND status='active' AND (start_time IS NULL OR start_time<=?) AND (end_time IS NULL OR end_time>=?) AND ((scope_type='user' AND scope_id=?) OR scope_type='platform') ORDER BY CASE scope_type WHEN 'user' THEN 2 WHEN 'platform' THEN 1 END DESC, priority DESC LIMIT 1");
  const data = models.map(model => {
    const rule = ruleForModel.get(model.model_code, now, now, req.user.id);
    return rule ? { ...model, billing_multiplier_input: rule.billing_multiplier_input, billing_multiplier_output: rule.billing_multiplier_output } : model;
  });
  res.json({ data });
});

router.get('/channels', authenticate, (req, res) => {
  const db = getDatabase();
  const channels = db.prepare("SELECT uc.id, uc.channel_name, COUNT(m.id) as model_count FROM upstream_channels uc LEFT JOIN models m ON m.channel_id=uc.id AND m.status='active' WHERE uc.status='active' GROUP BY uc.id ORDER BY uc.priority ASC").all();
  res.json({ data: channels });
});

// ========== API Keys ==========

router.get('/keys', authenticate, (req, res) => {
  const db = getDatabase();
  const keys = db.prepare("SELECT id,key_name,key_prefix,status,rate_limit_per_min,max_spend_limit,created_at,expired_at,last_used_at FROM api_keys WHERE user_id=? AND status!='revoked' ORDER BY created_at DESC").all(req.user.id);
  const keysWithModels = keys.map(k => {
    // 脱敏 key_prefix: sk-XXXX... → sk-XXX****XXXX
    k.key_prefix = desensitize(k.key_prefix);
    const models = db.prepare("SELECT m.model_code,m.model_name,uc.channel_name FROM api_key_permissions akp JOIN models m ON akp.model_code=m.model_code AND m.status='active' LEFT JOIN upstream_channels uc ON m.channel_id=uc.id WHERE akp.api_key_id=? AND akp.status='active'").all(k.id);
    const channelNames = [...new Set(models.map(m=>m.channel_name).filter(Boolean))];
    return { ...k, models, model_count: models.length, channel_name: channelNames[0] || null, channel_names: channelNames };
  });
  res.json({ data: keysWithModels });
});

router.post('/keys', authenticate, (req, res) => {
  const { key_name, channel_id } = req.body;
  if (!channel_id) return res.status(400).json({ error: '请选择分组' });
  const db = getDatabase();
  const channel = db.prepare("SELECT * FROM upstream_channels WHERE id=? AND status='active'").get(channel_id);
  if (!channel) return res.status(400).json({ error: '分组无效' });
  const keyRaw = 'sk-' + uuidv4().replace(/-/g, '');
  const keyHash = bcrypt.hashSync(keyRaw, 10);
  const keyEncrypted = encrypt(keyRaw);           // AES 加密存储原密钥
  const keyPrefix = keyRaw.substring(0, 12);      // 原始前缀，列表页会脱敏
  const result = db.prepare("INSERT INTO api_keys (user_id,key_name,key_hash,key_prefix,key_encrypted,status) VALUES (?,?,?,?,?,'active')").run(req.user.id, key_name||'未命名密钥', keyHash, keyPrefix, keyEncrypted);
  const activeModels = db.prepare("SELECT model_code FROM models WHERE status='active' AND channel_id=?").all(channel_id);
  const insertPerm = db.prepare('INSERT OR IGNORE INTO api_key_permissions (api_key_id,model_code) VALUES (?,?)');
  for (const m of activeModels) insertPerm.run(result.lastInsertRowid, m.model_code);
  res.status(201).json({ message: 'API Key 创建成功', key: { id: result.lastInsertRowid, key_raw: keyRaw, key_prefix: desensitize(keyPrefix), key_name: key_name||'未命名密钥', channel_name: channel.channel_name } });
});

// 导出/恢复完整密钥（需验证密码）
router.post('/keys/:id/export', authenticate, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '请输入登录密码以验证身份' });
  const db = getDatabase();
  // 验证密码
  const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(403).json({ error: '密码错误，验证失败' });
  }
  // 查找 key
  const key = db.prepare('SELECT * FROM api_keys WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!key) return res.status(404).json({ error: 'API Key 不存在' });
  if (!key.key_encrypted) return res.status(400).json({ error: '此密钥创建于旧版本，不支持恢复' });
  try {
    const raw = decrypt(key.key_encrypted);
    res.json({ key_raw: raw, key_prefix: desensitize(raw), key_name: key.key_name });
  } catch(e) {
    res.status(500).json({ error: '解密失败，请联系管理员' });
  }
});

router.delete('/keys/:id', authenticate, (req, res) => {
  const db = getDatabase();
  const key = db.prepare('SELECT * FROM api_keys WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!key) return res.status(404).json({ error: 'API Key 不存在' });
  db.prepare('UPDATE api_keys SET status=? WHERE id=?').run('revoked', req.params.id);
  res.json({ message: 'API Key 已删除' });
});

router.patch('/keys/:id/toggle', authenticate, (req, res) => {
  const db = getDatabase();
  const key = db.prepare('SELECT * FROM api_keys WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!key) return res.status(404).json({ error: 'API Key 不存在' });
  const ns = key.status === 'active' ? 'disabled' : 'active';
  db.prepare('UPDATE api_keys SET status=? WHERE id=?').run(ns, req.params.id);
  res.json({ message: `API Key 已${ns==='active'?'启用':'禁用'}`, status: ns });
});

router.get('/logs', authenticate, (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20, model, key_id, start_date, end_date } = req.query;
  const offset = (page-1)*limit;
  let where = 'WHERE user_id=?';
  const p = [req.user.id];
  if (model) { where += ' AND model_code=?'; p.push(model); }
  if (key_id) { where += ' AND api_key_id=?'; p.push(key_id); }
  if (start_date) { where += ' AND created_at>=?'; p.push(start_date); }
  if (end_date) { where += ' AND created_at<=?'; p.push(end_date+' 23:59:59'); }
  const data = db.prepare(`SELECT request_id,api_key_id,model_code,input_tokens,cached_input_tokens,output_tokens,total_cost,status,error_message,error_type,latency_ms,created_at,official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny FROM api_request_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM api_request_logs ${where}`).get(...p);
  res.json({ data, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

// ========== 统计 - 每日趋势 ==========

router.get('/stats/daily', authenticate, (req, res) => {
  const db = getDatabase();
  const { start_date, end_date } = req.query;
  let where = "WHERE user_id=? AND status='success'";
  const params = [req.user.id];
  if (start_date) { where += ' AND date(created_at)>=?'; params.push(start_date); }
  if (end_date) { where += ' AND date(created_at)<=?'; params.push(end_date); }
  const daily = db.prepare(`SELECT date(created_at) as date, COUNT(*) as calls, COALESCE(SUM(total_cost),0) as cost, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens FROM api_request_logs ${where} GROUP BY date(created_at) ORDER BY date ASC`).all(...params);
  res.json({ data: daily });
});

// ========== 修改密码 ==========

router.put('/password', authenticate, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写旧密码和新密码' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) return res.status(400).json({ error: '旧密码错误' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.user.id);
    res.json({ message: '密码修改成功' });
});

router.post('/recharge', authenticate, (req, res) => {
  const { amount, payment_method='manual_transfer' } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: '点数无效' });
  const db = getDatabase();
  const orderNo = 'QPO'+Date.now()+Math.random().toString(36).substring(2,8).toUpperCase();
  db.prepare("INSERT INTO quota_orders (order_no,user_id,amount,payment_method,status) VALUES (?,?,?,?,'pending')").run(orderNo, req.user.id, amount, payment_method);
  res.status(201).json({ message: '额度包订单已创建，请转账后联系管理员确认发放', order_no: orderNo, amount });
});

router.get('/recharge-orders', authenticate, (req, res) => {
  const db = getDatabase();
  const { page=1, limit=20 } = req.query;
  const offset = (page-1)*limit;
  const data = db.prepare('SELECT id,order_no,user_id,amount,payment_method,status,payment_proof,admin_remark,created_at,paid_at,granted_at as credited_at FROM quota_orders WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.user.id, Number(limit), offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM quota_orders WHERE user_id=?').get(req.user.id);
  res.json({ data, pagination: { page: Number(page), limit: Number(limit), total: total.count } });
});

// ========== 渠道使用文档 ==========

router.get('/docs/channel', authenticate, (req, res) => {
  const { channel_name } = req.query;
  if (!channel_name) return res.status(400).json({ error: '缺少 channel_name 参数' });
  const db = getDatabase();
  const channel = db.prepare("SELECT * FROM upstream_channels WHERE channel_name=? AND status='active'").get(channel_name);
  if (!channel) return res.status(404).json({ error: '渠道不存在' });
  const models = db.prepare("SELECT model_code, model_name FROM models WHERE channel_id=? AND status='active' ORDER BY sort_order ASC").all(channel.id);
  // 获取当前用户的一个有效的 key_prefix
  const apiKey = db.prepare("SELECT key_prefix FROM api_keys WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT 1").get(req.user.id);
  const keyPrefix = apiKey ? desensitize(apiKey.key_prefix).substring(0, 15) : 'sk-your-key';
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const docs = generateDocs(baseUrl, channel_name, keyPrefix, models);
  res.json({
    channel_name,
    base_url: baseUrl,
    key_prefix_hint: keyPrefix,
    models: models.map(m => ({ model_code: m.model_code, model_name: m.model_name })),
    ...docs
  });
});

router.get('/stats', authenticate, (req, res) => {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  const todayConsumption = db.prepare("SELECT COALESCE(SUM(total_cost),0) as total FROM api_request_logs WHERE user_id=? AND status='success' AND date(created_at)=?").get(req.user.id, today);
  const totalConsumption = db.prepare("SELECT COALESCE(SUM(total_cost),0) as total FROM api_request_logs WHERE user_id=? AND status='success'").get(req.user.id);
    const totalCalls = db.prepare('SELECT COUNT(*) as count FROM api_request_logs WHERE user_id=?').get(req.user.id);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.user.id) || {};
    const quotaBalance = wallet.quota_balance || wallet.recharge_balance || 0;
    const giftQuota = wallet.gift_quota || wallet.gift_balance || 0;
    const modelUsage = db.prepare("SELECT model_code,COUNT(*) as calls,COALESCE(SUM(total_cost),0) as cost FROM api_request_logs WHERE user_id=? AND status='success' GROUP BY model_code ORDER BY cost DESC").all(req.user.id);
  // 今日调用次数
  const todayCalls = db.prepare("SELECT COUNT(*) as count FROM api_request_logs WHERE user_id=? AND date(created_at)=?").get(req.user.id, today);
  // 今日成功/失败/拦截
  const todayStatus = db.prepare("SELECT status,COUNT(*) as count FROM api_request_logs WHERE user_id=? AND date(created_at)=? GROUP BY status").all(req.user.id, today);
  // 累计成功/失败/拦截
  const totalStatus = db.prepare("SELECT status,COUNT(*) as count FROM api_request_logs WHERE user_id=? GROUP BY status").all(req.user.id);
  // 输入/输出Token总计
  const tokenStats = db.prepare("SELECT COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens FROM api_request_logs WHERE user_id=? AND status='success'").get(req.user.id);
  res.json({
    today_consumption: todayConsumption.total,
    today_calls: todayCalls.count,
    total_consumption: totalConsumption.total,
    total_calls: totalCalls.count,
    model_usage: modelUsage,
    today_status: todayStatus,
    total_status: totalStatus,
    input_tokens: tokenStats.input_tokens,
    output_tokens: tokenStats.output_tokens,
    quota_balance: quotaBalance,
    gift_quota: giftQuota
  });
});

module.exports = router;
