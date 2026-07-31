const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt, desensitize } = require('../utils/crypto');
const { generateDocs } = require('../utils/channel-docs');
const { buildBillingDetail } = require('../utils/billing-detail');
const {
  listModelsForApiKey,
  listRoutingGroupModels,
  listRoutingGroupProtocolTypes,
  mergeAvailableModel,
} = require('../utils/routing-group-models');
const { buildEasyPayRequest, supportedPaymentMethods } = require('../utils/easypay');
const { defaultImageDisplayPricing } = require('../utils/pricing-engine');

router.get('/wallet', authenticate, (req, res) => {
  const db = getDatabase();
  const w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.user.id) || {};
  const qb = w.quota_balance ?? w.recharge_balance ?? 0;
  const gq = w.gift_quota ?? w.gift_balance ?? 0;
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

function configValue(db, key, fallback = '') {
  return db.prepare('SELECT config_value FROM system_config WHERE config_key=?').get(key)?.config_value ?? fallback;
}

function expirePendingPaymentOrders(db, userId = null) {
  const where = userId === null ? '' : ' AND user_id=?';
  const params = userId === null ? [] : [userId];
  db.prepare(`UPDATE quota_orders SET status='cancelled',admin_remark='在线支付订单超时' WHERE status='pending' AND payment_provider_id IS NOT NULL AND expires_at IS NOT NULL AND expires_at<CURRENT_TIMESTAMP${where}`).run(...params);
}

router.get('/payment-options', authenticate, (req, res) => {
  const db = getDatabase();
  const enabled = configValue(db, 'payment_enabled', 'false') === 'true';
  const provider = db.prepare("SELECT id,enabled_methods FROM payment_providers WHERE provider_type='easypay' AND status='active' ORDER BY id ASC LIMIT 1").get();
  const minimum = Number(configValue(db, 'payment_min_amount', '1'));
  const maximum = Number(configValue(db, 'payment_max_amount', '10000'));
  res.json({ enabled: enabled && Boolean(provider), methods: enabled && provider ? supportedPaymentMethods(provider) : [], minimum, maximum });
});

router.get('/payment-orders/:orderNo', authenticate, (req, res) => {
  const order = getDatabase().prepare(`SELECT order_no,amount,payment_method,status,created_at,paid_at,granted_at,expires_at
    FROM quota_orders WHERE order_no=? AND user_id=? AND payment_provider_id IS NOT NULL`).get(req.params.orderNo, req.user.id);
  if (!order) return res.status(404).json({ error: '支付订单不存在' });
  expirePendingPaymentOrders(getDatabase(), req.user.id);
  res.json({ data: getDatabase().prepare('SELECT order_no,amount,payment_method,status,created_at,paid_at,granted_at,expires_at FROM quota_orders WHERE order_no=?').get(order.order_no) });
});

router.post('/payment-orders', authenticate, (req, res) => {
  const db = getDatabase();
  const requestedAmount = Number(req.body?.amount);
  const amountInCents = Math.round(requestedAmount * 100);
  const amount = amountInCents / 100;
  const paymentMethod = String(req.body?.payment_method || '');
  if (!['alipay', 'wechat'].includes(paymentMethod)) return res.status(400).json({ error: '请选择支付宝或微信支付' });
  if (configValue(db, 'payment_enabled', 'false') !== 'true') return res.status(403).json({ error: '在线支付暂未开启' });
  const minimum = Number(configValue(db, 'payment_min_amount', '1'));
  const maximum = Number(configValue(db, 'payment_max_amount', '10000'));
  if (!Number.isFinite(requestedAmount) || Math.abs(requestedAmount * 100 - amountInCents) > 0.000001 || amount < minimum || amount > maximum) return res.status(400).json({ error: `充值金额需为 ${minimum} 至 ${maximum} 元之间、最多两位小数的金额` });
  const siteUrl = String(configValue(db, 'payment_site_url', '')).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(siteUrl)) return res.status(409).json({ error: '在线支付尚未配置公开 HTTPS 地址' });
  expirePendingPaymentOrders(db, req.user.id);
  const maxPending = Number(configValue(db, 'payment_max_pending_orders', '3'));
  const pendingOrders = db.prepare("SELECT COUNT(*) AS count FROM quota_orders WHERE user_id=? AND status='pending' AND payment_provider_id IS NOT NULL").get(req.user.id).count;
  if (pendingOrders >= maxPending) return res.status(429).json({ error: '待支付订单过多，请先完成或等待已有订单过期' });
  const provider = db.prepare("SELECT * FROM payment_providers WHERE provider_type='easypay' AND status='active' ORDER BY id ASC LIMIT 1").get();
  if (!provider) return res.status(409).json({ error: '尚未配置可用的易支付服务商' });
  if (!supportedPaymentMethods(provider).includes(paymentMethod)) return res.status(400).json({ error: '当前易支付未启用该支付方式' });
  const orderNo = `EP${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const timeout = Math.max(1, Number(configValue(db, 'payment_order_timeout_minutes', '30')) || 30);
  try {
    const paymentRequest = buildEasyPayRequest({ provider, orderNo, amount, paymentMethod, siteUrl });
    db.prepare(`INSERT INTO quota_orders
      (order_no,user_id,amount,payment_method,status,payment_provider_id,payment_channel,expires_at)
      VALUES (?,?,?,?, 'pending',?,?,datetime('now', ?))`)
      .run(orderNo, req.user.id, amount, 'easypay', provider.id, paymentMethod, `+${timeout} minutes`);
    res.status(201).json({ order_no: orderNo, amount, payment_method: paymentMethod, expires_at: timeout, payment_request: paymentRequest });
  } catch (error) {
    res.status(400).json({ error: error.message || '创建支付订单失败' });
  }
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
  const catalog = db.prepare(`SELECT model_code,model_name,model_type,context_length,
    official_provider,official_currency,official_input_price,official_output_price,
    official_cached_input_price,official_unit_tokens,official_price_updated_at,sort_order
    FROM models WHERE status='active' ORDER BY sort_order ASC,model_code ASC`).all();
  const catalogByCode = new Map(catalog.map(model => [model.model_code, model]));
  const apiKeys = db.prepare(`SELECT
    ak.id,ak.routing_group_id,ak.permission_mode,
    rg.group_name,rg.description,
    rg.billing_multiplier_input,rg.billing_multiplier_output,rg.billing_multiplier_image
    FROM api_keys ak
    JOIN routing_groups rg ON rg.id=ak.routing_group_id AND rg.status='active'
    WHERE ak.user_id=? AND ak.status='active'
      AND (ak.expired_at IS NULL OR datetime(ak.expired_at)>=datetime('now'))
    ORDER BY rg.id ASC,ak.id ASC`).all(req.user.id);
  const groupsById = new Map();
  for (const apiKey of apiKeys) {
    const group = groupsById.get(apiKey.routing_group_id) || {
      id: apiKey.routing_group_id,
      group_name: apiKey.group_name,
      description: apiKey.description,
      billing_multiplier_input: apiKey.billing_multiplier_input,
      billing_multiplier_output: apiKey.billing_multiplier_output,
      billing_multiplier_image: apiKey.billing_multiplier_image,
      modelsByCode: new Map(),
    };
    for (const availableModel of listModelsForApiKey(db, apiKey)) {
      group.modelsByCode.set(
        availableModel.model_code,
        mergeAvailableModel(group.modelsByCode.get(availableModel.model_code), availableModel),
      );
    }
    groupsById.set(group.id, group);
  }
  const groups = [...groupsById.values()].map(({ modelsByCode: groupModelsByCode, ...group }) => {
    const models = [...groupModelsByCode.values()]
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
        || a.model_code.localeCompare(b.model_code))
      .map(availableModel => {
        const catalogModel = catalogByCode.get(availableModel.model_code) || {};
        const model = {
          ...catalogModel,
          ...availableModel,
          is_multimodal: Boolean(availableModel.capabilities?.image_input),
          supports_image_input: Boolean(availableModel.capabilities?.image_input),
        };
        if (model.model_type !== 'image') return model;
        const {
          official_currency,
          official_input_price,
          official_output_price,
          official_cached_input_price,
          official_unit_tokens,
          official_price_updated_at,
          ...publicImageModel
        } = model;
        const imageDisplayPricing = defaultImageDisplayPricing();
        return {
          ...publicImageModel,
          default_image_unit_price: imageDisplayPricing.unitPrice,
          default_image_currency: imageDisplayPricing.currency,
        };
      });
    return {
      ...group,
      protocol_types: [...new Set(models.flatMap(model => model.protocol_types || []))].sort(),
      models,
    };
  });
  const modelsByCode = new Map();
  for (const group of groups) {
    for (const model of group.models) {
      modelsByCode.set(
        model.model_code,
        mergeAvailableModel(modelsByCode.get(model.model_code), model),
      );
    }
  }
  const data = [...modelsByCode.values()].sort((a, b) =>
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
      || a.model_code.localeCompare(b.model_code));
  res.json({ data, groups, has_api_keys: groups.length > 0 });
});

router.get('/channels', authenticate, (req, res) => {
  const db = getDatabase();
  const groups = db.prepare(`
    SELECT rg.id,rg.group_name AS channel_name,rg.description,rg.protocol_type,
           COUNT(DISTINCT CASE WHEN m.status='active' AND cm.status='active' THEN m.model_code END) AS model_count
    FROM routing_groups rg
    LEFT JOIN routing_group_channels rgc ON rgc.group_id=rg.id AND rgc.status='active'
    LEFT JOIN upstream_channels uc ON uc.id=rgc.channel_id AND uc.status='active'
    LEFT JOIN channel_models cm ON cm.channel_id=rgc.channel_id
    LEFT JOIN models m ON m.model_code=cm.model_code
    WHERE rg.status='active'
    GROUP BY rg.id ORDER BY rg.id ASC
  `).all();
  res.json({ data: groups.map(group => {
    const protocolTypes = listRoutingGroupProtocolTypes(db, group.id);
    return {
      ...group,
      protocol_type: protocolTypes.length === 1 ? protocolTypes[0] : 'mixed',
      protocol_types: protocolTypes,
      model_count: listRoutingGroupModels(db, group.id).length,
    };
  }) });
});

// ========== API Keys ==========

router.get('/keys', authenticate, (req, res) => {
  const db = getDatabase();
  const keys = db.prepare(`
    SELECT ak.id,ak.key_name,ak.key_prefix,ak.status,ak.rate_limit_per_min,ak.max_spend_limit,
           ak.created_at,ak.expired_at,ak.last_used_at,ak.routing_group_id,ak.permission_mode,rg.group_name
    FROM api_keys ak LEFT JOIN routing_groups rg ON rg.id=ak.routing_group_id
    WHERE ak.user_id=? AND ak.status!='revoked' ORDER BY ak.created_at DESC
  `).all(req.user.id);
  const keysWithModels = keys.map(k => {
    // 脱敏 key_prefix: sk-XXXX... → sk-XXX****XXXX
    k.key_prefix = desensitize(k.key_prefix);
    const models = listModelsForApiKey(db, k);
    return { ...k, models, model_count: models.length, channel_name: k.group_name || null, channel_names: k.group_name ? [k.group_name] : [] };
  });
  res.json({ data: keysWithModels });
});

router.post('/keys', authenticate, (req, res) => {
  const { key_name } = req.body;
  const routingGroupId = req.body.routing_group_id || req.body.channel_id;
  if (!routingGroupId) return res.status(400).json({ error: '请选择分组' });
  const db = getDatabase();
  const group = db.prepare("SELECT * FROM routing_groups WHERE id=? AND status='active'").get(routingGroupId);
  if (!group) return res.status(400).json({ error: '分组无效' });
  const keyRaw = 'sk-' + uuidv4().replace(/-/g, '');
  const keyHash = bcrypt.hashSync(keyRaw, 10);
  const keyEncrypted = encrypt(keyRaw);           // AES 加密存储原密钥
  const keyPrefix = keyRaw.substring(0, 12);      // 原始前缀，列表页会脱敏
  const result = db.prepare("INSERT INTO api_keys (user_id,key_name,key_hash,key_prefix,key_encrypted,routing_group_id,permission_mode,status) VALUES (?,?,?,?,?,?,'group_dynamic','active')").run(req.user.id, key_name||'未命名密钥', keyHash, keyPrefix, keyEncrypted, routingGroupId);
  const activeModels = listRoutingGroupModels(db, routingGroupId);
  const insertPerm = db.prepare('INSERT OR IGNORE INTO api_key_permissions (api_key_id,model_code) VALUES (?,?)');
  for (const m of activeModels) insertPerm.run(result.lastInsertRowid, m.model_code);
  res.status(201).json({ message: 'API Key 创建成功', key: { id: result.lastInsertRowid, key_raw: keyRaw, key_prefix: desensitize(keyPrefix), key_name: key_name||'未命名密钥', channel_name: group.group_name, routing_group_id: routingGroupId } });
});

// 已登录用户复制自己名下的完整密钥
router.post('/keys/:id/export', authenticate, (req, res) => {
  const db = getDatabase();
  const key = db.prepare('SELECT * FROM api_keys WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!key) return res.status(404).json({ error: 'API Key 不存在' });
  if (!key.key_encrypted) return res.status(400).json({ error: '此密钥创建于旧版本，不支持恢复' });
  try {
    const raw = decrypt(key.key_encrypted);
    res.json({ key_raw: raw });
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

function parseLogDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { value: String(value), timestamp };
}

function sqliteUtcTime(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function buildLogFilters(userId, query, requireDates = false, requiredDateMessage = '导出必须提供完整的开始和结束日期') {
  const hasStart = query.start_date !== undefined && query.start_date !== '';
  const hasEnd = query.end_date !== undefined && query.end_date !== '';
  if (requireDates && (!hasStart || !hasEnd)) throw new Error(requiredDateMessage);
  if (hasStart !== hasEnd) throw new Error('开始和结束日期必须同时提供');
  let startDate = null;
  let endDate = null;
  let where = 'WHERE user_id=?';
  const params = [userId];
  if (query.model) { where += ' AND model_code=?'; params.push(String(query.model)); }
  if (query.key_id) { where += ' AND api_key_id=?'; params.push(query.key_id); }
  if (hasStart && hasEnd) {
    startDate = parseLogDate(query.start_date);
    endDate = parseLogDate(query.end_date);
    if (!startDate || !endDate) throw new Error('日期格式无效，请使用 YYYY-MM-DD');
    if (startDate.timestamp > endDate.timestamp) throw new Error('开始日期不能晚于结束日期');
    const days = Math.floor((endDate.timestamp - startDate.timestamp) / 86400000) + 1;
    if (days > 90) throw new Error('日期范围不能超过 90 个自然日');
    where += ' AND created_at>=? AND created_at<?';
    params.push(sqliteUtcTime(startDate.timestamp - 8 * 3600000));
    params.push(sqliteUtcTime(endDate.timestamp + 86400000 - 8 * 3600000));
  }
  return { where, params, startDate, endDate };
}

function parsePositiveInteger(value, fallback, maximum) {
  const text = value === undefined ? String(fallback) : String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function formatCsvBeijingTime(value) {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function csvField(value, protectFormula = false) {
  let text = value === null || value === undefined ? '' : String(value);
  if (protectFormula && /^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

router.get('/logs/export', authenticate, (req, res) => {
  let filters;
  try {
    filters = buildLogFilters(req.user.id, req.query, true);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const rows = getDatabase().prepare(`SELECT request_id,model_code,billing_mode,input_tokens,cached_input_tokens,
    cache_creation_tokens,image_input_tokens,output_tokens,image_output_tokens,image_count,total_cost,status,
    latency_ms,error_type,error_message,created_at FROM api_request_logs ${filters.where}
    ORDER BY created_at DESC, id DESC`).all(...filters.params);
  const headers = ['请求 ID','时间（北京时间）','模型','计费方式','输入 Token','缓存输入 Token','缓存创建 Token','图片输入 Token','输出 Token','图片输出 Token','图片数量','费用（点）','状态','延迟（毫秒）','错误类型','错误信息'];
  const billingModes = { token: 'Token', image: '图片', per_request: '每请求', count_tokens: 'Token 计数' };
  const statuses = { success: '成功', failed: '失败', blocked: '拦截' };
  const lines = [headers.map(value => csvField(value)).join(',')];
  for (const row of rows) {
    lines.push([
      csvField(row.request_id, true), csvField(formatCsvBeijingTime(row.created_at)), csvField(row.model_code, true),
      csvField(billingModes[row.billing_mode] || row.billing_mode, true), csvField(row.input_tokens),
      csvField(row.cached_input_tokens), csvField(row.cache_creation_tokens), csvField(row.image_input_tokens),
      csvField(row.output_tokens), csvField(row.image_output_tokens), csvField(row.image_count), csvField(row.total_cost),
      csvField(statuses[row.status] || row.status, true), csvField(row.latency_ms), csvField(row.error_type, true),
      csvField(row.error_message, true),
    ].join(','));
  }
  const filename = `调用记录_${filters.startDate.value}_${filters.endDate.value}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="logs_${filters.startDate.value}_${filters.endDate.value}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

router.get('/logs', authenticate, (req, res) => {
  const db = getDatabase();
  const page = parsePositiveInteger(req.query.page, 1, 1000000);
  const limit = parsePositiveInteger(req.query.limit, 20, 100);
  if (!page || !limit) return res.status(400).json({ error: '页码或每页数量无效' });
  let filters;
  try {
    filters = buildLogFilters(req.user.id, req.query);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const offset = (page - 1) * limit;
  const { where, params: p } = filters;
  const rows = db.prepare(`SELECT request_id,api_key_id,model_code,input_tokens,cached_input_tokens,cache_creation_tokens,
    image_input_tokens,output_tokens,image_output_tokens,total_cost,status,error_message,error_type,latency_ms,created_at,
    official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,
    official_cache_creation_price,official_image_input_price,official_image_output_price,official_unit_tokens,
    usd_cny_rate,billing_multiplier_input,billing_multiplier_output,official_cost_cny,
    billing_mode,billing_model_source,service_tier,long_context_billing_applied,
    image_count,image_size,image_quality,image_operation,image_input_count,image_output_format,image_output_compression,
    official_image_unit_price,billing_multiplier_image,
    (SELECT base_input_price FROM models WHERE models.model_code=api_request_logs.model_code) as legacy_input_price,
    (SELECT base_output_price FROM models WHERE models.model_code=api_request_logs.model_code) as legacy_output_price
    FROM api_request_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...p, Number(limit), offset);
  const data = rows.map(row => {
    const billingDetail = buildBillingDetail({
      modelCode: row.model_code,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      imageInputTokens: row.image_input_tokens,
      outputTokens: row.output_tokens,
      imageOutputTokens: row.image_output_tokens,
      totalCost: row.total_cost,
      billingMode: row.billing_mode,
      image: {
        count: row.image_count,
        size: row.image_size,
        quality: row.image_quality,
        unitPrice: row.official_image_unit_price,
      },
      official: row.official_currency ? {
        currency: row.official_currency,
        input: row.official_input_price,
        cachedInput: row.official_cached_input_price ?? row.official_input_price,
        ...(row.official_cache_creation_price === null
          ? {}
          : { cacheCreation: row.official_cache_creation_price }),
        imageInput: row.official_image_input_price ?? row.official_input_price,
        output: row.official_output_price,
        imageOutput: row.official_image_output_price ?? row.official_output_price,
        unitTokens: row.official_unit_tokens,
      } : {},
      legacy: { input: row.legacy_input_price, output: row.legacy_output_price, unitTokens: 1_000 },
      multipliers: { input: row.billing_multiplier_input, output: row.billing_multiplier_output, image: row.billing_multiplier_image },
      usdCnyRate: row.usd_cny_rate,
      serviceTier: row.service_tier,
    });
    if (row.billing_mode !== 'image') return { ...row, billing_detail: billingDetail };
    const { official_currency, official_input_price, official_output_price, official_cached_input_price,
      official_cache_creation_price, official_image_input_price, official_image_output_price,
      official_unit_tokens, official_image_unit_price, ...publicImageLog } = row;
    const imageDisplayPricing = defaultImageDisplayPricing();
    return {
      ...publicImageLog,
      default_image_unit_price: imageDisplayPricing.unitPrice,
      default_image_currency: imageDisplayPricing.currency,
      billing_detail: {
        ...billingDetail,
        dimensions: billingDetail.dimensions.map(({ unitPrice, ...dimension }) => dimension),
        notice: '当前默认图片单价已在模型页展示；历史账单仅保留实际扣费金额，不展示旧单价。',
      },
    };
  });
  const total = db.prepare(`SELECT COUNT(*) as count FROM api_request_logs ${where}`).get(...p);
  res.json({ data, pagination: { page, limit, total: total.count } });
});

// ========== 统计 - 每日趋势 ==========

router.get('/stats/daily', authenticate, (req, res) => {
  let filters;
  try {
    filters = buildLogFilters(req.user.id, req.query, true, '每日统计必须提供完整的开始和结束日期');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const beijingDate = "date(created_at,'+8 hours')";
  const daily = getDatabase().prepare(`SELECT ${beijingDate} as date, COUNT(*) as calls,
    COALESCE(SUM(total_cost),0) as cost, COALESCE(SUM(input_tokens),0) as input_tokens,
    COALESCE(SUM(output_tokens),0) as output_tokens FROM api_request_logs
    ${filters.where} AND status='success' GROUP BY ${beijingDate} ORDER BY date ASC`).all(...filters.params);
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
  const group = db.prepare("SELECT * FROM routing_groups WHERE group_name=? AND status='active'").get(channel_name);
  if (!group) return res.status(404).json({ error: '分组不存在' });
  const apiKey = db.prepare(`SELECT id,key_prefix,routing_group_id,permission_mode FROM api_keys
    WHERE user_id=? AND routing_group_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`)
    .get(req.user.id, group.id);
  if (!apiKey) return res.status(404).json({ error: '当前账户没有该分组的有效 API Key' });
  const models = listModelsForApiKey(db, apiKey);
  // 获取当前用户在该分组下的有效 key_prefix
  const keyPrefix = apiKey ? desensitize(apiKey.key_prefix).substring(0, 15) : 'sk-your-key';
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const protocolTypes = listRoutingGroupProtocolTypes(db, group.id);
  const protocolDocs = protocolTypes.map(protocolType => {
    const messageModels = protocolType === 'anthropic'
      ? models.filter(model => model.capabilities?.anthropic_messages)
      : models.filter(model => model.capabilities?.chat_completions);
    const countTokenModels = protocolType === 'anthropic'
      ? models.filter(model => model.capabilities?.anthropic_count_tokens)
      : [];
    const enabledCapabilities = protocolType === 'anthropic'
      ? [
        ...(messageModels.length ? ['anthropic_messages'] : []),
        ...(countTokenModels.length ? ['anthropic_count_tokens'] : []),
      ]
      : ['chat_completions'];
    if (protocolType === 'anthropic' && enabledCapabilities.length === 0) return null;
    const protocolModels = messageModels.length ? messageModels : countTokenModels;
    const documentedModels = protocolType === 'anthropic'
      ? models.filter(model => model.capabilities?.anthropic_messages
        || model.capabilities?.anthropic_count_tokens)
      : protocolModels;
    return {
      ...generateDocs(
        baseUrl,
        channel_name,
        keyPrefix,
        protocolModels,
        protocolType,
        enabledCapabilities,
      ),
      models: documentedModels.map(model => ({
        model_code: model.model_code,
        model_name: model.model_name,
        capabilities: protocolType === 'anthropic'
          ? {
            anthropic_messages: Boolean(model.capabilities?.anthropic_messages),
            anthropic_count_tokens: Boolean(model.capabilities?.anthropic_count_tokens),
          }
          : { chat_completions: Boolean(model.capabilities?.chat_completions) },
      })),
    };
  }).filter(Boolean);
  const documentedProtocolTypes = protocolDocs.map(item => item.protocol_type === 'openai'
    ? 'openai_compatible'
    : item.protocol_type);
  const docs = protocolDocs[0];
  res.json({
    channel_name,
    base_url: baseUrl,
    key_prefix_hint: keyPrefix,
    models: models.map(m => ({ model_code: m.model_code, model_name: m.model_name })),
    supported_protocols: documentedProtocolTypes,
    protocol_docs: protocolDocs,
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
    const quotaBalance = wallet.quota_balance ?? wallet.recharge_balance ?? 0;
    const giftQuota = wallet.gift_quota ?? wallet.gift_balance ?? 0;
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
