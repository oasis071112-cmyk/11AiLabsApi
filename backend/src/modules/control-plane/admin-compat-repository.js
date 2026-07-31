const { randomUUID } = require('node:crypto');
const axios = require('axios');
const { withTransaction } = require('../../infrastructure/postgres');
const { ACCOUNT_CAPABILITIES, ACCOUNT_PROTOCOLS } = require('./index');
const { normalizeUpstreamModels, inferModelType } = require('../../utils/model-sync');
const { inferProvider } = require('../../utils/pricing-sync');

class AdminCompatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value).trim();
}

function optionalNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new AdminCompatError(400, 'invalid_number', '数值参数无效');
  return number;
}

function positiveInteger(value, fallback, field) {
  const number = optionalNumber(value, fallback);
  if (!Number.isInteger(number) || number < 0) throw new AdminCompatError(400, 'invalid_limit', `${field} 必须是非负整数`);
  return number;
}

function positiveWeight(value, fallback = 100) {
  const number = optionalNumber(value, fallback);
  if (!Number.isFinite(number) || number <= 0) throw new AdminCompatError(400, 'invalid_weight', '权重必须大于 0');
  return number;
}

function positiveMultiplier(value, fallback = 1) {
  const number = optionalNumber(value, fallback);
  if (!Number.isFinite(number) || number <= 0) {
    throw new AdminCompatError(400, 'invalid_multiplier', '计费倍率必须大于 0');
  }
  return number;
}

function status(value, fallback = 'active') {
  const result = text(value, fallback);
  if (!['active', 'inactive'].includes(result)) throw new AdminCompatError(400, 'invalid_status', '状态无效');
  return result;
}

function normalizedUrl(value) {
  const result = text(value);
  try {
    const parsed = new URL(result);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return result.replace(/\/+$/, '');
  } catch (_error) {
    throw new AdminCompatError(400, 'invalid_base_url', '上游地址必须是 HTTP(S) URL');
  }
}

function generatedKey(prefix, requested) {
  const candidate = text(requested).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return candidate || `${prefix}-${randomUUID()}`;
}

