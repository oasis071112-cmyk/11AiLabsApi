const { buildBillingDetailFromSnapshot } = require('../../utils/billing-detail');

function numberValues(row = {}) {
  const result = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) result[key] = Number(value);
  }
  return result;
}

function publicLog(row = {}) {
  const result = { ...row };
  for (const field of ['input_tokens', 'output_tokens', 'total_cost', 'latency_ms', 'image_count']) {
    if (row[field] !== null && row[field] !== undefined) result[field] = Number(row[field] || 0);
  }
  result.billing_detail = buildBillingDetailFromSnapshot(result);
  return result;
}

function pgLogFilters(userId, query) {
  const conditions = ['user_id=$1'];
  const values = [userId];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (query.status) add('status=?', query.status);
  if (query.model) add('model_code=?', query.model);
  if (query.startDate) add('created_at>=?::date', query.startDate);
  if (query.endDate) add("created_at<?::date + INTERVAL '1 day'", query.endDate);
  return { conditions: conditions.join(' AND '), values };
}

class PostgresDashboardRepository {
  constructor(pool) {
    if (!pool?.query) throw new Error('PostgresDashboardRepository pool is required');
    this.pool = pool;
  }

  async getUserDashboardSnapshot(userId) {
    const { rows } = await this.pool.query(`SELECT
      COALESCE((SELECT jsonb_build_object(
        'quota_balance',w.quota_balance,'gift_quota',w.gift_quota,
        'frozen_balance',w.frozen_balance,'total_spent',w.total_spent)
        FROM wallets w WHERE w.user_id=$1),'{}'::jsonb) AS wallet,
      COALESCE((SELECT jsonb_build_object(
        'total_calls',SUM(u.request_count),'input_tokens',SUM(u.input_tokens),
        'output_tokens',SUM(u.output_tokens),'total_consumption',SUM(u.total_cost),
        'today_calls',SUM(u.request_count) FILTER (WHERE u.usage_date=CURRENT_DATE),
        'today_consumption',SUM(u.total_cost) FILTER (WHERE u.usage_date=CURRENT_DATE),
        'model_usage',COALESCE((SELECT jsonb_agg(model_row ORDER BY cost DESC) FROM (
          SELECT model_code,SUM(request_count) AS calls,SUM(total_cost) AS cost
          FROM user_daily_usage WHERE user_id=$1 GROUP BY model_code) model_row),'[]'::jsonb),
        'today_status',jsonb_build_array(
          jsonb_build_object('status','success','count',COALESCE(SUM(u.success_count) FILTER (WHERE u.usage_date=CURRENT_DATE),0)),
          jsonb_build_object('status','failed','count',COALESCE(SUM(u.failed_count) FILTER (WHERE u.usage_date=CURRENT_DATE),0)),
          jsonb_build_object('status','blocked','count',COALESCE(SUM(u.blocked_count) FILTER (WHERE u.usage_date=CURRENT_DATE),0))))
        FROM user_daily_usage u WHERE u.user_id=$1),'{}'::jsonb) AS stats,
      COALESCE((SELECT jsonb_agg(day ORDER BY date) FROM (
        SELECT usage_date AS date,SUM(request_count) AS calls,SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,SUM(total_cost) AS cost
        FROM user_daily_usage WHERE user_id=$1 AND usage_date>=CURRENT_DATE-6
        GROUP BY usage_date) day),'[]'::jsonb) AS daily,
      COALESCE((SELECT jsonb_agg(key_row ORDER BY id DESC) FROM (
        SELECT id,key_name,key_prefix,status,created_at,last_used_at FROM api_keys
        WHERE user_id=$1 AND status!='revoked' ORDER BY id DESC LIMIT 10) key_row),'[]'::jsonb) AS keys,
      COALESCE((SELECT jsonb_agg(log_row ORDER BY created_at DESC) FROM (
        SELECT request_id,model_code,status,input_tokens,output_tokens,total_cost,latency_ms,created_at
        FROM api_request_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10) log_row),'[]'::jsonb) AS recent_logs,
      COALESCE((SELECT jsonb_agg(model_row ORDER BY sort_order,model_code) FROM (
        SELECT DISTINCT m.model_code,m.model_name,m.model_type,
          COALESCE((m.metadata->>'sort_order')::integer,0) AS sort_order,
          jsonb_agg(DISTINCT ua.protocol_type) AS protocol_types
        FROM api_keys ak
        JOIN routing_group_accounts rga ON rga.routing_group_id=ak.routing_group_id AND rga.status='active'
        JOIN routing_groups rg ON rg.id=ak.routing_group_id AND rg.status='active'
        JOIN upstream_accounts ua ON ua.id=rga.account_id AND ua.status='active'
        JOIN account_models am ON am.account_id=ua.id AND am.status='active'
        JOIN models m ON m.model_code=am.model_code AND m.status='active'
        LEFT JOIN api_key_permissions permission ON permission.api_key_id=ak.id
          AND permission.model_code=m.model_code AND permission.status='active'
        LEFT JOIN routing_group_models rgm ON rgm.routing_group_id=rg.id
          AND rgm.model_code=m.model_code AND rgm.status='active'
        WHERE ak.user_id=$1 AND ak.status='active'
          AND (ak.expired_at IS NULL OR ak.expired_at>=CURRENT_TIMESTAMP)
          AND (rg.restrict_models=FALSE OR rgm.model_code IS NOT NULL)
          AND (ak.permission_mode='group_dynamic' OR permission.api_key_id IS NOT NULL)
        GROUP BY m.model_code,m.model_name,m.model_type,m.metadata) model_row),'[]'::jsonb) AS models,
      EXISTS(SELECT 1 FROM api_keys WHERE user_id=$1 AND status='active'
        AND (expired_at IS NULL OR expired_at>=CURRENT_TIMESTAMP)) AS has_api_keys`, [userId]);
    return rows[0] || { wallet: {}, stats: {}, daily: [], keys: [], recent_logs: [], models: [], has_api_keys: false };
  }

