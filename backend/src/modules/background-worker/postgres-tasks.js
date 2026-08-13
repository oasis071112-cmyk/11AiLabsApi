const axios = require('axios');
const { withTransaction } = require('../../infrastructure/postgres');
const { extendRedisCooldown } = require('../gateway-scheduler');
const { PostgresPricingSyncService } = require('../pricing-sync/postgres-service');
const { UsageSettlement } = require('../usage-settlement');
const { PostgresSettlementRepository } = require('../usage-settlement/postgres-repository');
const { PostgresProxyBillingPolicy } = require('../postgres-proxy/postgres-adapters');

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

function object(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

async function reconcilePendingReservations(pool, {
  usageSettlement,
  billingPolicy,
  logger = console,
  staleReservedMs = 16 * 60_000,
} = {}) {
  if (!usageSettlement?.resolvePending) throw new Error('pending reconciliation requires UsageSettlement');
  const { rows = [] } = await pool.query(`SELECT ur.request_id,ur.user_id,ur.api_key_id,ur.reserved_amount,
      ur.status AS reservation_status,latest.id AS log_id,
      latest.created_at::text AS log_created_at,latest.error_type,latest.error_message,
      latest.billing_snapshot
    FROM usage_reservations ur
    LEFT JOIN LATERAL (
      SELECT id,created_at,error_type,error_message,billing_snapshot FROM api_request_logs
      WHERE request_id=ur.request_id ORDER BY created_at DESC,id DESC LIMIT 1
    ) latest ON TRUE
    WHERE ur.status='pending_review'
       OR (ur.status='reserved' AND ur.updated_at<CURRENT_TIMESTAMP-($1 * INTERVAL '1 millisecond'))
    ORDER BY ur.updated_at ASC LIMIT 100`, [staleReservedMs]);
  let resolved = 0;
  let failed = 0;
  for (const row of rows) {
    const snapshot = object(row.billing_snapshot);
    const retry = object(snapshot.settlement_retry);
    let retryCharge = Number(retry.charge_amount);
    let retryLog = object(retry.log);
    const pricingContext = object(retry.pricing_context);
    if (retry.pricing_pending === true) {
      if (!billingPolicy?.quoteCharge) throw new Error('pending pricing reconciliation requires billing policy');
      try {
        const quoted = await billingPolicy.quoteCharge(pricingContext);
        retryCharge = Number(quoted.amount || 0);
        retryLog = {
          ...retryLog,
          total_cost: retryCharge,
          billing_mode: quoted.billingMode || retryLog.billing_mode,
          billing_snapshot: {
            ...(object(retryLog.billing_snapshot)),
            charge: quoted.snapshot || {},
          },
        };
      } catch (error) {
        failed += 1;
        logger.warn?.(`[worker:pending-pricing] ${row.request_id}: ${error.message}`);
        continue;
      }
    }
    const chargeAmount = Number.isFinite(retryCharge) && retryCharge >= 0 ? retryCharge : 0;
    const outcome = ['settled', 'partial_settled'].includes(retry.outcome)
      ? retry.outcome
      : 'zero_released';
    const restoredLog = Object.fromEntries(Object.entries(retryLog).filter(([key]) => [
      'model_code', 'upstream_account_id', 'latency_ms', 'input_tokens', 'output_tokens',
      'billing_mode', 'endpoint', 'operation', 'output_items', 'final_size', 'output_format',
      'output_compression', 'image_metadata', 'protocol_metadata', 'billing_snapshot',
    ].includes(key)));
    const isSuccess = outcome === 'settled';
    const logUpdates = row.log_id == null ? null : {
      ...restoredLog,
      status: isSuccess ? 'success' : 'failed',
      error_type: isSuccess ? null : (retryLog.error_type || row.error_type || 'upstream_state_unknown'),
      error_message: isSuccess
        ? null
        : (retryLog.error_message || row.error_message || (outcome === 'partial_settled'
          ? 'Automatically reconciled from the last verifiable upstream usage'
          : 'Automatically reconciled without verifiable upstream usage')),
    };
    try {
      await usageSettlement.resolvePending({
        userId: row.user_id,
        reservedAmount: Number(row.reserved_amount),
        chargeAmount,
        requestId: row.request_id,
        reservationStatus: row.reservation_status || 'pending_review',
        logIdentity: row.log_id == null ? null : { id: row.log_id, createdAt: row.log_created_at },
        logUpdates,
        fallbackLog: row.log_id == null ? {
          request_id: row.request_id,
          user_id: row.user_id,
          api_key_id: row.api_key_id || null,
          status: 'failed',
          input_tokens: 0,
          output_tokens: 0,
          billing_mode: 'token',
          error_type: row.reservation_status === 'reserved'
            ? 'stale_reservation_released'
            : 'upstream_state_unknown',
          error_message: row.reservation_status === 'reserved'
            ? 'Automatically released after the maximum request duration elapsed'
            : 'Automatically reconciled without verifiable upstream usage',
          billing_snapshot: {
            reconciliation_reason: row.reservation_status === 'reserved'
              ? 'stale_reservation_released'
              : 'upstream_state_unknown',
          },
        } : null,
        resultMetadata: {
          outcome,
          reconciliation_source: 'worker',
          usage_verified: outcome === 'partial_settled' || outcome === 'settled',
        },
      });
      resolved += 1;
    } catch (error) {
      failed += 1;
      logger.warn?.(`[worker:pending-reconciliation] ${row.request_id}: ${error.message}`);
    }
  }
  return { examined: rows.length, resolved, failed };
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
  usageSettlement: providedUsageSettlement,
  billingPolicy: providedBillingPolicy,
} = {}) {
  if (!pool?.query) throw new Error('worker PostgreSQL pool is required');
  if (!secretBox?.open) throw new Error('worker secret box is required');
  const pricingSync = new PostgresPricingSyncService({ pool, http, logger, clock });
  const usageSettlement = providedUsageSettlement || null;
  const billingPolicy = providedBillingPolicy || new PostgresProxyBillingPolicy(pool);
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
    { name: 'pending-reconciliation', intervalMs: 10_000, run: () => reconcilePendingReservations(pool, {
      usageSettlement: usageSettlement || new UsageSettlement({
        repository: new PostgresSettlementRepository(pool),
      }),
      billingPolicy,
      logger,
    }) },
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
  reconcilePendingReservations,
  validateRetentionDays,
};
