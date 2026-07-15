const axios = require('axios');
const logger = require('./logger');

const PROVIDER_PAGES = {
  openai: 'https://developers.openai.com/api/docs/models/',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  anthropic: 'https://docs.anthropic.com/en/docs/about-claude/pricing',
};

function getConfig(db, key, fallback = '') {
  return db.prepare('SELECT config_value FROM system_config WHERE config_key=?').get(key)?.config_value || fallback;
}

function setConfig(db, key, value) {
  db.prepare('UPDATE system_config SET config_value=?, updated_at=CURRENT_TIMESTAMP WHERE config_key=?').run(String(value), key);
}

function inferProvider(model) {
  if (['openai', 'deepseek', 'anthropic'].includes(String(model.official_provider || '').toLowerCase())) return model.official_provider.toLowerCase();
  const name = `${model.official_model_id || ''} ${model.model_code || ''}`.toLowerCase();
  if (/^(gpt|o[1-9]|chatgpt)|\bgpt-/.test(name)) return 'openai';
  if (/deepseek/.test(name)) return 'deepseek';
  if (/claude/.test(name)) return 'anthropic';
  return null;
}

function parseMoney(value) {
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currencyFromSymbol(symbol) {
  if (!symbol) return null;
  if (/^(¥|￥|CNY)$/i.test(symbol)) return 'CNY';
  if (/^(\$|US\$|USD)$/i.test(symbol)) return 'USD';
  return null;
}

function parseLabeledPrice(scope, label) {
  const match = scope.match(new RegExp(`(?:${label})[^$¥￥0-9]{0,100}(US\\$|USD|CNY|\\$|¥|￥)\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'));
  if (!match) return null;
  const currency = currencyFromSymbol(match[1]);
  const amount = parseMoney(match[2]);
  return currency && amount !== null ? { currency, amount } : null;
}

// 文档布局会变化；只在能同时确认输入、输出两项时写入，避免把未知价格覆盖成 0。
function parseOfficialPrices(html, provider, modelId) {
  const rawHtml = String(html);
  const text = rawHtml.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const unitTokens = 1_000_000;
  // OpenAI 模型详情页使用固定的价格卡片 HTML，优先按卡片解析，避免命中导航里的 “Input”。
  const cardValue = (label) => rawHtml.match(new RegExp(`<div>${label}<\\/div><div[^>]*>\\s*(?:\\$|¥|￥)?\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'))?.[1];
  const cardInput = cardValue('Input');
  const cardOutput = cardValue('Output');
  if (provider === 'openai' && cardInput && cardOutput) {
    return {
      currency: 'USD', input: parseMoney(cardInput), output: parseMoney(cardOutput),
      cachedInput: parseMoney(cardValue('Cached input') || cardInput), unitTokens, source: PROVIDER_PAGES[provider],
    };
  }
  const id = String(modelId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const windowMatch = id ? text.match(new RegExp(`.{0,500}${id}.{0,1800}`, 'i')) : null;
  // 聚合价格页必须命中管理员确认的官方模型标识；未命中就跳过，绝不把页面上另一款模型的价格误写入。
  if (!windowMatch && provider !== 'openai') return null;
  const scope = windowMatch ? windowMatch[0] : text;
  const input = parseLabeledPrice(scope, 'input|输入');
  const output = parseLabeledPrice(scope, 'output|输出');
  const cachedInput = parseLabeledPrice(scope, 'cached input|缓存(?:输入)?|cache read');
  if (!input || !output || input.currency !== output.currency || (cachedInput && cachedInput.currency !== input.currency)) return null;
  return { currency: input.currency, input: input.amount, output: output.amount, cachedInput: cachedInput ? cachedInput.amount : input.amount, unitTokens, source: PROVIDER_PAGES[provider] };
}

async function fetchProviderPage(provider, modelId) {
  const url = provider === 'openai' && modelId
    ? `${PROVIDER_PAGES.openai}${encodeURIComponent(modelId)}`
    : PROVIDER_PAGES[provider];
  const response = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': '11AiLabs-official-pricing-sync/1.0' },
    responseType: 'text',
  });
  return { html: response.data, url };
}

async function syncUsdCnyRate(db) {
  try {
    const response = await axios.get('https://api.frankfurter.app/latest?from=USD&to=CNY', { timeout: 15000 });
    const rate = Number(response.data?.rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('汇率服务未返回有效 USD/CNY');
    setConfig(db, 'usd_cny_exchange_rate', rate);
    setConfig(db, 'usd_cny_rate_updated_at', new Date().toISOString());
    return { ok: true, rate };
  } catch (error) {
    logger.warn('美元兑人民币汇率同步失败，继续使用最近一次成功汇率', { error: error.message });
    return { ok: false, rate: Number(getConfig(db, 'usd_cny_exchange_rate', '7')), error: error.message };
  }
}

async function syncOfficialPricing(db) {
  const models = db.prepare("SELECT * FROM models WHERE status='active' AND COALESCE(official_pricing_mode,'auto')='auto'").all();
  const result = { updated: 0, skipped: 0, failed: 0, details: [] };

  for (const model of models) {
    const provider = inferProvider(model);
    if (!provider) continue;
    try {
      const modelId = model.official_model_id || model.model_code;
      const { html, url } = await fetchProviderPage(provider, modelId);
      const price = parseOfficialPrices(html, provider, modelId);
      if (!price) {
        result.skipped++;
        result.details.push({ model: model.model_code, status: 'skipped', reason: '未能从官方页面完整识别输入和输出价格' });
        continue;
      }
      db.prepare('UPDATE models SET official_provider=?,official_model_id=?,official_currency=?,official_input_price=?,official_output_price=?,official_cached_input_price=?,official_unit_tokens=?,official_price_source=?,official_price_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(provider, modelId, price.currency, price.input, price.output, price.cachedInput, price.unitTokens, url, model.id);
      result.updated++;
      result.details.push({ model: model.model_code, status: 'updated', currency: price.currency });
    } catch (error) {
      result.failed++;
      result.details.push({ model: model.model_code, status: 'failed', reason: error.message });
      logger.warn('官方价格同步失败', { model: model.model_code, error: error.message });
    }
  }
  setConfig(db, 'official_pricing_last_sync_at', new Date().toISOString());
  setConfig(db, 'official_pricing_last_sync_status', result.failed ? 'partial_failure' : 'ok');
  return result;
}

function startPricingSchedules(db) {
  syncUsdCnyRate(db);
  syncOfficialPricing(db);
  setInterval(() => syncUsdCnyRate(db), 24 * 60 * 60 * 1000);
  setInterval(() => syncOfficialPricing(db), 7 * 24 * 60 * 60 * 1000);
}

module.exports = { PROVIDER_PAGES, inferProvider, parseOfficialPrices, syncUsdCnyRate, syncOfficialPricing, startPricingSchedules };
