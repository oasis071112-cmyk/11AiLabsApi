const express = require('express');
const { authenticate: defaultAuthenticate, requireAdmin: defaultRequireAdmin } = require('../middleware/auth');
const { PostgresAdminCompatRepository, AdminCompatError } = require('../modules/control-plane/admin-compat-repository');
const { PostgresPricingSyncService } = require('../modules/pricing-sync/postgres-service');

const VALID_STATUS = new Set(['active', 'inactive']);
const BOOLEAN_CONFIG_KEYS = new Set(['registration_enabled', 'new_user_gift_enabled', 'payment_enabled', 'maintenance_mode']);

function actorFromRequest(req) {
  return {
    id: req.user?.id ?? null,
    staffId: req.user?.staff_id ?? req.user?.staffUserId
      ?? (req.user?.role && req.user.role !== 'user' ? req.user.id : null),
    role: req.user?.role ?? null,
  };
}

function pagination(query, fallbackLimit) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || fallbackLimit));
  return { page, limit };
}

function boundedInteger(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new AdminCompatError(400, 'invalid_pagination', `参数必须是 1 到 ${maximum} 的整数`);
  }
  return parsed;
}

function requireStatus(value, label) {
  if (!VALID_STATUS.has(value)) throw new AdminCompatError(400, 'invalid_status', `${label}状态无效`);
  return value;
}

function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();
    const isFlag = normalized.endsWith('_configured') || normalized.endsWith('_present')
      || normalized === 'key_prefix' || normalized === 'key_name';
    const isSecret = /(^|_)(api_?key|merchant_?key|secret|credential|password|token)(_|$)/.test(normalized)
      || normalized.endsWith('_envelope') || normalized.endsWith('_ciphertext') || normalized === 'key_hash';
    if (isSecret && !isFlag) continue;
    result[key] = publicValue(child);
  }
  return result;
}

function sendError(res, error) {
  if (error instanceof AdminCompatError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error?.code === '23505') return res.status(409).json({ error: '记录已存在', code: 'conflict' });
  if (error?.code === '23503') return res.status(409).json({ error: '记录仍被关联数据使用', code: 'referenced_record' });
  throw error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(error => {
    try { sendError(res, error); } catch (unexpected) { next(unexpected); }
  });
}

