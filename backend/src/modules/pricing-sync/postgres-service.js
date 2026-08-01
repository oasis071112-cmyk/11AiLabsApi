const axios = require('axios');
const { withTransaction } = require('../../infrastructure/postgres');
const { PROVIDER_PAGES, inferProvider, parseOfficialPrices } = require('../../utils/pricing-sync');

function configScalar(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  return value;
}

class PostgresPricingSyncService {
  constructor({ pool, http = axios, logger = console, clock = () => new Date() } = {}) {
    if (!pool?.query) throw new TypeError('PostgreSQL pricing sync pool is required');
    this.pool = pool;
    this.http = http;
    this.logger = logger;
    this.clock = clock;
  }

  async _setConfig(client, key, value, description = '') {
    await client.query(`INSERT INTO system_config (config_key,config_value,description)
      VALUES ($1,$2::jsonb,$3) ON CONFLICT (config_key) DO UPDATE SET
      config_value=EXCLUDED.config_value,description=CASE WHEN EXCLUDED.description='' THEN system_config.description ELSE EXCLUDED.description END,
      updated_at=CURRENT_TIMESTAMP`, [key, JSON.stringify(value), description]);
  }

  async status() {
    const { rows } = await this.pool.query(`SELECT config_key,config_value FROM system_config WHERE config_key=ANY($1::text[])`, [[
      'usd_cny_exchange_rate', 'usd_cny_rate_updated_at', 'official_pricing_last_sync_at', 'official_pricing_last_sync_status',
    ]]);
    const config = new Map(rows.map(row => [row.config_key, configScalar(row.config_value)]));
    return {
      exchange_rate: Number(config.get('usd_cny_exchange_rate') || 7),
      exchange_rate_updated_at: config.get('usd_cny_rate_updated_at') || null,
      official_pricing_last_sync_at: config.get('official_pricing_last_sync_at') || null,
      official_pricing_last_sync_status: config.get('official_pricing_last_sync_status') || 'never',
    };
  }

  async syncExchangeRate() {
    try {
      const response = await this.http.get('https://api.frankfurter.app/latest?from=USD&to=CNY', { timeout: 15_000 });
      const rate = Number(response.data?.rates?.CNY);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('汇率服务未返回有效 USD/CNY');
      const updatedAt = this.clock().toISOString();
      await withTransaction(this.pool, async client => {
        await this._setConfig(client, 'usd_cny_exchange_rate', rate, 'USD/CNY exchange rate');
        await this._setConfig(client, 'usd_cny_rate_updated_at', updatedAt, 'Last successful USD/CNY sync');
      });
      return { ok: true, rate, updated_at: updatedAt };
    } catch (error) {
      const current = await this.status();
      this.logger.warn?.('美元兑人民币汇率同步失败，继续使用最近一次成功汇率', { error: error.message });
      return { ok: false, rate: current.exchange_rate, error: error.message };
    }
  }

  async syncOfficialPricing() {
    const { rows: models } = await this.pool.query(`SELECT model_code,model_name,model_type,official_provider,
      COALESCE(metadata->>'official_model_id',model_code) AS official_model_id,
      COALESCE(metadata->>'official_pricing_mode','auto') AS official_pricing_mode
      FROM models WHERE status='active' AND model_type!='image'
        AND COALESCE(metadata->>'official_pricing_mode','auto')='auto' ORDER BY model_code`);
    const result = { updated: 0, skipped: 0, failed: 0, details: [] };
    for (const model of models) {
      const provider = inferProvider(model);
      if (!provider) { result.skipped += 1; continue; }
      const modelId = model.official_model_id || model.model_code;
      const url = provider === 'openai'
        ? `${PROVIDER_PAGES.openai}${encodeURIComponent(modelId)}`
        : PROVIDER_PAGES[provider];
      try {
        const response = await this.http.get(url, {
          timeout: 30_000, headers: { 'User-Agent': 'IonAiLabs-official-pricing-sync/1.0' }, responseType: 'text',
        });
        const price = parseOfficialPrices(response.data, provider, modelId, model.model_name);
        if (!price) {
          result.skipped += 1;
          result.details.push({ model: model.model_code, status: 'skipped', reason: '官方模型标识、显示名称或标准价格未能严格匹配' });
          continue;
        }
        await this.pool.query(`UPDATE models SET official_provider=$2,official_currency=$3,official_input_price=$4,
          official_output_price=$5,official_cached_input_price=$6,official_unit_tokens=$7,official_price_updated_at=CURRENT_TIMESTAMP,
          metadata=metadata||$8::jsonb,updated_at=CURRENT_TIMESTAMP WHERE model_code=$1`, [
          model.model_code, provider, price.currency, price.input, price.output, price.cachedInput, price.unitTokens,
          JSON.stringify({ official_model_id: modelId, official_price_source: url }),
        ]);
        result.updated += 1;
        result.details.push({ model: model.model_code, status: 'updated', currency: price.currency, candidates: price.candidates || [modelId] });
      } catch (error) {
        result.failed += 1;
        result.details.push({ model: model.model_code, status: 'failed', reason: error.message });
        this.logger.warn?.('官方价格同步失败', { model: model.model_code, error: error.message });
      }
    }
    await withTransaction(this.pool, async client => {
      await this._setConfig(client, 'official_pricing_last_sync_at', this.clock().toISOString(), 'Last official pricing sync');
      await this._setConfig(client, 'official_pricing_last_sync_status', result.failed ? 'partial_failure' : 'ok', 'Official pricing sync status');
    });
    return result;
  }

  async syncAll() {
    const [exchangeRate, officialPricing] = await Promise.all([this.syncExchangeRate(), this.syncOfficialPricing()]);
    return { exchange_rate: exchangeRate, official_pricing: officialPricing };
  }
}

module.exports = { PostgresPricingSyncService, configScalar };
