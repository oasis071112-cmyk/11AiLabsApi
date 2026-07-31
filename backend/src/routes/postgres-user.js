const { randomUUID } = require('node:crypto');
const express = require('express');
const { withTransaction } = require('../infrastructure/postgres');
const { createPostgresIdentity } = require('../modules/identity');
const { createPostgresPaymentService } = require('../modules/postgres-payment');

function numberValues(row = {}) {
  const result = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) result[key] = Number(value);
  }
  return result;
}

function positiveInteger(value, fallback, maximum) {
  const text = value === undefined ? String(fallback) : String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function parseDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return text;
}

function buildLogFilters(userId, query, { requireDates = false, requiredDateMessage = '导出必须提供完整的开始和结束日期' } = {}) {
  const hasStart = query.start_date !== undefined && query.start_date !== '';
  const hasEnd = query.end_date !== undefined && query.end_date !== '';
  if (requireDates && (!hasStart || !hasEnd)) throw new Error(requiredDateMessage);
  if (hasStart !== hasEnd) throw new Error('开始和结束日期必须同时提供');
  const values = [userId];
  const conditions = ['user_id=$1'];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };
  if (query.model) add('model_code=?', String(query.model));
  if (query.key_id) add('api_key_id=?', String(query.key_id));
  let startDate = null;
  let endDate = null;
  if (hasStart && hasEnd) {
    startDate = parseDate(query.start_date);
    endDate = parseDate(query.end_date);
    if (!startDate || !endDate) throw new Error('日期格式无效，请使用 YYYY-MM-DD');
    if (startDate > endDate) throw new Error('开始日期不能晚于结束日期');
    const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > 90) throw new Error('日期范围不能超过 90 个自然日');
    add("(created_at AT TIME ZONE 'Asia/Shanghai')::date>=?::date", startDate);
    add("(created_at AT TIME ZONE 'Asia/Shanghai')::date<=?::date", endDate);
  }
  return { conditions: conditions.join(' AND '), values, startDate, endDate };
}

function walletPayload(row = {}) {
  const wallet = numberValues(row);
  const quota = Number(wallet.quota_balance || 0);
  const gift = Number(wallet.gift_quota || 0);
  const frozen = Number(wallet.frozen_balance || 0);
  return {
    quota_balance: quota,
    gift_quota: gift,
    frozen_balance: frozen,
    total_balance: quota + gift - frozen,
    total_spent: Number(wallet.total_spent || 0),
  };
}

