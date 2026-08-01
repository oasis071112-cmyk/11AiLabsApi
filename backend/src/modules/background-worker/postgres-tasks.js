const axios = require('axios');
const { withTransaction } = require('../../infrastructure/postgres');
const { extendRedisCooldown } = require('../gateway-scheduler');
const { PostgresPricingSyncService } = require('../pricing-sync/postgres-service');

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const AGGREGATE_WATERMARK_KEY = 'worker_daily_aggregate_watermark';

function validateRetentionDays(value, { minimum = 30, maximum = 365 } = {}) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < minimum || days > maximum) {
    throw new Error(`request log retention must be an integer between ${minimum} and ${maximum} days`);
  }
  return days;
}

function dateInBeijing(value) {
  return new Date(value.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function nextDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function partitionMonths(clock, horizonMonths) {
  const months = [];
  for (let offset = 0; offset <= horizonMonths; offset += 1) {
    const month = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + offset, 1));
    months.push(month.toISOString().slice(0, 10));
  }
  return months;
}

function accountHeaders(account, apiKey) {
  if (account.protocol_type === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', Accept: 'application/json' };
  }
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

function probeUrl(account) {
  const base = String(account.base_url || '').replace(/\/+$/, '');
  return `${base}/models`;
}

async function probeAccounts({
  pool, secretBox, http, redis, logger, clock, probeConcurrency = 5, redisKeyPrefix = 'ionailabs',
}) {
  const { rows: accounts } = await pool.query(`SELECT id,account_key,base_url,protocol_type,
    api_key_envelope,health_score,cooldown_seconds FROM upstream_accounts WHERE status='active'`);
  const probeAccount = async account => {
    const startedAt = Date.now();
    let ok = false;
    let httpStatus = null;
    let errorCode = null;
    try {
      const apiKey = secretBox.open(account.api_key_envelope, { aad: `upstream_accounts:${account.account_key}` });
      const response = await http.get(probeUrl(account), {
        headers: accountHeaders(account, apiKey),
        timeout: 8_000,
        validateStatus: status => status < 500,
      });
      httpStatus = Number(response.status) || null;
      ok = httpStatus >= 200 && httpStatus < 400;
      if (!ok) errorCode = `http_${httpStatus || 'unknown'}`;
    } catch (error) {
      ok = false;
      httpStatus = Number(error?.response?.status) || null;
      errorCode = String(error?.code || (httpStatus ? `http_${httpStatus}` : 'probe_error')).slice(0, 120);
    }
    const latencyMs = Date.now() - startedAt;
    if (ok) {
      await pool.query(`UPDATE upstream_accounts SET health_score=LEAST(100,health_score+5),
        cooldown_until=CASE WHEN cooldown_until IS NOT NULL AND cooldown_until<=$2 THEN NULL ELSE cooldown_until END,
        last_probe_at=$2,latency_ms=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [
        account.id, clock(), latencyMs,
      ]);
      await pool.query(`INSERT INTO upstream_account_probes
        (account_id,status,latency_ms,http_status,error_code) VALUES ($1,$2,$3,$4,$5)`, [
        account.id, 'healthy', latencyMs, httpStatus, null,
      ]);
      return { accountId: account.id, ok, latencyMs };
    }
    const cooldownMs = Math.max(1, Number(account.cooldown_seconds || 60)) * 1000;
    const cooldownUntil = new Date(clock().getTime() + cooldownMs);
    await pool.query(`UPDATE upstream_accounts SET health_score=GREATEST(0,health_score-15),
      cooldown_until=GREATEST(COALESCE(cooldown_until,'-infinity'::timestamptz),$2),
      last_probe_at=$3,latency_ms=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [
      account.id, cooldownUntil, clock(), latencyMs,
    ]);
    if (redis) {
      try {
        await extendRedisCooldown(redis, {
          accountId: account.id,
          cooldownMs,
          metadata: { reason: 'probe_failed', cooldownUntil: cooldownUntil.toISOString() },
          redisKeyPrefix,
        });
      }
      catch (error) { logger.warn?.(`[worker:account-monitor] Redis cooldown unavailable: ${error.message}`); }
    }
    const probeStatus = [429, 503].includes(httpStatus) ? 'degraded' : 'failed';
    await pool.query(`INSERT INTO upstream_account_probes
      (account_id,status,latency_ms,http_status,error_code) VALUES ($1,$2,$3,$4,$5)`, [
      account.id, probeStatus, latencyMs, httpStatus, errorCode,
    ]);
    return { accountId: account.id, ok, latencyMs };
  };
  const results = [];
  for (let offset = 0; offset < accounts.length; offset += probeConcurrency) {
    const batch = accounts.slice(offset, offset + probeConcurrency);
    results.push(...await Promise.allSettled(batch.map(probeAccount)));
  }
  const rejected = results.filter(result => result.status === 'rejected');
  if (rejected.length > 0) {
    const error = new Error(`${rejected.length} of ${accounts.length} account probes failed`);
    error.code = 'ACCOUNT_PROBE_PARTIAL_FAILURE';
    throw error;
  }
  return {
    checked: accounts.length,
    healthy: results.filter(result => result.status === 'fulfilled' && result.value.ok).length,
  };
}

async function recoverCooldowns(pool, clock) {
  const result = await pool.query(`UPDATE upstream_accounts SET cooldown_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE cooldown_until IS NOT NULL AND cooldown_until<=$1`, [clock()]);
  return { recovered: result.rowCount || 0 };
}

async function aggregateUsage(pool, clock) {
  const today = dateInBeijing(clock());
  const watermarkResult = await pool.query(`SELECT config_value #>> '{}' AS watermark
    FROM system_config WHERE config_key='${AGGREGATE_WATERMARK_KEY}'`);
  const watermark = watermarkResult.rows?.[0]?.watermark;
  let startDate = isIsoDate(watermark) ? nextDate(watermark) : null;
  if (!startDate) {
    const earliest = await pool.query(`SELECT MIN((created_at AT TIME ZONE 'Asia/Shanghai')::date)::text AS usage_date
      FROM api_request_logs`);
    startDate = earliest.rows?.[0]?.usage_date || today;
  }
  if (!isIsoDate(startDate) || startDate > today) startDate = today;

  await withTransaction(pool, async client => {
    await client.query('DELETE FROM user_daily_usage WHERE usage_date BETWEEN $1::date AND $2::date', [startDate, today]);
    await client.query(`INSERT INTO user_daily_usage
      (usage_date,user_id,model_code,request_count,input_tokens,output_tokens,total_cost,success_count,failed_count,blocked_count)
      SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date,user_id,COALESCE(model_code,''),COUNT(*),COALESCE(SUM(input_tokens),0),
        COALESCE(SUM(output_tokens),0),COALESCE(SUM(total_cost),0),
        COUNT(*) FILTER (WHERE status='success'),COUNT(*) FILTER (WHERE status='failed'),
        COUNT(*) FILTER (WHERE status='blocked')
      FROM api_request_logs WHERE user_id IS NOT NULL
        AND created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND created_at<(($2::date+INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Shanghai')
      GROUP BY (created_at AT TIME ZONE 'Asia/Shanghai')::date,user_id,COALESCE(model_code,'')
      ON CONFLICT (usage_date,user_id,model_code) DO UPDATE SET
        request_count=EXCLUDED.request_count,input_tokens=EXCLUDED.input_tokens,
        output_tokens=EXCLUDED.output_tokens,total_cost=EXCLUDED.total_cost,
        success_count=EXCLUDED.success_count,failed_count=EXCLUDED.failed_count,
        blocked_count=EXCLUDED.blocked_count`, [startDate, today]);
    await client.query('DELETE FROM user_api_key_daily_usage WHERE usage_date BETWEEN $1::date AND $2::date', [startDate, today]);
    await client.query(`INSERT INTO user_api_key_daily_usage
      (usage_date,user_id,api_key_id,model_code,request_count,input_tokens,output_tokens,total_cost,success_count,failed_count,blocked_count)
      SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date,user_id,api_key_id,COALESCE(model_code,''),COUNT(*),
        COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),COALESCE(SUM(total_cost),0),
        COUNT(*) FILTER (WHERE status='success'),COUNT(*) FILTER (WHERE status='failed'),
        COUNT(*) FILTER (WHERE status='blocked')
      FROM api_request_logs WHERE user_id IS NOT NULL AND api_key_id IS NOT NULL
        AND created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND created_at<(($2::date+INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Shanghai')
      GROUP BY (created_at AT TIME ZONE 'Asia/Shanghai')::date,user_id,api_key_id,COALESCE(model_code,'')
      ON CONFLICT (usage_date,user_id,api_key_id,model_code) DO UPDATE SET
        request_count=EXCLUDED.request_count,input_tokens=EXCLUDED.input_tokens,
        output_tokens=EXCLUDED.output_tokens,total_cost=EXCLUDED.total_cost,
        success_count=EXCLUDED.success_count,failed_count=EXCLUDED.failed_count,
        blocked_count=EXCLUDED.blocked_count`, [startDate, today]);
    await client.query('DELETE FROM platform_daily_usage WHERE usage_date BETWEEN $1::date AND $2::date', [startDate, today]);
    await client.query(`INSERT INTO platform_daily_usage
      (usage_date,model_code,request_count,input_tokens,output_tokens,total_cost,success_count,failed_count,blocked_count)
      SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date,COALESCE(model_code,''),COUNT(*),COALESCE(SUM(input_tokens),0),
        COALESCE(SUM(output_tokens),0),COALESCE(SUM(total_cost),0),
        COUNT(*) FILTER (WHERE status='success'),COUNT(*) FILTER (WHERE status='failed'),
        COUNT(*) FILTER (WHERE status='blocked')
      FROM api_request_logs
      WHERE created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND created_at<(($2::date+INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Shanghai')
      GROUP BY (created_at AT TIME ZONE 'Asia/Shanghai')::date,COALESCE(model_code,'')
      ON CONFLICT (usage_date,model_code) DO UPDATE SET
        request_count=EXCLUDED.request_count,input_tokens=EXCLUDED.input_tokens,
        output_tokens=EXCLUDED.output_tokens,total_cost=EXCLUDED.total_cost,
        success_count=EXCLUDED.success_count,failed_count=EXCLUDED.failed_count,
        blocked_count=EXCLUDED.blocked_count`, [startDate, today]);
    await client.query(`INSERT INTO system_config (config_key,config_value,description)
      VALUES ('${AGGREGATE_WATERMARK_KEY}',to_jsonb($1::text),'Last fully committed daily usage aggregation date')
      ON CONFLICT (config_key) DO UPDATE SET config_value=EXCLUDED.config_value,
        description=EXCLUDED.description,updated_at=CURRENT_TIMESTAMP`, [today]);
  });
  return { startDate, endDate: today };
}

async function maintainPartitions(pool, clock, horizonMonths = 3) {
  const months = partitionMonths(clock(), horizonMonths);
  for (const month of months) {
    await pool.query('SELECT ensure_api_request_logs_partition($1::date)', [month]);
  }
  return { months };
}

async function retainLogs(pool, retentionDays) {
  const result = await pool.query(`DELETE FROM api_request_logs
    WHERE created_at<CURRENT_TIMESTAMP-($1 * INTERVAL '1 day')`, [retentionDays]);
  return { deleted: result.rowCount || 0, retentionDays };
}

async function retainProbeHistory(pool, retentionDays = 30) {
  const result = await pool.query(`DELETE FROM upstream_account_probes
    WHERE checked_at<CURRENT_TIMESTAMP-($1 * INTERVAL '1 day')`, [retentionDays]);
  return { deleted: result.rowCount || 0, retentionDays };
}

function createPostgresWorkerTasks({
  pool,
  secretBox,
  redis = null,
  http = axios,
  logger = console,
  retentionDays = 90,
  partitionHorizonMonths = 3,
  probeConcurrency = 5,
  probeRetentionDays = 30,
  redisKeyPrefix = 'ionailabs',
  clock = () => new Date(),
} = {}) {
  if (!pool?.query) throw new Error('worker PostgreSQL pool is required');
  if (!secretBox?.open) throw new Error('worker secret box is required');
  const pricingSync = new PostgresPricingSyncService({ pool, http, logger, clock });
  const safeRetentionDays = validateRetentionDays(retentionDays);
  if (!Number.isInteger(partitionHorizonMonths) || partitionHorizonMonths < 1 || partitionHorizonMonths > 12) {
    throw new Error('partition horizon must be an integer between 1 and 12 months');
  }
  if (!Number.isInteger(probeConcurrency) || probeConcurrency < 1 || probeConcurrency > 50) {
    throw new Error('probe concurrency must be an integer between 1 and 50');
  }
  if (!Number.isInteger(probeRetentionDays) || probeRetentionDays < 1 || probeRetentionDays > 365) {
    throw new Error('probe retention must be an integer between 1 and 365 days');
  }
  return [
    { name: 'account-monitor', intervalMs: 30_000, run: () => probeAccounts({
      pool, secretBox, http, redis, logger, clock, probeConcurrency, redisKeyPrefix,
    }) },
    { name: 'cooldown-recovery', intervalMs: 30_000, run: () => recoverCooldowns(pool, clock) },
    { name: 'daily-aggregation', intervalMs: 300_000, run: () => aggregateUsage(pool, clock) },
    { name: 'partition-maintenance', intervalMs: 3_600_000, run: () => maintainPartitions(pool, clock, partitionHorizonMonths) },
    { name: 'probe-retention', intervalMs: 86_400_000, run: () => retainProbeHistory(pool, probeRetentionDays) },
    { name: 'log-retention', intervalMs: 86_400_000, run: () => retainLogs(pool, safeRetentionDays) },
    { name: 'exchange-rate-sync', intervalMs: 86_400_000, runOnStart: false, run: () => pricingSync.syncExchangeRate() },
    { name: 'official-pricing-sync', intervalMs: 7 * 86_400_000, runOnStart: false, run: () => pricingSync.syncOfficialPricing() },
  ];
}

module.exports = {
  aggregateUsage,
  createPostgresWorkerTasks,
  maintainPartitions,
  validateRetentionDays,
};
