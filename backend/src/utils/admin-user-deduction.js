const USD_CURRENCY = 'USD';
const MIXED_CURRENCY = 'MIXED';

function parseBillingSnapshot(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function currencyCode(value) {
  return String(value || '').toUpperCase();
}

function isUsdSnapshot(value, fallbackCurrency) {
  const currency = currencyCode(value.currency || fallbackCurrency);
  if (currency === USD_CURRENCY) return true;
  if (currency !== MIXED_CURRENCY) return false;
  const tiers = Object.values(parseBillingSnapshot(value.tier_charges));
  return tiers.length > 0 && tiers.every(tier => currencyCode(tier?.currency) === USD_CURRENCY);
}

function deriveUserDeductionUsd(log = {}) {
  if (log.status !== 'success') return null;
  const persistedSnapshot = parseBillingSnapshot(log.billing_snapshot);
  const chargeSnapshot = parseBillingSnapshot(persistedSnapshot.charge);
  const billingSnapshot = Object.keys(chargeSnapshot).length ? chargeSnapshot : persistedSnapshot;
  const rate = Number(billingSnapshot.usd_cny_rate ?? persistedSnapshot.usd_cny_rate ?? log.usd_cny_rate);
  const settledPoints = Number(log.total_cost);
  if (!isUsdSnapshot(billingSnapshot, log.official_currency)) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(settledPoints) || settledPoints < 0) return null;
  return settledPoints / rate;
}

function sqliteUserDeductionUsdSql(tableAlias = 'arl') {
  return `CASE WHEN ${tableAlias}.status='success'
    AND UPPER(COALESCE(${tableAlias}.official_currency,''))='USD'
    AND CAST(${tableAlias}.usd_cny_rate AS REAL)>0
    AND CAST(${tableAlias}.total_cost AS REAL)>=0
    THEN CAST(${tableAlias}.total_cost AS REAL)/CAST(${tableAlias}.usd_cny_rate AS REAL)
    ELSE NULL END`;
}

function postgresUserDeductionUsdSql(tableAlias = 'arl') {
  const snapshot = `COALESCE(${tableAlias}.billing_snapshot,'{}'::jsonb)`;
  const hasCharge = `jsonb_typeof(${snapshot}->'charge')='object' AND ${snapshot}->'charge'<>'{}'::jsonb`;
  const charge = `(CASE WHEN ${hasCharge} THEN ${snapshot}->'charge' ELSE ${snapshot} END)`;
  const rateText = `COALESCE(${charge}->>'usd_cny_rate',${snapshot}->>'usd_cny_rate')`;
  const rate = `(CASE WHEN ${rateText} ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$'
    THEN (${rateText})::numeric ELSE NULL END)`;
  const currency = `UPPER(COALESCE(${charge}->>'currency',''))`;
  const tierCharges = `${charge}->'tier_charges'`;
  const usdCurrency = `(${currency}='USD' OR (${currency}='MIXED' AND CASE
    WHEN jsonb_typeof(${tierCharges})='object' THEN ${tierCharges}<>'{}'::jsonb
      AND NOT EXISTS (SELECT 1 FROM jsonb_each(${tierCharges}) AS tier(key,value)
        WHERE UPPER(COALESCE(tier.value->>'currency',''))<>'USD')
    ELSE FALSE END))`;
  return `CASE WHEN ${tableAlias}.status='success'
    AND ${tableAlias}.total_cost>=0 AND ${rate}>0 AND ${usdCurrency}
    THEN ${tableAlias}.total_cost/${rate} ELSE NULL END`;
}

function strictUserDeductionUsdAggregateSql(valueSql, statusSql) {
  return `CASE WHEN COALESCE(SUM(CASE WHEN ${statusSql}='success' THEN 1 ELSE 0 END),0)=COUNT(${valueSql})
    THEN COALESCE(SUM(${valueSql}),0) ELSE NULL END`;
}

module.exports = {
  deriveUserDeductionUsd,
  sqliteUserDeductionUsdSql,
  postgresUserDeductionUsdSql,
  strictUserDeductionUsdAggregateSql,
};