function formatCsvBeijingTime(value) {
  const date = new Date(value);
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
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createPostgresUserRouter(options = {}) {
  const {
    pool,
    secretBox,
    idFactory = randomUUID,
  } = options;
  const identity = options.identity || createPostgresIdentity({ pool, secretBox });
  const paymentService = options.paymentService || createPostgresPaymentService({
    pool, secretBox, idFactory: options.paymentOrderIdFactory, siteUrl: options.siteUrl,
  });
  if (!pool?.query || !pool?.connect) throw new TypeError('PostgreSQL user pool.query and pool.connect are required');
  if (!identity?.authenticate || !identity?.bcrypt || !identity?.sealApiKey || !identity?.openApiKey) {
    throw new TypeError('PostgreSQL identity with API key encryption is required');
  }
  if (!secretBox?.seal || !secretBox?.open) throw new TypeError('PostgreSQL user secretBox is required');
  const router = express.Router();

  router.get('/wallet', identity.authenticate, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT quota_balance,gift_quota,frozen_balance,total_spent
        FROM wallets WHERE user_id=$1`, [req.user.id]);
      return res.json(walletPayload(rows[0]));
    } catch (error) { return next(error); }
  });

  router.get('/transactions', identity.authenticate, async (req, res, next) => {
    const page = positiveInteger(req.query.page, 1, 1_000_000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    if (!page || !limit) return res.status(400).json({ error: '页码或每页数量无效' });
    try {
      const values = [req.user.id];
      let where = 'user_id=$1';
      if (req.query.type) {
        values.push(String(req.query.type));
        where += ` AND transaction_type=$${values.length}`;
      }
      const offset = (page - 1) * limit;
      const pageValues = [...values, limit, offset];
      const pageSql = `SELECT id,transaction_key,transaction_type,balance_type,amount,before_balance,after_balance,
        related_request_id,remark,metadata,created_at FROM wallet_transactions WHERE ${where}
        ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
      const [rows, total] = await Promise.all([
        pool.query(pageSql, pageValues),
        pool.query(`SELECT COUNT(*) AS count FROM wallet_transactions WHERE ${where}`, values),
      ]);
      return res.json({ data: rows.rows.map(numberValues), pagination: { page, limit, total: Number(total.rows[0]?.count || 0) } });
    } catch (error) { return next(error); }
  });

  router.get('/payment-options', identity.authenticate, async (_req, res, next) => {
    try {
      return res.json(await paymentService.getPaymentOptions());
    } catch (error) { return next(error); }
  });

  router.post('/payment-orders', identity.authenticate, async (req, res, next) => {
    try {
      const payload = await paymentService.createPaymentOrder({
        userId: req.user.id,
        amount: req.body?.amount,
        paymentMethod: req.body?.payment_method ?? req.body?.paymentMethod,
      });
      return res.status(201).json(payload);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      return next(error);
    }
  });

  router.get('/payment-orders/:orderNo', identity.authenticate, async (req, res, next) => {
    try {
      return res.json(await paymentService.getPaymentOrder({ userId: req.user.id, orderNo: req.params.orderNo }));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      return next(error);
    }
  });

  const createManualOrder = async (req, res, next) => {
    try {
      return res.status(201).json(await paymentService.createManualQuotaOrder({
        userId: req.user.id,
        amount: req.body?.amount,
        paymentMethod: req.body?.payment_method ?? req.body?.paymentMethod ?? 'manual_transfer',
      }));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      return next(error);
    }
  };
  const listManualOrders = async (req, res, next) => {
    try {
      return res.json(await paymentService.listQuotaOrders({ userId: req.user.id, page: req.query.page, limit: req.query.limit }));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      return next(error);
    }
  };
  router.post('/quota-order', identity.authenticate, createManualOrder);
  router.get('/quota-orders', identity.authenticate, listManualOrders);
  router.post('/recharge', identity.authenticate, createManualOrder);
  router.get('/recharge-orders', identity.authenticate, listManualOrders);

  router.get('/models', identity.authenticate, async (req, res, next) => {
    try {
      const [modelResult, keyResult] = await Promise.all([
        pool.query(`SELECT DISTINCT m.model_code,m.model_name,m.model_type,
        COALESCE((m.metadata->>'sort_order')::integer,0) AS sort_order,
        BOOL_OR(am.supports_image_input) AS supports_image_input,
        jsonb_agg(DISTINCT ua.protocol_type) AS protocol_types
        FROM api_keys ak
        JOIN routing_groups rg ON rg.id=ak.routing_group_id AND rg.status='active'
        JOIN routing_group_accounts rga ON rga.routing_group_id=ak.routing_group_id AND rga.status='active'
        JOIN upstream_accounts ua ON ua.id=rga.account_id AND ua.status='active'
        JOIN account_models am ON am.account_id=ua.id AND am.status='active'
        JOIN models m ON m.model_code=am.model_code AND m.status='active'
        LEFT JOIN routing_group_models group_model ON group_model.routing_group_id=rg.id
          AND group_model.model_code=m.model_code AND group_model.status='active'
        LEFT JOIN api_key_permissions permission ON permission.api_key_id=ak.id
          AND permission.model_code=m.model_code AND permission.status='active'
        WHERE ak.user_id=$1 AND ak.status='active'
          AND (ak.expired_at IS NULL OR ak.expired_at>=CURRENT_TIMESTAMP)
          AND (rg.restrict_models=FALSE OR group_model.model_code IS NOT NULL)
          AND (ak.permission_mode='group_dynamic' OR permission.api_key_id IS NOT NULL)
        GROUP BY m.model_code,m.model_name,m.model_type,m.metadata
        ORDER BY sort_order ASC,m.model_code ASC`, [req.user.id]),
        pool.query(`SELECT EXISTS(SELECT 1 FROM api_keys WHERE user_id=$1 AND status='active'
          AND (expired_at IS NULL OR expired_at>=CURRENT_TIMESTAMP)) AS has_api_keys`, [req.user.id]),
      ]);
      const models = modelResult.rows.map(row => ({ ...numberValues(row), is_multimodal: Boolean(row.supports_image_input) }));
      return res.json({ data: models, groups: [], has_api_keys: Boolean(keyResult.rows[0]?.has_api_keys) });
    } catch (error) { return next(error); }
  });

  router.get('/channels', identity.authenticate, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT DISTINCT rg.id,rg.group_name AS channel_name,rg.protocol_type,
        COUNT(DISTINCT am.model_code) FILTER (WHERE am.status='active') AS model_count
        FROM api_keys ak
        JOIN routing_groups rg ON rg.id=ak.routing_group_id AND rg.status='active'
        LEFT JOIN routing_group_accounts rga ON rga.routing_group_id=rg.id AND rga.status='active'
        LEFT JOIN upstream_accounts ua ON ua.id=rga.account_id AND ua.status='active'
        LEFT JOIN account_models am ON am.account_id=ua.id
        WHERE ak.user_id=$1 AND ak.status='active'
          AND (ak.expired_at IS NULL OR ak.expired_at>=CURRENT_TIMESTAMP)
        GROUP BY rg.id,rg.group_name,rg.protocol_type ORDER BY rg.id ASC`, [req.user.id]);
      return res.json({ data: rows.map(numberValues) });
    } catch (error) { return next(error); }
  });

  router.get('/keys', identity.authenticate, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT ak.id,ak.key_name,ak.key_prefix,ak.status,ak.created_at,ak.last_used_at,
        ak.routing_group_id,ak.permission_mode,rg.group_name,
        COUNT(permission.model_code) FILTER (WHERE permission.status='active') AS model_count
        FROM api_keys ak LEFT JOIN routing_groups rg ON rg.id=ak.routing_group_id
        LEFT JOIN api_key_permissions permission ON permission.api_key_id=ak.id
        WHERE ak.user_id=$1 AND ak.status!='revoked'
        GROUP BY ak.id,rg.group_name ORDER BY ak.created_at DESC,ak.id DESC`, [req.user.id]);
      return res.json({ data: rows.map(row => ({
        ...numberValues(row), key_prefix: identity.desensitizeKey(row.key_prefix),
        channel_name: row.group_name || null, channel_names: row.group_name ? [row.group_name] : [],
      })) });
    } catch (error) { return next(error); }
  });

  router.post('/keys', identity.authenticate, async (req, res, next) => {
    const keyName = String(req.body?.key_name || '未命名密钥');
    const routingGroupId = req.body?.routing_group_id ?? req.body?.channel_id;
    if (!routingGroupId) return res.status(400).json({ error: '请选择分组' });
    const rawKey = `sk-${String(idFactory()).replace(/-/g, '')}`;
    try {
      const keyHash = await identity.bcrypt.hash(rawKey, 10);
      const result = await withTransaction(pool, async client => {
        const group = await client.query(`SELECT id,group_name FROM routing_groups
          WHERE id=$1 AND status='active'`, [routingGroupId]);
        if (!group.rows[0]) {
          const error = new Error('分组无效');
          error.status = 400;
          throw error;
        }
        const keyPrefix = rawKey.slice(0, 12);
        const inserted = await client.query(`INSERT INTO api_keys
          (user_id,key_name,key_hash,key_prefix,key_envelope,routing_group_id,permission_mode,status)
          VALUES ($1,$2,$3,$4,NULL,$5,'group_dynamic','active') RETURNING id`,
        [req.user.id, keyName, keyHash, keyPrefix, routingGroupId]);
        const keyId = inserted.rows[0].id;
        const envelope = identity.sealApiKey(keyId, rawKey);
        await client.query('UPDATE api_keys SET key_envelope=$1 WHERE id=$2', [envelope, keyId]);
        await client.query(`INSERT INTO api_key_permissions (api_key_id,model_code,status)
          SELECT $1,model_code,'active' FROM routing_group_models
          WHERE routing_group_id=$2 AND status='active' ON CONFLICT (api_key_id,model_code) DO NOTHING`, [keyId, routingGroupId]);
        return { keyId, keyPrefix, group: group.rows[0] };
      });
      return res.status(201).json({ message: 'API Key 创建成功', key: {
        id: result.keyId, key_raw: rawKey, key_prefix: identity.desensitizeKey(result.keyPrefix),
        key_name: keyName, channel_name: result.group.group_name, routing_group_id: routingGroupId,
      } });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/keys/:id/export', identity.authenticate, async (req, res, next) => {
    try {
      const rawKey = await withTransaction(pool, async client => {
        const key = await client.query(`SELECT id,key_envelope FROM api_keys
          WHERE id=$1 AND user_id=$2 FOR UPDATE`, [req.params.id, req.user.id]);
        if (!key.rows[0]) {
          const error = new Error('API Key 不存在');
          error.status = 404;
          throw error;
        }
        if (!key.rows[0].key_envelope) {
          const error = new Error('此密钥已导出或创建于旧版本，不能再次恢复');
          error.status = 410;
          throw error;
        }
        const value = identity.openApiKey(key.rows[0].id, key.rows[0].key_envelope);
        return value;
      });
      return res.json({ key_raw: rawKey });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.delete('/keys/:id', identity.authenticate, async (req, res, next) => {
    try {
      const result = await pool.query(`UPDATE api_keys SET status='revoked' WHERE id=$1 AND user_id=$2
        RETURNING id`, [req.params.id, req.user.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'API Key 不存在' });
      return res.json({ message: 'API Key 已删除' });
    } catch (error) { return next(error); }
  });

  router.patch('/keys/:id/toggle', identity.authenticate, async (req, res, next) => {
    try {
      const current = await pool.query('SELECT status FROM api_keys WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'API Key 不存在' });
      const status = current.rows[0].status === 'active' ? 'disabled' : 'active';
      await pool.query('UPDATE api_keys SET status=$1 WHERE id=$2 AND user_id=$3', [status, req.params.id, req.user.id]);
      return res.json({ message: `API Key 已${status === 'active' ? '启用' : '禁用'}`, status });
    } catch (error) { return next(error); }
  });

  router.get('/logs', identity.authenticate, async (req, res, next) => {
    const page = positiveInteger(req.query.page, 1, 1_000_000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    if (!page || !limit) return res.status(400).json({ error: '页码或每页数量无效' });
    let filters;
    try { filters = buildLogFilters(req.user.id, req.query); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const offset = (page - 1) * limit;
      const pageValues = [...filters.values, limit, offset];
      const [rows, total] = await Promise.all([
        pool.query(`SELECT request_id,api_key_id,model_code,input_tokens,output_tokens,total_cost,status,
          error_type,error_message,latency_ms,billing_mode,billing_snapshot AS billing_detail,
          image_metadata->>'operation' AS image_operation,image_metadata->>'output_format' AS image_output_format,
          image_metadata->>'output_compression' AS image_output_compression,created_at
          FROM api_request_logs WHERE ${filters.conditions} ORDER BY created_at DESC,id DESC
          LIMIT $${filters.values.length + 1} OFFSET $${filters.values.length + 2}`, pageValues),
        pool.query(`SELECT COUNT(*) AS count FROM api_request_logs WHERE ${filters.conditions}`, filters.values),
      ]);
      return res.json({ data: rows.rows.map(numberValues), pagination: { page, limit, total: Number(total.rows[0]?.count || 0) } });
    } catch (error) { return next(error); }
  });

  router.get('/logs/export', identity.authenticate, async (req, res, next) => {
    let filters;
    try {
      filters = buildLogFilters(req.user.id, req.query, {
        requireDates: true,
        requiredDateMessage: '导出必须提供完整的开始和结束日期',
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      const exportLimit = 100_000;
      const { rows } = await pool.query(`SELECT request_id,model_code,billing_mode,input_tokens,output_tokens,
        output_items,total_cost,status,latency_ms,error_type,error_message,operation,final_size,output_format,created_at
        FROM api_request_logs WHERE ${filters.conditions}
        ORDER BY created_at DESC,id DESC LIMIT $${filters.values.length + 1}`, [...filters.values, exportLimit + 1]);
      const truncated = rows.length > exportLimit;
      const exportedRows = truncated ? rows.slice(0, exportLimit) : rows;
      const headers = ['请求 ID', '时间（北京时间）', '模型', '计费方式', '输入 Token', '输出 Token', '输出数量', '费用（点）', '状态', '延迟（毫秒）', '操作', '尺寸', '格式', '错误类型', '错误信息'];
      const lines = [headers.map(value => csvField(value)).join(',')];
      for (const row of exportedRows) {
        lines.push([
          csvField(row.request_id, true), csvField(formatCsvBeijingTime(row.created_at)), csvField(row.model_code, true),
          csvField(row.billing_mode, true), csvField(row.input_tokens), csvField(row.output_tokens), csvField(row.output_items),
          csvField(row.total_cost), csvField(row.status, true), csvField(row.latency_ms), csvField(row.operation, true),
          csvField(row.final_size, true), csvField(row.output_format, true), csvField(row.error_type, true),
          csvField(row.error_message, true),
        ].join(','));
      }
      const filename = `调用记录_${filters.startDate}_${filters.endDate}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="logs_${filters.startDate}_${filters.endDate}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      if (truncated) res.setHeader('X-Export-Truncated', 'true');
      return res.send(`\uFEFF${lines.join('\r\n')}`);
    } catch (error) { return next(error); }
  });

  router.get('/stats/daily', identity.authenticate, async (req, res, next) => {
    let filters;
    try { filters = buildLogFilters(req.user.id, req.query, { requireDates: true, requiredDateMessage: '每日统计必须提供完整的开始和结束日期' }); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const aggregateTable = req.query.key_id ? 'user_api_key_daily_usage' : 'user_daily_usage';
      const values = [req.user.id, filters.startDate, filters.endDate];
      const conditions = ['user_id=$1', 'usage_date>=$2::date', 'usage_date<=$3::date'];
      if (req.query.key_id) {
        values.push(String(req.query.key_id));
        conditions.push(`api_key_id=$${values.length}`);
      }
      if (req.query.model) {
        values.push(String(req.query.model));
        conditions.push(`model_code=$${values.length}`);
      }
      const { rows } = await pool.query(`SELECT usage_date AS date,
        COALESCE(SUM(success_count),0) AS calls,COALESCE(SUM(total_cost),0) AS cost,
        COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens
        FROM ${aggregateTable} WHERE ${conditions.join(' AND ')}
        GROUP BY usage_date ORDER BY usage_date ASC`, values);
      return res.json({ data: rows.map(numberValues) });
    } catch (error) { return next(error); }
  });

  router.get('/stats', identity.authenticate, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT
        COALESCE(SUM(request_count),0) AS total_calls,
        COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(total_cost),0) AS total_consumption,
        COALESCE(SUM(request_count) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_calls,
        COALESCE(SUM(total_cost) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_consumption,
        COALESCE((SELECT jsonb_agg(model_row ORDER BY cost DESC) FROM (
          SELECT model_code,SUM(request_count) AS calls,SUM(total_cost) AS cost
          FROM user_daily_usage WHERE user_id=$1 GROUP BY model_code) model_row),'[]'::jsonb) AS model_usage,
        COALESCE(SUM(success_count) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_success_calls,
        COALESCE(SUM(failed_count) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_failed_calls,
        COALESCE(SUM(blocked_count) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_blocked_calls
        FROM user_daily_usage WHERE user_id=$1`, [req.user.id]);
      const result = numberValues(rows[0] || {});
      if (!Array.isArray(result.today_status)) {
        result.today_status = [
          { status: 'success', count: Number(result.today_success_calls || 0) },
          { status: 'failed', count: Number(result.today_failed_calls || 0) },
          { status: 'blocked', count: Number(result.today_blocked_calls || 0) },
        ].filter(item => item.count > 0);
      }
      delete result.today_success_calls;
      delete result.today_failed_calls;
      delete result.today_blocked_calls;
      return res.json(result);
    } catch (error) { return next(error); }
  });

  router.put('/password', identity.authenticate, async (req, res, next) => {
    const oldPassword = String(req.body?.oldPassword ?? req.body?.old_password ?? '');
    const newPassword = String(req.body?.newPassword ?? req.body?.new_password ?? '');
    if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写旧密码和新密码' });
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
    try {
      const user = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
      if (!user.rows[0] || !(await identity.bcrypt.compare(oldPassword, user.rows[0].password_hash))) {
        return res.status(400).json({ error: '旧密码错误' });
      }
      await pool.query('UPDATE users SET password_hash=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2', [await identity.bcrypt.hash(newPassword, 10), req.user.id]);
      return res.json({ message: '密码修改成功' });
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { buildLogFilters, createPostgresUserRouter, parseDate, positiveInteger, walletPayload };