function publicChannel(row) {
  if (!row) return row;
  return {
    id: row.id,
    account_key: row.account_key,
    channel_name: row.display_name,
    display_name: row.display_name,
    base_url: row.base_url,
    protocol_type: row.protocol_type,
    capabilities: asArray(row.capabilities),
    status: row.status,
    max_concurrency: Number(row.max_concurrency),
    rpm_limit: Number(row.rpm_limit),
    tpm_limit: Number(row.tpm_limit),
    cooldown_seconds: Number(row.cooldown_seconds),
    priority: Number(row.priority),
    weight: Number(row.weight),
    health_score: Number(row.health_score),
    cooldown_until: row.cooldown_until,
    latency_ms: row.latency_ms,
    last_probe_at: row.last_probe_at,
    secret_configured: Boolean(row.secret_configured),
    group_names: asArray(row.group_names),
    model_count: Number(row.model_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicModel(row) {
  if (!row) return row;
  const metadata = asObject(row.metadata);
  return {
    ...metadata,
    id: row.model_code,
    model_code: row.model_code,
    model_name: row.model_name,
    provider: row.provider,
    model_type: row.model_type,
    status: row.status,
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicPaymentProvider(row) {
  if (!row) return row;
  const config = asObject(row.config);
  const { merchant_key, merchantKey, api_key, apiKey, secret, ...publicConfig } = config;
  return {
    ...publicConfig,
    id: row.id,
    provider_code: row.provider_code,
    provider_name: row.provider_name,
    provider_type: row.provider_type,
    status: row.status,
    secret_configured: Boolean(row.secret_configured),
    config: publicConfig,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicRoutingGroup(row) {
  const configuration = asObject(row.configuration);
  return {
    ...configuration,
    id: row.id,
    group_key: row.group_key,
    group_name: row.group_name,
    protocol_type: row.protocol_type,
    status: row.status,
    fallback_group_id: row.fallback_group_id,
    restrict_models: Boolean(row.restrict_models),
    billing_multiplier_input: Number(row.billing_multiplier_input ?? configuration.billing_multiplier_input ?? 1),
    billing_multiplier_output: Number(row.billing_multiplier_output ?? configuration.billing_multiplier_output ?? 1),
    billing_multiplier_image: Number(row.billing_multiplier_image ?? configuration.billing_multiplier_image ?? 1),
    configuration,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class PostgresAdminCompatRepository {
  constructor({ pool, secretBox, http = axios }) {
    if (!pool?.query || !pool?.connect) throw new Error('PostgresAdminCompatRepository pool is required');
    if (!secretBox?.seal || !secretBox.activeVersion) throw new Error('PostgresAdminCompatRepository secretBox is required');
    this.pool = pool;
    this.secretBox = secretBox;
    this.http = http;
  }

  async _transaction(action, actor, work) {
    return withTransaction(this.pool, async client => {
      const result = await work(client);
      const audit = result?.audit || {};
      await this._appendAudit(client, action, actor, audit);
      return result?.value;
    });
  }

  async _appendAudit(client, action, actor = {}, metadata = {}) {
    await client.query(`INSERT INTO audit_logs
      (audit_key,action,actor_staff_user_id,payload) VALUES ($1,$2,$3,$4::jsonb)`, [
      randomUUID(), action, actor.staffId ?? null,
      JSON.stringify({ actor_id: actor.id ?? null, actor_role: actor.role ?? null, ...metadata }),
    ]);
  }

  async _requireRow(client, query, values, error) {
    const { rows } = await client.query(query, values);
    if (!rows[0]) throw error;
    return rows[0];
  }

  async getDashboard() {
    const [recharge, today, users, channels, trend, ranking, revenue, totalUsers] = await Promise.all([
      this.pool.query("SELECT COALESCE(SUM(amount) FILTER (WHERE status='granted' AND granted_at>=CURRENT_DATE),0) AS total FROM quota_orders"),
      this.pool.query(`SELECT COALESCE(SUM(request_count),0) AS calls,
        COALESCE(SUM(success_count),0) AS success_calls,COALESCE(SUM(failed_count),0) AS failed_calls,
        COALESCE(SUM(blocked_count),0) AS blocked_calls,COALESCE(SUM(total_cost),0) AS cost
        FROM platform_daily_usage WHERE usage_date=CURRENT_DATE`),
      this.pool.query('SELECT COUNT(*) AS count FROM users WHERE created_at::date=CURRENT_DATE'),
      this.pool.query("SELECT COUNT(*) AS count FROM upstream_accounts WHERE status='active'"),
      this.pool.query(`SELECT usage_date AS date,SUM(request_count) AS calls,
        SUM(success_count) AS success_calls,SUM(failed_count) AS failed_calls,SUM(total_cost) AS cost
        FROM platform_daily_usage WHERE usage_date>=CURRENT_DATE-6
        GROUP BY usage_date ORDER BY usage_date ASC`),
      this.pool.query(`SELECT model_code,SUM(request_count) AS calls,COALESCE(SUM(total_cost),0) AS cost
        FROM platform_daily_usage GROUP BY model_code ORDER BY calls DESC LIMIT 10`),
      this.pool.query("SELECT COALESCE(SUM(amount) FILTER (WHERE status='granted'),0) AS total FROM quota_orders"),
      this.pool.query('SELECT COUNT(*) AS count FROM users'),
    ]);
    const todayRow = today.rows[0] || {};
    return {
      today_recharge: recharge.rows[0]?.total ?? 0,
      today_consumption: todayRow.cost ?? 0,
      new_users_today: Number(users.rows[0]?.count || 0),
      today_calls: Number(todayRow.calls || 0),
      success_calls: Number(todayRow.success_calls || 0),
      failed_calls: Number(todayRow.failed_calls || 0),
      blocked_calls: Number(todayRow.blocked_calls || 0),
      active_channels: Number(channels.rows[0]?.count || 0),
      daily_trend: trend.rows,
      model_ranking: ranking.rows,
      total_revenue: revenue.rows[0]?.total ?? 0,
      total_users: Number(totalUsers.rows[0]?.count || 0),
    };
  }

  async listUsers({ page, limit, status: requestedStatus, search }) {
    const values = [];
    const conditions = [];
    if (requestedStatus) { values.push(text(requestedStatus)); conditions.push(`u.status=$${values.length}`); }
    if (search) {
      values.push(`%${text(search)}%`);
      conditions.push(`(u.username ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const listValues = [...values, limit, offset];
    const [users, total] = await Promise.all([
      this.pool.query(`SELECT u.id,u.username,u.email,u.role,u.status,u.created_at AS register_time,u.updated_at AS last_login_time,
        COALESCE(w.quota_balance,0) AS quota_balance,COALESCE(w.gift_quota,0) AS gift_quota,w.frozen_balance,w.total_spent
        FROM users u LEFT JOIN wallets w ON w.user_id=u.id ${where} ORDER BY u.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, listValues),
      this.pool.query(`SELECT COUNT(*) AS count FROM users u ${where}`, values),
    ]);
    return {
      data: users.rows.map(row => ({ ...row, recharge_balance: row.quota_balance, gift_balance: row.gift_quota })),
      pagination: { page, limit, total: Number(total.rows[0]?.count || 0) },
    };
  }

  async getUser(userId) {
    const { rows } = await this.pool.query(`SELECT u.id,u.username,u.email,u.role,u.status,u.created_at AS register_time,u.updated_at,
      COALESCE(w.quota_balance,0) AS quota_balance,COALESCE(w.gift_quota,0) AS gift_quota,w.frozen_balance,w.total_spent
      FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=$1`, [userId]);
    const user = rows[0];
    if (!user) return null;
    const [keys, logs, transactions] = await Promise.all([
      this.pool.query(`SELECT id,user_id,key_name,key_prefix,status,created_at,last_used_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC`, [userId]),
      this.pool.query(`SELECT id,request_id,model_code,status,latency_ms,total_cost,created_at FROM api_request_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [userId]),
      this.pool.query(`SELECT id,transaction_key,transaction_type,amount,balance_after,metadata,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [userId]),
    ]);
    return {
      user: { ...user, recharge_balance: user.quota_balance, gift_balance: user.gift_quota },
      keys: keys.rows,
      recent_logs: logs.rows,
      recent_transactions: transactions.rows,
      pending_orders: [],
    };
  }

  async listKeys({ page, limit, userId }) {
    const values = [];
    const where = userId === undefined || userId === null || userId === '' ? '' : (values.push(userId), 'WHERE ak.user_id=$1');
    const [keys, total] = await Promise.all([
      this.pool.query(`SELECT ak.id,ak.user_id,ak.key_name,ak.key_prefix,ak.status,ak.created_at,ak.last_used_at,u.username,
        COALESCE(array_agg(akp.model_code) FILTER (WHERE akp.status='active'),'{}') AS permissions
        FROM api_keys ak JOIN users u ON u.id=ak.user_id LEFT JOIN api_key_permissions akp ON akp.api_key_id=ak.id
        ${where} GROUP BY ak.id,u.username ORDER BY ak.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]),
      this.pool.query(`SELECT COUNT(*) AS count FROM api_keys ak ${where}`, values),
    ]);
    return { data: keys.rows, pagination: { page, limit, total: Number(total.rows[0]?.count || 0) } };
  }

  async listLogs({ page, limit, userId, model, status: requestedStatus }) {
    const values = [];
    const conditions = [];
    if (userId) { values.push(userId); conditions.push(`arl.user_id=$${values.length}`); }
    if (model) { values.push(text(model)); conditions.push(`arl.model_code=$${values.length}`); }
    if (requestedStatus) { values.push(text(requestedStatus)); conditions.push(`arl.status=$${values.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [logs, total] = await Promise.all([
      this.pool.query(`SELECT arl.*,u.username FROM api_request_logs arl LEFT JOIN users u ON u.id=arl.user_id
        ${where} ORDER BY arl.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]),
      this.pool.query(`SELECT COUNT(*) AS count FROM api_request_logs arl ${where}`, values),
    ]);
    return { data: logs.rows, pagination: { page, limit, total: Number(total.rows[0]?.count || 0) } };
  }

  async listModels() {
    const { rows } = await this.pool.query(`SELECT model_code,model_name,provider,model_type,status,metadata,created_at,updated_at
      FROM models ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,model_code ASC`);
    return rows.map(publicModel);
  }

  async createModel(body, actor) {
    const modelCode = text(body.model_code);
    const modelName = text(body.model_name);
    const modelType = text(body.model_type, 'llm');
    const modelStatus = status(body.status, 'inactive');
    const metadata = { ...asObject(body.metadata), ...Object.fromEntries(Object.entries({
      upstream_model_name: body.upstream_model_name,
      context_length: body.context_length,
      is_multimodal: body.is_multimodal,
      description: body.description,
      sort_order: body.sort_order,
    }).filter(([, value]) => value !== undefined)) };
    return this._transaction('admin.model.create', actor, async client => {
      const row = await this._requireRow(client, `INSERT INTO models (model_code,model_name,provider,model_type,status,metadata)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING model_code,model_name,provider,model_type,status,metadata,created_at,updated_at`,
      [modelCode, modelName, text(body.provider), modelType, modelStatus, JSON.stringify(metadata)],
      new AdminCompatError(409, 'model_conflict', '模型编码已存在'));
      return { value: publicModel(row), audit: { target_type: 'model', target_id: modelCode } };
    });
  }

  async updateModel(modelCode, body, actor) {
    return this._transaction('admin.model.update', actor, async client => {
      const existing = await this._requireRow(client, `SELECT model_code,model_name,provider,model_type,status,metadata FROM models WHERE model_code=$1 FOR UPDATE`, [modelCode], new AdminCompatError(404, 'model_not_found', '模型不存在'));
      const metadata = body.metadata === undefined ? asObject(existing.metadata) : asObject(body.metadata);
      for (const key of ['upstream_model_name', 'context_length', 'is_multimodal', 'description', 'sort_order']) {
        if (body[key] !== undefined) metadata[key] = body[key];
      }
      const row = await this._requireRow(client, `UPDATE models SET model_name=$2,provider=$3,model_type=$4,status=$5,metadata=$6::jsonb,updated_at=CURRENT_TIMESTAMP
        WHERE model_code=$1 RETURNING model_code,model_name,provider,model_type,status,metadata,created_at,updated_at`, [
        modelCode, text(body.model_name, existing.model_name), text(body.provider, existing.provider), text(body.model_type, existing.model_type),
        body.status === undefined ? existing.status : status(body.status), JSON.stringify(metadata),
      ], new AdminCompatError(404, 'model_not_found', '模型不存在'));
      return { value: publicModel(row), audit: { target_type: 'model', target_id: modelCode } };
    });
  }

  async setModelStatus(modelCode, nextStatus, actor) {
    return this._transaction('admin.model.status', actor, async client => {
      const row = await this._requireRow(client, `UPDATE models SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE model_code=$1
        RETURNING model_code,model_name,provider,model_type,status,metadata,created_at,updated_at`, [modelCode, status(nextStatus)], new AdminCompatError(404, 'model_not_found', '模型不存在'));
      return { value: publicModel(row), audit: { target_type: 'model', target_id: modelCode, status: row.status } };
    });
  }

  async deleteModel(modelCode, actor) {
    return this._transaction('admin.model.delete', actor, async client => {
      const row = await this._requireRow(client, 'DELETE FROM models WHERE model_code=$1 RETURNING model_code', [modelCode], new AdminCompatError(404, 'model_not_found', '模型不存在'));
      return { value: true, audit: { target_type: 'model', target_id: row.model_code } };
    });
  }

  async listChannels() {
    const { rows } = await this.pool.query(`SELECT ua.id,ua.account_key,ua.display_name,ua.base_url,ua.protocol_type,ua.capabilities,ua.status,
      ua.max_concurrency,ua.rpm_limit,ua.tpm_limit,ua.cooldown_seconds,ua.priority,ua.weight,ua.health_score,ua.cooldown_until,
      ua.latency_ms,ua.last_probe_at,ua.created_at,ua.updated_at,(ua.api_key_envelope IS NOT NULL) AS secret_configured,
      COALESCE(array_agg(DISTINCT rg.group_name) FILTER (WHERE rg.id IS NOT NULL),'{}') AS group_names,
      COUNT(DISTINCT am.model_code) FILTER (WHERE am.status='active') AS model_count
      FROM upstream_accounts ua LEFT JOIN routing_group_accounts rga ON rga.account_id=ua.id
      LEFT JOIN routing_groups rg ON rg.id=rga.routing_group_id LEFT JOIN account_models am ON am.account_id=ua.id
      GROUP BY ua.id ORDER BY ua.priority ASC,ua.id ASC`);
    return rows.map(publicChannel);
  }

  async getChannelMonitoring(channelId, { limit = 50, windowHours = 24 } = {}) {
    const accountResult = await this.pool.query(`SELECT id,account_key,display_name,base_url,protocol_type,capabilities,status,
      max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight,health_score,cooldown_until,
      latency_ms,last_probe_at,created_at,updated_at,(api_key_envelope IS NOT NULL) AS secret_configured
      FROM upstream_accounts WHERE id=$1`, [channelId]);
    if (!accountResult.rows[0]) throw new AdminCompatError(404, 'channel_not_found', '渠道不存在');
    const [summaryResult, historyResult] = await Promise.all([
      this.pool.query(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='healthy') AS healthy,
        COUNT(*) FILTER (WHERE status='degraded') AS degraded,
        COUNT(*) FILTER (WHERE status='failed') AS failed,
        CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND(100.0*COUNT(*) FILTER (WHERE status='healthy')/COUNT(*),2) END AS availability_percent,
        ROUND(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL),2) AS average_latency_ms,
        percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p95_latency_ms,
        MAX(checked_at) AS last_checked_at
        FROM upstream_account_probes
        WHERE account_id=$1 AND checked_at>=CURRENT_TIMESTAMP-($2::int*INTERVAL '1 hour')`, [channelId, windowHours]),
      this.pool.query(`SELECT id,status,latency_ms,http_status,error_code,checked_at
        FROM upstream_account_probes WHERE account_id=$1 ORDER BY checked_at DESC,id DESC LIMIT $2`, [channelId, limit]),
    ]);
    const rawSummary = summaryResult.rows[0] || {};
    return {
      account: publicChannel(accountResult.rows[0]),
      window_hours: windowHours,
      summary: {
        total: Number(rawSummary.total || 0),
        healthy: Number(rawSummary.healthy || 0),
        degraded: Number(rawSummary.degraded || 0),
        failed: Number(rawSummary.failed || 0),
        availability_percent: rawSummary.availability_percent === null || rawSummary.availability_percent === undefined
          ? null : Number(rawSummary.availability_percent),
        average_latency_ms: rawSummary.average_latency_ms === null || rawSummary.average_latency_ms === undefined
          ? null : Number(rawSummary.average_latency_ms),
        p95_latency_ms: rawSummary.p95_latency_ms === null || rawSummary.p95_latency_ms === undefined
          ? null : Number(rawSummary.p95_latency_ms),
        last_checked_at: rawSummary.last_checked_at || null,
      },
      history: historyResult.rows.map(row => ({
        ...row,
        latency_ms: row.latency_ms === null ? null : Number(row.latency_ms),
        http_status: row.http_status === null ? null : Number(row.http_status),
      })),
    };
  }

  _accountPayload(body, existing = {}) {
    const displayName = text(body.channel_name ?? body.display_name, existing.display_name);
    if (!displayName) throw new AdminCompatError(400, 'invalid_channel', '渠道名称不能为空');
    const protocol = text(body.protocol_type, existing.protocol_type || 'openai_compatible');
    if (!ACCOUNT_PROTOCOLS.has(protocol)) {
      throw new AdminCompatError(400, 'invalid_protocol', 'Unsupported upstream protocol');
    }
    const capabilities = body.capabilities === undefined ? asArray(existing.capabilities) : asArray(body.capabilities);
    if (capabilities.some(capability => !ACCOUNT_CAPABILITIES.has(capability))) {
      throw new AdminCompatError(400, 'invalid_capability', 'Unsupported upstream capability');
    }
    return {
      displayName,
      baseUrl: body.base_url === undefined ? existing.base_url : normalizedUrl(body.base_url),
      protocol,
      capabilities: [...new Set(capabilities)],
      status: body.status === undefined ? (existing.status || 'active') : status(body.status),
      maxConcurrency: positiveInteger(body.max_concurrency, Number(existing.max_concurrency ?? 1), 'max_concurrency'),
      rpmLimit: positiveInteger(body.rpm_limit, Number(existing.rpm_limit ?? 60), 'rpm_limit'),
      tpmLimit: positiveInteger(body.tpm_limit, Number(existing.tpm_limit ?? 100000), 'tpm_limit'),
      cooldownSeconds: positiveInteger(body.cooldown_seconds, Number(existing.cooldown_seconds ?? 60), 'cooldown_seconds'),
      priority: optionalNumber(body.priority, Number(existing.priority ?? 0)),
      weight: positiveWeight(body.weight, Number(existing.weight ?? 100)),
    };
  }

  async createChannel(body, actor) {
    const accountKey = generatedKey('account', body.account_key || body.channel_name || body.display_name);
    const payload = this._accountPayload(body);
    const apiKey = text(body.api_key);
    if (!apiKey) throw new AdminCompatError(400, 'invalid_channel', 'API Key 不能为空');
    const envelope = this.secretBox.seal(apiKey, { aad: `upstream_accounts:${accountKey}` });
    return this._transaction('admin.channel.create', actor, async client => {
      const row = await this._requireRow(client, `INSERT INTO upstream_accounts
        (account_key,display_name,base_url,protocol_type,api_key_envelope,secret_version,capabilities,status,max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id,account_key,display_name,base_url,protocol_type,capabilities,status,max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight,health_score,cooldown_until,latency_ms,last_probe_at,created_at,updated_at,(api_key_envelope IS NOT NULL) AS secret_configured`, [
        accountKey, payload.displayName, payload.baseUrl, payload.protocol, envelope, this.secretBox.activeVersion,
        JSON.stringify(payload.capabilities), payload.status, payload.maxConcurrency, payload.rpmLimit, payload.tpmLimit,
        payload.cooldownSeconds, payload.priority, payload.weight,
      ], new AdminCompatError(409, 'channel_conflict', '渠道编码已存在'));
      return { value: publicChannel(row), audit: { target_type: 'upstream_account', target_id: row.id, account_key: accountKey } };
    });
  }

  async updateChannel(id, body, actor) {
    return this._transaction('admin.channel.update', actor, async client => {
      const existing = await this._requireRow(client, 'SELECT * FROM upstream_accounts WHERE id=$1 FOR UPDATE', [id], new AdminCompatError(404, 'channel_not_found', '渠道不存在'));
      const payload = this._accountPayload(body, existing);
      const apiKey = text(body.api_key);
      const envelope = apiKey ? this.secretBox.seal(apiKey, { aad: `upstream_accounts:${existing.account_key}` }) : existing.api_key_envelope;
      const version = apiKey ? this.secretBox.activeVersion : existing.secret_version;
      const row = await this._requireRow(client, `UPDATE upstream_accounts SET display_name=$2,base_url=$3,protocol_type=$4,api_key_envelope=$5,secret_version=$6,
        capabilities=$7::jsonb,status=$8,max_concurrency=$9,rpm_limit=$10,tpm_limit=$11,cooldown_seconds=$12,priority=$13,weight=$14,updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING id,account_key,display_name,base_url,protocol_type,capabilities,status,max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight,health_score,cooldown_until,latency_ms,last_probe_at,created_at,updated_at,(api_key_envelope IS NOT NULL) AS secret_configured`, [
        id, payload.displayName, payload.baseUrl, payload.protocol, envelope, version, JSON.stringify(payload.capabilities), payload.status,
        payload.maxConcurrency, payload.rpmLimit, payload.tpmLimit, payload.cooldownSeconds, payload.priority, payload.weight,
      ], new AdminCompatError(404, 'channel_not_found', '渠道不存在'));
      return { value: publicChannel(row), audit: { target_type: 'upstream_account', target_id: id, secret_rotated: Boolean(apiKey) } };
    });
  }

  async setChannelStatus(id, nextStatus, actor) {
    return this._transaction('admin.channel.status', actor, async client => {
      const row = await this._requireRow(client, `UPDATE upstream_accounts SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1
        RETURNING id,account_key,display_name,base_url,protocol_type,capabilities,status,max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight,health_score,cooldown_until,latency_ms,last_probe_at,created_at,updated_at,(api_key_envelope IS NOT NULL) AS secret_configured`, [id, status(nextStatus)], new AdminCompatError(404, 'channel_not_found', '渠道不存在'));
      return { value: publicChannel(row), audit: { target_type: 'upstream_account', target_id: id, status: row.status } };
    });
  }

  async deleteChannel(id, actor) {
    return this._transaction('admin.channel.delete', actor, async client => {
      const row = await this._requireRow(client, 'DELETE FROM upstream_accounts WHERE id=$1 RETURNING id,account_key', [id], new AdminCompatError(404, 'channel_not_found', '渠道不存在'));
      return { value: true, audit: { target_type: 'upstream_account', target_id: row.id, account_key: row.account_key } };
    });
  }

  async listChannelModels(channelId) {
    const { rows } = await this.pool.query(`SELECT account_id,model_code,upstream_model_name,supports_image_input,configuration,status
      FROM account_models WHERE account_id=$1 ORDER BY model_code ASC`, [channelId]);
    return rows.map(row => ({ ...row, ...asObject(row.configuration), configuration: asObject(row.configuration) }));
  }

  async replaceChannelModels(channelId, mappings, actor) {
    return this._transaction('admin.channel.models.replace', actor, async client => {
      await this._requireRow(client, 'SELECT id FROM upstream_accounts WHERE id=$1 FOR UPDATE', [channelId], new AdminCompatError(404, 'channel_not_found', '渠道不存在'));
      const normalized = mappings.map(item => {
        const source = asObject(item);
        const modelCode = text(source.model_code);
        if (!modelCode) throw new AdminCompatError(400, 'invalid_model_mapping', '模型映射缺少 model_code');
        return {
          modelCode,
          upstreamName: text(source.upstream_model_name, modelCode),
          imageInput: Boolean(source.supports_image_input),
          configuration: {
            ...Object.fromEntries([
              'billing_mode', 'billing_model_source', 'input_price', 'output_price',
              'cache_write_price', 'cache_read_price', 'image_input_price', 'image_output_price',
              'per_request_price', 'image_price_1k', 'image_price_2k', 'image_price_4k',
            ].filter(key => source[key] !== undefined).map(key => [key, source[key]])),
            ...asObject(source.configuration),
          },
          status: status(source.status, 'active'),
        };
      });
      await client.query('DELETE FROM account_models WHERE account_id=$1', [channelId]);
      for (const mapping of normalized) {
        await client.query(`INSERT INTO account_models (account_id,model_code,upstream_model_name,supports_image_input,configuration,status)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [channelId, mapping.modelCode, mapping.upstreamName, mapping.imageInput, JSON.stringify(mapping.configuration), mapping.status]);
      }
      return { value: normalized.map(mapping => ({ account_id: Number(channelId), model_code: mapping.modelCode, upstream_model_name: mapping.upstreamName, supports_image_input: mapping.imageInput, configuration: mapping.configuration, status: mapping.status })), audit: { target_type: 'upstream_account', target_id: channelId, model_codes: normalized.map(item => item.modelCode) } };
    });
  }

  async syncChannelModels(channelId, actor) {
    const accountResult = await this.pool.query(`SELECT id,account_key,base_url,protocol_type,api_key_envelope
      FROM upstream_accounts WHERE id=$1`, [channelId]);
    const account = accountResult.rows[0];
    if (!account) throw new AdminCompatError(404, 'channel_not_found', '渠道不存在');
    if (!this.secretBox?.open) throw new AdminCompatError(503, 'secret_unavailable', '上游凭证解密服务不可用');
    let credential;
    try {
      credential = this.secretBox.open(account.api_key_envelope, { aad: `upstream_accounts:${account.account_key}` });
    } catch (_error) {
      throw new AdminCompatError(503, 'secret_unavailable', '上游凭证无法解密');
    }
    const headers = account.protocol_type === 'anthropic'
      ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01', accept: 'application/json' }
      : { authorization: `Bearer ${credential}`, accept: 'application/json' };
    let payload;
    try {
      payload = (await this.http.get(`${String(account.base_url).replace(/\/+$/, '')}/models`, {
        headers,
        timeout: 20_000,
      })).data;
    } catch (error) {
      throw new AdminCompatError(502, 'upstream_model_sync_failed', `上游模型同步失败${error.response?.status ? `（HTTP ${error.response.status}）` : ''}`);
    }
    const modelCodes = normalizeUpstreamModels(payload);
    if (modelCodes.length === 0) throw new AdminCompatError(502, 'upstream_models_empty', '上游未返回任何模型');
    return this._transaction('admin.channel.models.sync', actor, async client => {
      let created = 0;
      let updated = 0;
      for (const modelCode of modelCodes) {
        const provider = inferProvider({ model_code: modelCode }) || 'manual';
        const inserted = await client.query(`INSERT INTO models
          (model_code,model_name,provider,model_type,status,metadata)
          VALUES ($1,$1,$2,$3,'inactive',$4::jsonb)
          ON CONFLICT (model_code) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING (xmax=0) AS inserted`, [
          modelCode, provider, inferModelType(modelCode), JSON.stringify({ official_model_id: modelCode }),
        ]);
        if (inserted.rows[0]?.inserted) created += 1; else updated += 1;
        await client.query(`INSERT INTO account_models
          (account_id,model_code,upstream_model_name,supports_image_input,configuration,status)
          VALUES ($1,$2,$2,FALSE,'{}'::jsonb,'inactive')
          ON CONFLICT (account_id,model_code) DO UPDATE SET upstream_model_name=EXCLUDED.upstream_model_name`, [channelId, modelCode]);
      }
      return {
        value: { message: `同步完成：新增 ${created}，更新 ${updated}`, created, updated, models: modelCodes },
        audit: { target_type: 'upstream_account', target_id: channelId, created, updated, model_codes: modelCodes },
      };
    });
  }

  async setChannelModelStatus(channelId, modelCode, nextStatus, actor) {
    return this._transaction('admin.channel_model.status', actor, async client => {
      const row = await this._requireRow(client, `UPDATE account_models SET status=$3 WHERE account_id=$1 AND model_code=$2
        RETURNING account_id,model_code,upstream_model_name,supports_image_input,configuration,status`, [channelId, modelCode, status(nextStatus)], new AdminCompatError(404, 'channel_model_not_found', '渠道模型映射不存在'));
      return { value: row, audit: { target_type: 'account_model', target_id: `${channelId}:${modelCode}`, status: row.status } };
    });
  }

  async listRoutingGroups() {
    const [groups, members, models] = await Promise.all([
      this.pool.query('SELECT id,group_key,group_name,protocol_type,status,configuration,fallback_group_id,restrict_models,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image,created_at,updated_at FROM routing_groups ORDER BY id ASC'),
      this.pool.query(`SELECT rga.routing_group_id,rga.account_id,rga.priority,rga.weight,rga.status,ua.display_name AS channel_name,ua.base_url,ua.status AS channel_status
        FROM routing_group_accounts rga JOIN upstream_accounts ua ON ua.id=rga.account_id ORDER BY rga.routing_group_id,rga.priority ASC,rga.account_id ASC`),
      this.pool.query('SELECT routing_group_id,model_code,status,billing_multiplier,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image FROM routing_group_models ORDER BY routing_group_id,model_code ASC'),
    ]);
    return groups.rows.map(group => ({
      ...publicRoutingGroup(group),
      channels: members.rows.filter(member => String(member.routing_group_id) === String(group.id))
        .map(member => ({ ...member, channel_id: member.account_id })),
      model_codes: models.rows.filter(model => String(model.routing_group_id) === String(group.id) && model.status === 'active').map(model => model.model_code),
      model_rules: models.rows.filter(model => String(model.routing_group_id) === String(group.id)),
    }));
  }

  _routingGroupPayload(body, existing = {}) {
    const groupName = text(body.group_name, existing.group_name);
    if (!groupName) throw new AdminCompatError(400, 'invalid_routing_group', '分组名称不能为空');
    const configuration = body.configuration === undefined ? asObject(existing.configuration) : asObject(body.configuration);
    if (body.description !== undefined) configuration.description = String(body.description);
    return {
      groupName,
      protocol: text(body.protocol_type, existing.protocol_type || 'openai_compatible'),
      status: body.status === undefined ? (existing.status || 'active') : status(body.status),
      configuration,
      fallbackGroupId: body.fallback_group_id === undefined ? (existing.fallback_group_id ?? null) : (body.fallback_group_id || null),
      restrictModels: body.restrict_models === undefined ? Boolean(existing.restrict_models) : Boolean(body.restrict_models),
      inputMultiplier: positiveMultiplier(body.billing_multiplier_input, existing.billing_multiplier_input ?? configuration.billing_multiplier_input ?? 1),
      outputMultiplier: positiveMultiplier(body.billing_multiplier_output, existing.billing_multiplier_output ?? configuration.billing_multiplier_output ?? 1),
      imageMultiplier: positiveMultiplier(body.billing_multiplier_image, existing.billing_multiplier_image ?? configuration.billing_multiplier_image ?? 1),
    };
  }

  async _replaceGroupMembers(client, groupId, members) {
    const normalized = asArray(members).map(item => {
      const member = asObject(item);
      const accountId = member.account_id ?? member.channel_id;
      if (accountId === undefined || accountId === null || accountId === '') throw new AdminCompatError(400, 'invalid_member', '分组成员缺少 account_id');
      return { accountId, priority: optionalNumber(member.priority, 0), weight: positiveWeight(member.weight), status: status(member.status, 'active') };
    });
    await client.query('DELETE FROM routing_group_accounts WHERE routing_group_id=$1', [groupId]);
    for (const member of normalized) {
      await client.query(`INSERT INTO routing_group_accounts (routing_group_id,account_id,priority,weight,status)
        VALUES ($1,$2,$3,$4,$5)`, [groupId, member.accountId, member.priority, member.weight, member.status]);
    }
    return normalized;
  }

  async _replaceGroupModels(client, groupId, rules) {
    const existingResult = await client.query(`SELECT routing_group_id,model_code,status,billing_multiplier,
      billing_multiplier_input,billing_multiplier_output,billing_multiplier_image
      FROM routing_group_models WHERE routing_group_id=$1`, [groupId]);
    const existingByModel = new Map(existingResult.rows.map(row => [String(row.model_code), row]));
    const optionalMultiplier = (value, fallback = null) => {
      const selected = value === undefined ? fallback : value;
      if (selected === null || selected === '') return null;
      return positiveMultiplier(selected);
    };
    const normalized = asArray(rules).map(item => {
      const rule = typeof item === 'string' ? { model_code: item } : asObject(item);
      const modelCode = text(rule.model_code);
      if (!modelCode) throw new AdminCompatError(400, 'invalid_model_rule', '分组模型规则缺少 model_code');
      const existing = existingByModel.get(modelCode) || {};
      return {
        modelCode,
        status: status(rule.status, existing.status || 'active'),
        multiplier: optionalMultiplier(rule.billing_multiplier, existing.billing_multiplier),
        inputMultiplier: optionalMultiplier(rule.billing_multiplier_input, existing.billing_multiplier_input),
        outputMultiplier: optionalMultiplier(rule.billing_multiplier_output, existing.billing_multiplier_output),
        imageMultiplier: optionalMultiplier(rule.billing_multiplier_image, existing.billing_multiplier_image),
      };
    });
    await client.query('DELETE FROM routing_group_models WHERE routing_group_id=$1', [groupId]);
    for (const rule of normalized) {
      await client.query(`INSERT INTO routing_group_models
        (routing_group_id,model_code,status,billing_multiplier,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        groupId, rule.modelCode, rule.status, rule.multiplier,
        rule.inputMultiplier, rule.outputMultiplier, rule.imageMultiplier,
      ]);
    }
    return normalized;
  }

  async createRoutingGroup(body, actor) {
    const groupKey = generatedKey('group', body.group_key || body.group_name);
    const payload = this._routingGroupPayload(body);
    return this._transaction('admin.routing_group.create', actor, async client => {
      const row = await this._requireRow(client, `INSERT INTO routing_groups
        (group_key,group_name,protocol_type,status,configuration,fallback_group_id,restrict_models,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING id,group_key,group_name,protocol_type,status,configuration,fallback_group_id,restrict_models,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image,created_at,updated_at`, [
        groupKey, payload.groupName, payload.protocol, payload.status, JSON.stringify(payload.configuration), payload.fallbackGroupId, payload.restrictModels,
        payload.inputMultiplier, payload.outputMultiplier, payload.imageMultiplier,
      ], new AdminCompatError(409, 'routing_group_conflict', '分组编码已存在'));
      const members = await this._replaceGroupMembers(client, row.id, body.members ?? body.channels ?? []);
      const rules = await this._replaceGroupModels(client, row.id, body.model_rules ?? body.model_codes ?? []);
      return { value: { ...publicRoutingGroup(row), channels: members, model_codes: rules.filter(rule => rule.status === 'active').map(rule => rule.modelCode), model_rules: rules }, audit: { target_type: 'routing_group', target_id: row.id, group_key: groupKey } };
    });
  }

  async updateRoutingGroup(id, body, actor) {
    return this._transaction('admin.routing_group.update', actor, async client => {
      const existing = await this._requireRow(client, 'SELECT * FROM routing_groups WHERE id=$1 FOR UPDATE', [id], new AdminCompatError(404, 'routing_group_not_found', '路由分组不存在'));
      const payload = this._routingGroupPayload(body, existing);
      if (String(payload.fallbackGroupId) === String(id)) throw new AdminCompatError(400, 'invalid_fallback', '备用分组不能指向自己');
      const row = await this._requireRow(client, `UPDATE routing_groups SET group_name=$2,protocol_type=$3,status=$4,configuration=$5::jsonb,
        fallback_group_id=$6,restrict_models=$7,billing_multiplier_input=$8,billing_multiplier_output=$9,billing_multiplier_image=$10,
        updated_at=CURRENT_TIMESTAMP WHERE id=$1
        RETURNING id,group_key,group_name,protocol_type,status,configuration,fallback_group_id,restrict_models,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image,created_at,updated_at`, [
        id, payload.groupName, payload.protocol, payload.status, JSON.stringify(payload.configuration), payload.fallbackGroupId, payload.restrictModels,
        payload.inputMultiplier, payload.outputMultiplier, payload.imageMultiplier,
      ], new AdminCompatError(404, 'routing_group_not_found', '路由分组不存在'));
      const members = body.members === undefined && body.channels === undefined
        ? await this._listRoutingGroupMembers(client, id)
        : await this._replaceGroupMembers(client, id, body.members ?? body.channels);
      const rules = body.model_rules === undefined && body.model_codes === undefined
        ? await this._listRoutingGroupModels(client, id)
        : await this._replaceGroupModels(client, id, body.model_rules ?? body.model_codes);
      return { value: { ...publicRoutingGroup(row), channels: members, model_codes: rules.filter(rule => rule.status === 'active').map(rule => rule.modelCode || rule.model_code), model_rules: rules }, audit: { target_type: 'routing_group', target_id: id } };
    });
  }

  async setRoutingGroupStatus(id, nextStatus, actor) {
    return this._transaction('admin.routing_group.status', actor, async client => {
      const row = await this._requireRow(client, `UPDATE routing_groups SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1
        RETURNING id,group_key,group_name,protocol_type,status,configuration,fallback_group_id,restrict_models,created_at,updated_at`, [id, status(nextStatus)], new AdminCompatError(404, 'routing_group_not_found', '路由分组不存在'));
      return { value: publicRoutingGroup(row), audit: { target_type: 'routing_group', target_id: id, status: row.status } };
    });
  }

  async deleteRoutingGroup(id, actor) {
    return this._transaction('admin.routing_group.delete', actor, async client => {
      const row = await this._requireRow(client, 'DELETE FROM routing_groups WHERE id=$1 RETURNING id,group_key', [id], new AdminCompatError(404, 'routing_group_not_found', '路由分组不存在'));
      return { value: true, audit: { target_type: 'routing_group', target_id: row.id, group_key: row.group_key } };
    });
  }

  async _listRoutingGroupMembers(queryable, id) {
    const { rows } = await queryable.query(`SELECT rga.routing_group_id,rga.account_id,rga.priority,rga.weight,rga.status,
      ua.display_name AS channel_name,ua.base_url,ua.status AS channel_status FROM routing_group_accounts rga
      JOIN upstream_accounts ua ON ua.id=rga.account_id WHERE rga.routing_group_id=$1 ORDER BY rga.priority ASC,rga.account_id ASC`, [id]);
    return rows;
  }

  async listRoutingGroupMembers(id) {
    return this._listRoutingGroupMembers(this.pool, id);
  }

  async replaceRoutingGroupMembers(id, members, actor) {
    return this._transaction('admin.routing_group.members.replace', actor, async client => {
      await this._requireRow(client, 'SELECT id FROM routing_groups WHERE id=$1 FOR UPDATE', [id], new AdminCompatError(404, 'routing_group_not_found', '路由分组不存在'));
      const result = await this._replaceGroupMembers(client, id, members);
      return { value: result.map(member => ({ routing_group_id: Number(id), account_id: member.accountId, priority: member.priority, weight: member.weight, status: member.status })), audit: { target_type: 'routing_group', target_id: id, account_ids: result.map(member => member.accountId) } };
    });
  }

  async _listRoutingGroupModels(queryable, id) {
    const { rows } = await queryable.query(`SELECT routing_group_id,model_code,status,billing_multiplier,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image
      FROM routing_group_models WHERE routing_group_id=$1 ORDER BY model_code ASC`, [id]);
    return rows;
  }

  async listRoutingGroupModels(id) {
    return this._listRoutingGroupModels(this.pool, id);
  }

  async replaceRoutingGroupModels(id, rules, actor) {
    return this._transaction('admin.routing_group.models.replace', actor, async client => {
      await this._requireRow(client, 'SELECT id FROM routing_groups WHERE id=$1 FOR UPDATE', [id], new AdminCompatError(404, 'routing_group_not_found', '路由分组不存在'));
      const result = await this._replaceGroupModels(client, id, rules);
      return { value: result.map(rule => ({
        routing_group_id: Number(id), model_code: rule.modelCode, status: rule.status,
        billing_multiplier: rule.multiplier,
        billing_multiplier_input: rule.inputMultiplier,
        billing_multiplier_output: rule.outputMultiplier,
        billing_multiplier_image: rule.imageMultiplier,
      })), audit: { target_type: 'routing_group', target_id: id, model_codes: result.map(rule => rule.modelCode) } };
    });
  }

  async listPaymentProviders() {
    const { rows } = await this.pool.query(`SELECT id,provider_code,provider_name,provider_type,config,status,created_at,updated_at,
      (secret_envelope IS NOT NULL) AS secret_configured FROM payment_providers ORDER BY id ASC`);
    return rows.map(publicPaymentProvider);
  }

  _paymentPayload(body, existing = {}) {
    const providerCode = text(body.provider_code, existing.provider_code);
    const providerName = text(body.provider_name, existing.provider_name);
    if (!providerCode || !providerName) throw new AdminCompatError(400, 'invalid_payment_provider', '服务商编码和名称不能为空');
    if (body.status === 'active' && body.enable !== true) throw new AdminCompatError(400, 'payment_enable_required', '启用支付必须明确传入 enable: true');
    const config = { ...asObject(existing.config), ...asObject(body.config) };
    for (const key of ['api_base_url', 'merchant_id', 'alipay_type', 'wechat_type', 'enabled_methods']) {
      if (body[key] !== undefined) config[key] = body[key];
    }
    let nextStatus = existing.status || 'disabled';
    if (body.enable === true) nextStatus = 'active';
    if (body.enable === false) nextStatus = 'disabled';
    if (body.status === 'inactive' || body.status === 'disabled') nextStatus = 'disabled';
    return { providerCode, providerName, providerType: text(body.provider_type, existing.provider_type || 'easypay'), config, status: nextStatus };
  }

  async createPaymentProvider(body, actor) {
    const payload = this._paymentPayload(body);
    const merchantKey = text(body.merchant_key);
    if (!merchantKey) throw new AdminCompatError(400, 'invalid_payment_provider', '商户密钥不能为空');
    const envelope = this.secretBox.seal(merchantKey, { aad: `payment_providers:${payload.providerCode}` });
    return this._transaction('admin.payment_provider.create', actor, async client => {
      const row = await this._requireRow(client, `INSERT INTO payment_providers
        (provider_code,provider_name,provider_type,config,secret_envelope,secret_version,status)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
        RETURNING id,provider_code,provider_name,provider_type,config,status,created_at,updated_at,(secret_envelope IS NOT NULL) AS secret_configured`, [
        payload.providerCode, payload.providerName, payload.providerType, JSON.stringify(payload.config), envelope, this.secretBox.activeVersion, payload.status,
      ], new AdminCompatError(409, 'payment_provider_conflict', '支付服务商编码已存在'));
      return { value: publicPaymentProvider(row), audit: { target_type: 'payment_provider', target_id: row.id, provider_code: payload.providerCode } };
    });
  }

  async updatePaymentProvider(id, body, actor) {
    return this._transaction('admin.payment_provider.update', actor, async client => {
      const existing = await this._requireRow(client, 'SELECT * FROM payment_providers WHERE id=$1 FOR UPDATE', [id], new AdminCompatError(404, 'payment_provider_not_found', '支付服务商不存在'));
      const payload = this._paymentPayload(body, existing);
      if (payload.providerCode !== existing.provider_code) throw new AdminCompatError(400, 'provider_code_immutable', '支付服务商编码不能修改');
      const merchantKey = text(body.merchant_key);
      const envelope = merchantKey ? this.secretBox.seal(merchantKey, { aad: `payment_providers:${payload.providerCode}` }) : existing.secret_envelope;
      const version = merchantKey ? this.secretBox.activeVersion : existing.secret_version;
      const row = await this._requireRow(client, `UPDATE payment_providers SET provider_name=$2,provider_type=$3,config=$4::jsonb,
        secret_envelope=$5,secret_version=$6,status=$7,updated_at=CURRENT_TIMESTAMP WHERE id=$1
        RETURNING id,provider_code,provider_name,provider_type,config,status,created_at,updated_at,(secret_envelope IS NOT NULL) AS secret_configured`, [
        id, payload.providerName, payload.providerType, JSON.stringify(payload.config), envelope, version, payload.status,
      ], new AdminCompatError(404, 'payment_provider_not_found', '支付服务商不存在'));
      return { value: publicPaymentProvider(row), audit: { target_type: 'payment_provider', target_id: id, status: row.status, secret_rotated: Boolean(merchantKey) } };
    });
  }

  async deletePaymentProvider(id, actor) {
    return this._transaction('admin.payment_provider.delete', actor, async client => {
      const row = await this._requireRow(client, 'DELETE FROM payment_providers WHERE id=$1 RETURNING id,provider_code', [id], new AdminCompatError(404, 'payment_provider_not_found', '支付服务商不存在'));
      return { value: true, audit: { target_type: 'payment_provider', target_id: row.id, provider_code: row.provider_code } };
    });
  }

  async listConfig() {
    const { rows } = await this.pool.query('SELECT config_key,config_value,description,updated_at FROM system_config ORDER BY config_key ASC');
    return rows;
  }

  async updateConfig(configKey, configValue, actor) {
    if (configKey === 'payment_enabled' && typeof configValue !== 'boolean') {
      throw new AdminCompatError(400, 'payment_enable_required', '支付总开关必须为布尔值');
    }
    return this._transaction('admin.system_config.update', actor, async client => {
      const row = await this._requireRow(client, `INSERT INTO system_config (config_key,config_value)
        VALUES ($1,$2::jsonb) ON CONFLICT (config_key) DO UPDATE SET config_value=EXCLUDED.config_value,updated_at=CURRENT_TIMESTAMP
        RETURNING config_key,config_value,description,updated_at`, [configKey, JSON.stringify(configValue)], new AdminCompatError(500, 'config_write_failed', '配置写入失败'));
      return { value: row, audit: { target_type: 'system_config', target_id: configKey } };
    });
  }
}

module.exports = { AdminCompatError, PostgresAdminCompatRepository, publicChannel, publicModel, publicPaymentProvider };