function createPostgresAdminRouter({
  repository,
  pool,
  secretBox,
  authenticate = defaultAuthenticate,
  requireAdmin = defaultRequireAdmin,
  onMutation = null,
  pricingSyncService = null,
} = {}) {
  const data = repository || new PostgresAdminCompatRepository({ pool, secretBox });
  const pricingSync = pricingSyncService || (pool ? new PostgresPricingSyncService({ pool }) : null);
  const router = express.Router();
  const readers = [authenticate, requireAdmin('admin', 'operator', 'finance')];
  const operators = [authenticate, requireAdmin('admin', 'operator')];
  const admins = [authenticate, requireAdmin('admin')];
  const finance = [authenticate, requireAdmin('admin', 'finance')];
  router.use((req, res, next) => {
    if (typeof onMutation === 'function' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.once('finish', () => {
        if (res.statusCode < 400) Promise.resolve(onMutation()).catch(() => {});
      });
    }
    next();
  });

  router.get('/dashboard', ...readers, asyncRoute(async (_req, res) => {
    res.json(publicValue(await data.getDashboard()));
  }));
  router.get('/users', ...operators, asyncRoute(async (req, res) => {
    res.json(publicValue(await data.listUsers({ ...pagination(req.query, 20), status: req.query.status, search: req.query.search })));
  }));
  router.get('/users/:id', ...operators, asyncRoute(async (req, res) => {
    const user = await data.getUser(req.params.id);
    if (!user) throw new AdminCompatError(404, 'user_not_found', '用户不存在');
    res.json(publicValue(user));
  }));
  router.patch('/users/:id/status', ...admins, asyncRoute(async (req, res) => {
    const nextStatus = String(req.body?.status || '');
    if (!['active', 'disabled'].includes(nextStatus)) throw new AdminCompatError(400, 'invalid_status', '用户状态无效');
    res.json({ message: '用户状态已更新', data: publicValue(await data.setUserStatus(req.params.id, nextStatus, actorFromRequest(req))) });
  }));
  router.post('/users/:id/adjust-balance', ...finance, asyncRoute(async (req, res) => {
    res.json({ message: '调账成功', data: publicValue(await data.adjustUserBalance(req.params.id, req.body || {}, actorFromRequest(req))) });
  }));
  router.get(['/recharge-orders', '/quota-orders'], ...readers, asyncRoute(async (req, res) => {
    res.json(publicValue(await data.listRechargeOrders({ ...pagination(req.query, 20), status: req.query.status })));
  }));
  router.patch(['/recharge-orders/:id/confirm', '/quota-orders/:id/grant'], ...finance, asyncRoute(async (req, res) => {
    res.json({ message: '订单已确认并发放', data: publicValue(await data.confirmRechargeOrder(req.params.id, req.body || {}, actorFromRequest(req))) });
  }));
  router.patch(['/recharge-orders/:id/reject', '/quota-orders/:id/reject'], ...finance, asyncRoute(async (req, res) => {
    res.json({ message: '订单已驳回', data: publicValue(await data.rejectRechargeOrder(req.params.id, req.body || {}, actorFromRequest(req))) });
  }));
  router.get('/keys', ...operators, asyncRoute(async (req, res) => {
    res.json(publicValue(await data.listKeys({ ...pagination(req.query, 20), userId: req.query.user_id, groupBy: req.query.group_by })));
  }));
  router.patch('/keys/:id/status', ...admins, asyncRoute(async (req, res) => {
    const nextStatus = String(req.body?.status || '');
    if (!['active', 'disabled', 'revoked'].includes(nextStatus)) throw new AdminCompatError(400, 'invalid_status', 'Key 状态无效');
    res.json({ message: 'Key 状态已更新', data: publicValue(await data.setKeyStatus(req.params.id, nextStatus, actorFromRequest(req))) });
  }));
  router.put('/keys/:id/permissions', ...admins, asyncRoute(async (req, res) => {
    if (!Array.isArray(req.body?.model_codes)) throw new AdminCompatError(400, 'invalid_permissions', '模型权限必须是数组');
    res.json({ message: 'Key 权限已更新', data: publicValue(await data.updateKeyPermissions(req.params.id, req.body.model_codes, actorFromRequest(req))) });
  }));
  router.get('/logs', ...operators, asyncRoute(async (req, res) => {
    res.json(publicValue(await data.listLogs({
      ...pagination(req.query, 50),
      userId: req.query.user_id,
      model: req.query.model,
      status: req.query.status,
      startAt: req.query.start_at,
      endAt: req.query.end_at,
      query: req.query.q,
      channel: req.query.channel,
      channelExact: req.query.channel_exact,
      billingMode: req.query.billing_mode,
      dimension: req.query.dimension || 'model',
      bucket: req.query.bucket || 'day',
      includeSummary: req.query.include_summary !== 'false',
      rankingSortBy: req.query.ranking_sort_by || 'calls',
      rankingSortOrder: req.query.ranking_sort_order || 'desc',
    })));
  }));
  router.get('/logs/:id', ...operators, asyncRoute(async (req, res) => {
    if (!req.query.created_at) throw new AdminCompatError(400, 'missing_log_created_at', '缺少调用日志创建时间');
    const detail = await data.getLogDetail(req.params.id, req.query.created_at);
    if (!detail) throw new AdminCompatError(404, 'log_not_found', '调用日志不存在');
    res.json({ data: publicValue(detail) });
  }));

  router.get('/models', ...operators, asyncRoute(async (_req, res) => res.json({ data: publicValue(await data.listModels()) })));
  router.get('/pricing-sync/status', ...operators, asyncRoute(async (_req, res) => {
    if (!pricingSync) throw new AdminCompatError(503, 'pricing_sync_unavailable', '价格同步服务未就绪');
    res.json(publicValue(await pricingSync.status()));
  }));
  router.post('/pricing-sync', ...admins, asyncRoute(async (_req, res) => {
    if (!pricingSync) throw new AdminCompatError(503, 'pricing_sync_unavailable', '价格同步服务未就绪');
    res.json(publicValue(await pricingSync.syncAll()));
  }));
  router.get('/pricing-rules', ...operators, asyncRoute(async (_req, res) => res.json({ data: publicValue(await data.listPricingRules()) })));
  router.post('/pricing-rules', ...operators, asyncRoute(async (req, res) => {
    res.status(201).json({ message: '定价规则已创建', data: publicValue(await data.createPricingRule(req.body || {}, actorFromRequest(req))) });
  }));
  router.put('/pricing-rules/:id', ...operators, asyncRoute(async (req, res) => {
    res.json({ message: '定价规则已更新', data: publicValue(await data.updatePricingRule(req.params.id, req.body || {}, actorFromRequest(req))) });
  }));
  router.delete('/pricing-rules/:id', ...admins, asyncRoute(async (req, res) => {
    await data.deletePricingRule(req.params.id, actorFromRequest(req));
    res.json({ message: '定价规则已删除' });
  }));
  router.post('/models', ...admins, asyncRoute(async (req, res) => {
    if (!String(req.body?.model_code || '').trim() || !String(req.body?.model_name || '').trim()) {
      throw new AdminCompatError(400, 'invalid_model', '模型编码和名称不能为空');
    }
    const created = await data.createModel(req.body, actorFromRequest(req));
    res.status(201).json({ message: '模型创建成功', data: publicValue(created) });
  }));
  router.put('/models/:modelCode', ...admins, asyncRoute(async (req, res) => {
    res.json({ message: '模型已更新', data: publicValue(await data.updateModel(req.params.modelCode, req.body || {}, actorFromRequest(req))) });
  }));
  router.patch('/models/:modelCode/status', ...operators, asyncRoute(async (req, res) => {
    const status = requireStatus(req.body?.status, '模型');
    res.json({ message: '模型状态已更新', data: publicValue(await data.setModelStatus(req.params.modelCode, status, actorFromRequest(req))) });
  }));
  router.delete('/models/:modelCode', ...admins, asyncRoute(async (req, res) => {
    await data.deleteModel(req.params.modelCode, actorFromRequest(req));
    res.json({ message: '模型已删除' });
  }));

  router.get(['/channels', '/accounts'], ...operators, asyncRoute(async (_req, res) => res.json({ data: publicValue(await data.listChannels()) })));
  router.get(['/channels/:id/monitor', '/accounts/:id/monitor'], ...operators, asyncRoute(async (req, res) => {
    const limit = boundedInteger(req.query.limit, 50, 200);
    const windowHours = boundedInteger(req.query.window_hours, 24, 24 * 30);
    res.json(publicValue(await data.getChannelMonitoring(req.params.id, { limit, windowHours })));
  }));
  router.post(['/channels', '/accounts'], ...admins, asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!String(body.channel_name || body.display_name || '').trim() || !String(body.base_url || '').trim() || !String(body.api_key || '').trim()) {
      throw new AdminCompatError(400, 'invalid_channel', '渠道名称、上游地址和 API Key 不能为空');
    }
    const created = await data.createChannel(body, actorFromRequest(req));
    res.status(201).json({ message: '渠道创建成功', data: publicValue(created) });
  }));
  router.put(['/channels/:id', '/accounts/:id'], ...admins, asyncRoute(async (req, res) => {
    const updated = await data.updateChannel(req.params.id, req.body || {}, actorFromRequest(req));
    res.json({ message: '渠道已更新', data: publicValue(updated) });
  }));
  router.patch(['/channels/:id/status', '/accounts/:id/status'], ...admins, asyncRoute(async (req, res) => {
    const status = requireStatus(req.body?.status, '渠道');
    res.json({ message: '渠道状态已更新', data: publicValue(await data.setChannelStatus(req.params.id, status, actorFromRequest(req))) });
  }));
  router.delete(['/channels/:id', '/accounts/:id'], ...admins, asyncRoute(async (req, res) => {
    await data.deleteChannel(req.params.id, actorFromRequest(req));
    res.json({ message: '渠道已删除' });
  }));
  router.get(['/channels/:id/models', '/accounts/:id/models'], ...admins, asyncRoute(async (req, res) => {
    const [models, mappings] = await Promise.all([data.listModels(), data.listChannelModels(req.params.id)]);
    res.json({ data: publicValue(models), mappings: publicValue(mappings) });
  }));
  router.put(['/channels/:id/models', '/accounts/:id/models'], ...admins, asyncRoute(async (req, res) => {
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : req.body?.models;
    if (!Array.isArray(mappings)) throw new AdminCompatError(400, 'invalid_mappings', '渠道模型映射必须是数组');
    res.json({ message: '渠道模型映射已更新', data: publicValue(await data.replaceChannelModels(req.params.id, mappings, actorFromRequest(req))) });
  }));
  router.patch(['/channels/:id/models/:modelCode/status', '/accounts/:id/models/:modelCode/status'], ...operators, asyncRoute(async (req, res) => {
    const status = requireStatus(req.body?.status, '渠道模型');
    res.json({ message: '渠道模型状态已更新', data: publicValue(await data.setChannelModelStatus(req.params.id, req.params.modelCode, status, actorFromRequest(req))) });
  }));
  router.post(['/channels/:id/sync-models', '/accounts/:id/sync-models'], ...admins, asyncRoute(async (req, res) => {
    res.json(publicValue(await data.syncChannelModels(req.params.id, actorFromRequest(req))));
  }));

  router.get('/routing-groups', ...operators, asyncRoute(async (_req, res) => res.json({ data: publicValue(await data.listRoutingGroups()) })));
  router.post('/routing-groups', ...admins, asyncRoute(async (req, res) => {
    if (!String(req.body?.group_name || '').trim()) throw new AdminCompatError(400, 'invalid_routing_group', '分组名称不能为空');
    const created = await data.createRoutingGroup(req.body, actorFromRequest(req));
    res.status(201).json({ message: '路由分组创建成功', data: publicValue(created) });
  }));
  router.put('/routing-groups/:id', ...admins, asyncRoute(async (req, res) => {
    res.json({ message: '路由分组已更新', data: publicValue(await data.updateRoutingGroup(req.params.id, req.body || {}, actorFromRequest(req))) });
  }));
  router.patch('/routing-groups/:id/status', ...admins, asyncRoute(async (req, res) => {
    const status = requireStatus(req.body?.status, '分组');
    res.json({ message: '分组状态已更新', data: publicValue(await data.setRoutingGroupStatus(req.params.id, status, actorFromRequest(req))) });
  }));
  router.delete('/routing-groups/:id', ...admins, asyncRoute(async (req, res) => {
    await data.deleteRoutingGroup(req.params.id, actorFromRequest(req));
    res.json({ message: '路由分组已删除' });
  }));
  router.get('/routing-groups/:id/members', ...operators, asyncRoute(async (req, res) => {
    res.json({ data: publicValue(await data.listRoutingGroupMembers(req.params.id)) });
  }));
  router.put('/routing-groups/:id/members', ...admins, asyncRoute(async (req, res) => {
    if (!Array.isArray(req.body?.members)) throw new AdminCompatError(400, 'invalid_members', '分组成员必须是数组');
    res.json({ message: '分组成员已更新', data: publicValue(await data.replaceRoutingGroupMembers(req.params.id, req.body.members, actorFromRequest(req))) });
  }));
  router.get('/routing-groups/:id/models', ...operators, asyncRoute(async (req, res) => {
    res.json({ data: publicValue(await data.listRoutingGroupModels(req.params.id)) });
  }));
  router.put('/routing-groups/:id/models', ...admins, asyncRoute(async (req, res) => {
    const modelCodes = req.body?.model_codes;
    if (!Array.isArray(modelCodes)) throw new AdminCompatError(400, 'invalid_model_rules', '分组模型规则必须是数组');
    res.json({ message: '分组模型规则已更新', data: publicValue(await data.replaceRoutingGroupModels(req.params.id, modelCodes, actorFromRequest(req))) });
  }));

  router.get('/payment/providers', ...admins, asyncRoute(async (_req, res) => res.json({ data: publicValue(await data.listPaymentProviders()) })));
  router.post('/payment/providers', ...admins, asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!String(body.provider_name || '').trim() || !String(body.merchant_key || '').trim()) {
      throw new AdminCompatError(400, 'invalid_payment_provider', '服务商名称和商户密钥不能为空');
    }
    if (body.status === 'active' && body.enable !== true) {
      throw new AdminCompatError(400, 'payment_enable_required', '启用支付必须明确传入 enable: true');
    }
    const created = await data.createPaymentProvider(body, actorFromRequest(req));
    res.status(201).json({ message: '支付服务商已保存', data: publicValue(created) });
  }));
  router.put('/payment/providers/:id', ...admins, asyncRoute(async (req, res) => {
    if (req.body?.status === 'active' && req.body.enable !== true) {
      throw new AdminCompatError(400, 'payment_enable_required', '启用支付必须明确传入 enable: true');
    }
    res.json({ message: '支付服务商已更新', data: publicValue(await data.updatePaymentProvider(req.params.id, req.body || {}, actorFromRequest(req))) });
  }));
  router.delete('/payment/providers/:id', ...admins, asyncRoute(async (req, res) => {
    await data.deletePaymentProvider(req.params.id, actorFromRequest(req));
    res.json({ message: '支付服务商已删除' });
  }));
  router.get('/config', ...admins, asyncRoute(async (_req, res) => res.json({ data: publicValue(await data.listConfig()) })));
  router.put('/config/:key', ...admins, asyncRoute(async (req, res) => {
    let value;
    if (req.params.key === 'payment_enabled') {
      if (typeof req.body?.enable !== 'boolean') throw new AdminCompatError(400, 'payment_enable_required', '支付总开关必须明确传入 enable 布尔值');
      value = req.body.enable;
    } else {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'config_value')) {
        throw new AdminCompatError(400, 'invalid_config', '缺少 config_value');
      }
      value = req.body.config_value;
      if (BOOLEAN_CONFIG_KEYS.has(req.params.key)) {
        if (value === 'true') value = true;
        if (value === 'false') value = false;
        if (typeof value !== 'boolean') throw new AdminCompatError(400, 'invalid_config', '开关配置必须是布尔值');
      }
    }
    res.json({ message: '配置已更新', data: publicValue(await data.updateConfig(req.params.key, value, actorFromRequest(req))) });
  }));

  return router;
}

module.exports = { createPostgresAdminRouter, publicValue };
