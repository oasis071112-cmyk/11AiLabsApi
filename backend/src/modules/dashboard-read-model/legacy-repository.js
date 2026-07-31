const { listModelsForApiKey, mergeAvailableModel } = require('../../utils/routing-group-models');

function isoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function legacyWhere(query, alias = '') {
  const column = name => `${alias}${name}`;
  const conditions = ['1=1'];
  const params = [];
  if (query.status) { conditions.push(`${column('status')}=?`); params.push(query.status); }
  if (query.model) { conditions.push(`${column('model_code')}=?`); params.push(query.model); }
  if (query.startDate) { conditions.push(`date(${column('created_at')})>=?`); params.push(query.startDate); }
  if (query.endDate) { conditions.push(`date(${column('created_at')})<=?`); params.push(query.endDate); }
  return { sql: conditions.join(' AND '), params };
}

class LegacyDashboardRepository {
  constructor(db, { clock = () => new Date() } = {}) {
    if (!db?.prepare) throw new Error('LegacyDashboardRepository database is required');
    this.db = db;
    this.clock = clock;
  }

  async getUserDashboardSnapshot(userId) {
    const today = isoDate(this.clock());
    const wallet = this.db.prepare(`SELECT
      COALESCE(quota_balance,recharge_balance,0) AS quota_balance,
      COALESCE(gift_quota,gift_balance,0) AS gift_quota,
      COALESCE(frozen_balance,0) AS frozen_balance,
      COALESCE(total_spent,0) AS total_spent
      FROM wallets WHERE user_id=?`).get(userId) || {};
    const totals = this.db.prepare(`SELECT COUNT(*) AS total_calls,
      COALESCE(SUM(CASE WHEN status='success' THEN total_cost ELSE 0 END),0) AS total_consumption,
      COALESCE(SUM(CASE WHEN status='success' THEN input_tokens ELSE 0 END),0) AS input_tokens,
      COALESCE(SUM(CASE WHEN status='success' THEN output_tokens ELSE 0 END),0) AS output_tokens
      FROM api_request_logs WHERE user_id=?`).get(userId) || {};
    const todaySummary = this.db.prepare(`SELECT COUNT(*) AS today_calls,
      COALESCE(SUM(CASE WHEN status='success' THEN total_cost ELSE 0 END),0) AS today_consumption
      FROM api_request_logs WHERE user_id=? AND date(created_at)=?`).get(userId, today) || {};
    const todayStatus = this.db.prepare(`SELECT status,COUNT(*) AS count FROM api_request_logs
      WHERE user_id=? AND date(created_at)=? GROUP BY status`).all(userId, today);
    const totalStatus = this.db.prepare(`SELECT status,COUNT(*) AS count FROM api_request_logs
      WHERE user_id=? GROUP BY status`).all(userId);
    const modelUsage = this.db.prepare(`SELECT model_code,COUNT(*) AS calls,
      COALESCE(SUM(total_cost),0) AS cost FROM api_request_logs
      WHERE user_id=? AND status='success' GROUP BY model_code ORDER BY cost DESC`).all(userId);
    const stats = { ...totals, ...todaySummary, today_status: todayStatus, total_status: totalStatus, model_usage: modelUsage };
    const daily = this.db.prepare(`SELECT date(created_at) AS date, COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(total_cost),0) AS cost
      FROM api_request_logs WHERE user_id=? AND date(created_at)>=date(?,'-6 day')
      GROUP BY date(created_at) ORDER BY date ASC`).all(userId, isoDate(this.clock()));
    const keys = this.db.prepare(`SELECT id,key_name,key_prefix,status,created_at,last_used_at
      FROM api_keys WHERE user_id=? AND status!='revoked' ORDER BY id DESC LIMIT 10`).all(userId);
    const recentLogs = this.db.prepare(`SELECT * FROM api_request_logs
      WHERE user_id=? ORDER BY created_at DESC LIMIT 10`).all(userId);
    const apiKeys = this.db.prepare(`SELECT id,routing_group_id,permission_mode FROM api_keys
      WHERE user_id=? AND status='active' AND (expired_at IS NULL OR datetime(expired_at)>=datetime('now'))`).all(userId);
    const catalog = new Map(this.db.prepare(`SELECT model_code,model_name,model_type,sort_order
      FROM models WHERE status='active'`).all().map(model => [model.model_code, model]));
    const visible = new Map();
    for (const apiKey of apiKeys) {
      for (const model of listModelsForApiKey(this.db, apiKey)) {
        visible.set(model.model_code, mergeAvailableModel(visible.get(model.model_code), model));
      }
    }
    const models = [...visible.values()].map(model => ({ ...catalog.get(model.model_code), ...model }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.model_code.localeCompare(b.model_code));
    return { wallet, stats, daily, keys, recent_logs: recentLogs, models, has_api_keys: apiKeys.length > 0 };
  }

  async getUserLogsOverview(userId, query) {
    const today = isoDate(this.clock());
    const where = legacyWhere(query, 'l.');
    const offset = (query.page - 1) * query.limit;
    const data = this.db.prepare(`SELECT l.* FROM api_request_logs l
      WHERE l.user_id=? AND ${where.sql}
      ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
      .all(userId, ...where.params, query.limit, offset);
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM api_request_logs l
      WHERE l.user_id=? AND ${where.sql}`).get(userId, ...where.params)?.count || 0;
    const summary = this.db.prepare(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(total_cost),0) AS cost,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_calls,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_calls,
      SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked_calls
      FROM api_request_logs l WHERE l.user_id=? AND ${where.sql}`)
      .get(userId, ...where.params) || {};
    const daily = this.db.prepare(`SELECT date(l.created_at,'+8 hours') AS date,COUNT(*) AS calls,
      COALESCE(SUM(l.total_cost),0) AS cost,COALESCE(SUM(l.input_tokens),0) AS input_tokens,
      COALESCE(SUM(l.output_tokens),0) AS output_tokens FROM api_request_logs l
      WHERE l.user_id=? AND ${where.sql} AND l.status='success'
      GROUP BY date(l.created_at,'+8 hours') ORDER BY date ASC`).all(userId, ...where.params);
    const totals = this.db.prepare(`SELECT COUNT(*) AS total_calls,
      COALESCE(SUM(CASE WHEN status='success' THEN total_cost ELSE 0 END),0) AS total_consumption,
      COALESCE(SUM(CASE WHEN status='success' THEN input_tokens ELSE 0 END),0) AS input_tokens,
      COALESCE(SUM(CASE WHEN status='success' THEN output_tokens ELSE 0 END),0) AS output_tokens
      FROM api_request_logs WHERE user_id=?`).get(userId) || {};
    const todaySummary = this.db.prepare(`SELECT COUNT(*) AS today_calls,
      COALESCE(SUM(CASE WHEN status='success' THEN total_cost ELSE 0 END),0) AS today_consumption
      FROM api_request_logs WHERE user_id=? AND date(created_at)=?`).get(userId, today) || {};
    const todayStatus = this.db.prepare(`SELECT status,COUNT(*) AS count FROM api_request_logs
      WHERE user_id=? AND date(created_at)=? GROUP BY status`).all(userId, today);
    const modelUsage = this.db.prepare(`SELECT model_code,COUNT(*) AS calls,
      COALESCE(SUM(total_cost),0) AS cost FROM api_request_logs WHERE user_id=? AND status='success'
      GROUP BY model_code ORDER BY cost DESC`).all(userId);
    const stats = { ...totals, ...todaySummary, today_status: todayStatus, model_usage: modelUsage };
    return { data, summary, stats, daily, pagination: { page: query.page, limit: query.limit, total } };
  }

  async getAdminDashboardSnapshot() {
    const today = isoDate(this.clock());
    const metrics = this.db.prepare(`SELECT COUNT(*) AS today_calls,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_calls,
      COALESCE(SUM(CASE WHEN status='success' THEN total_cost ELSE 0 END),0) AS today_consumption
      FROM api_request_logs WHERE date(created_at)=?`).get(today) || {};
    const counts = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users WHERE date(register_time)=?) AS new_users_today,
      (SELECT COUNT(*) FROM upstream_channels WHERE status='active') AS active_accounts,
      (SELECT COALESCE(SUM(amount),0) FROM quota_orders WHERE status='granted') AS total_revenue,
      (SELECT COALESCE(SUM(amount),0) FROM quota_orders WHERE status='granted' AND date(granted_at)=?) AS today_recharge`)
      .get(today, today) || {};
    const dailyTrend = this.db.prepare(`SELECT date(created_at) AS date, COUNT(*) AS calls,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_calls,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_calls,
      COALESCE(SUM(total_cost),0) AS cost
      FROM api_request_logs WHERE date(created_at)>=date(?,'-6 day')
      GROUP BY date(created_at) ORDER BY date ASC`).all(today);
    const modelRanking = this.db.prepare(`SELECT model_code,COUNT(*) AS calls,
      COALESCE(SUM(total_cost),0) AS cost FROM api_request_logs
      WHERE status='success' GROUP BY model_code ORDER BY calls DESC LIMIT 10`).all();
    return { ...metrics, ...counts, active_channels: counts.active_accounts, daily_trend: dailyTrend, model_ranking: modelRanking };
  }
}

module.exports = { LegacyDashboardRepository };
