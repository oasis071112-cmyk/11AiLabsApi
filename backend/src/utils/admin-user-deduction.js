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

module.exports = { deriveUserDeductionUsd };