  async getUserLogsOverview(userId, query) {
    const filters = pgLogFilters(userId, query);
    const offset = (query.page - 1) * query.limit;
    const pageValues = [...filters.values, query.limit, offset];
    const limitParam = `$${filters.values.length + 1}`;
    const offsetParam = `$${filters.values.length + 2}`;
      const [page, aggregate, daily, globalStats] = await Promise.all([
      this.pool.query(`SELECT request_id,model_code,status,latency_ms,input_tokens,output_tokens,
        total_cost,billing_mode,error_type,error_message,billing_snapshot AS billing_detail,
        image_metadata->>'operation' AS image_operation,
        COALESCE((image_metadata->>'image_count')::integer,output_items,0) AS image_count,
        image_metadata,protocol_metadata,metadata,created_at
        FROM api_request_logs WHERE ${filters.conditions}
        ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`, pageValues),
      this.pool.query(`SELECT COUNT(*) AS total,
        COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(total_cost),0) AS cost,
        COUNT(*) FILTER (WHERE status='success') AS success_calls,
        COUNT(*) FILTER (WHERE status='failed') AS failed_calls,
        COUNT(*) FILTER (WHERE status='blocked') AS blocked_calls
        FROM api_request_logs WHERE ${filters.conditions}`, filters.values),
      this.pool.query(`SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS date,
        COUNT(*) AS calls,COALESCE(SUM(total_cost),0) AS cost,
        COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens
        FROM api_request_logs WHERE ${filters.conditions} AND status='success'
        GROUP BY (created_at AT TIME ZONE 'Asia/Shanghai')::date ORDER BY date`, filters.values),
      this.pool.query(`SELECT
        COALESCE(SUM(request_count),0) AS total_calls,
        COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(total_cost),0) AS total_consumption,
        COALESCE(SUM(request_count) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_calls,
        COALESCE(SUM(total_cost) FILTER (WHERE usage_date=CURRENT_DATE),0) AS today_consumption,
        COALESCE((SELECT jsonb_agg(model_row ORDER BY cost DESC) FROM (
          SELECT model_code,SUM(request_count) AS calls,SUM(total_cost) AS cost
          FROM user_daily_usage WHERE user_id=$1 GROUP BY model_code) model_row),'[]'::jsonb) AS model_usage,
        jsonb_build_array(
          jsonb_build_object('status','success','count',COALESCE(SUM(success_count) FILTER (WHERE usage_date=CURRENT_DATE),0)),
          jsonb_build_object('status','failed','count',COALESCE(SUM(failed_count) FILTER (WHERE usage_date=CURRENT_DATE),0)),
          jsonb_build_object('status','blocked','count',COALESCE(SUM(blocked_count) FILTER (WHERE usage_date=CURRENT_DATE),0))) AS today_status
        FROM user_daily_usage WHERE user_id=$1`, [userId]),
    ]);
    const summary = numberValues(aggregate.rows[0] || {});
    return {
      data: page.rows.map(publicLog),
      summary: { ...summary, calls: summary.total || 0 },
      stats: numberValues(globalStats.rows[0] || {}),
      daily: daily.rows.map(numberValues),
      pagination: { page: query.page, limit: query.limit, total: summary.total || 0 },
    };
  }

  async getAdminDashboardSnapshot() {
    const { rows } = await this.pool.query(`SELECT
      COALESCE((SELECT SUM(request_count) FROM platform_daily_usage WHERE usage_date=CURRENT_DATE),0) AS today_calls,
      COALESCE((SELECT SUM(total_cost) FROM platform_daily_usage WHERE usage_date=CURRENT_DATE),0) AS today_consumption,
      COALESCE((SELECT SUM(failed_count) FROM platform_daily_usage WHERE usage_date=CURRENT_DATE),0) AS failed_calls,
      COALESCE((SELECT SUM(amount) FROM quota_orders WHERE status='granted' AND granted_at>=CURRENT_DATE),0) AS today_recharge,
      COALESCE((SELECT SUM(amount) FROM quota_orders WHERE status='granted'),0) AS total_revenue,
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users WHERE created_at>=CURRENT_DATE) AS new_users_today,
      (SELECT COUNT(*) FROM upstream_accounts WHERE status='active') AS active_accounts,
      COALESCE((SELECT jsonb_agg(day ORDER BY date) FROM (
        SELECT usage_date AS date,SUM(request_count) AS calls,SUM(success_count) AS success_calls,
          SUM(failed_count) AS failed_calls,SUM(total_cost) AS cost
        FROM platform_daily_usage WHERE usage_date>=CURRENT_DATE-6 GROUP BY usage_date) day),'[]'::jsonb) AS daily_trend,
      COALESCE((SELECT jsonb_agg(model_row ORDER BY calls DESC) FROM (
        SELECT model_code,SUM(request_count) AS calls,SUM(total_cost) AS cost
        FROM platform_daily_usage GROUP BY model_code ORDER BY calls DESC LIMIT 10) model_row),'[]'::jsonb) AS model_ranking`);
    const result = numberValues(rows[0] || {});
    return { ...result, active_channels: result.active_accounts || 0 };
  }
}

module.exports = { PostgresDashboardRepository };
