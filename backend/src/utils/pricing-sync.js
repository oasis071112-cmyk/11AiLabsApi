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

function anthropicIdentity(value) {
  const tokens = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  const claudeIndex = tokens.indexOf('claude');
  const tier = tokens.find(token => ['opus', 'sonnet', 'haiku'].includes(token));
  const version = tokens
    .slice(Math.max(0, claudeIndex + 1))
    .filter(token => /^\d{1,2}$/.test(token))
    .slice(0, 2)
    .join('.');
  if (claudeIndex < 0 || !tier || !version) return null;
  return { family: 'claude', tier, version, date: tokens.find(token => /^\d{8}$/.test(token)) || null };
}

function sameAnthropicIdentity(left, right) {
  return left && right && left.family === right.family && left.tier === right.tier && left.version === right.version;
}

function anthropicAnchors(text) {
  const pattern = /claude[\s._-]+(?:(?:opus|sonnet|haiku)[\s._-]+\d+(?:[._-]\d+)?|\d+(?:[._-]\d+)?[\s._-]+(?:opus|sonnet|haiku))(?:[\s._-]+\d{8})?/gi;
  return Array.from(text.matchAll(pattern), match => ({
    start: match.index,
    end: match.index + match[0].length,
    value: match[0],
    identity: anthropicIdentity(match[0]),
  }));
}

function htmlText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAnthropicTablePrices(rawHtml, modelId, modelName, unitTokens) {
  const officialIdentity = anthropicIdentity(modelId);
  const displayIdentity = anthropicIdentity(modelName);
  if (!sameAnthropicIdentity(officialIdentity, displayIdentity)) return null;
  const exactId = String(modelId || '').normalize('NFKC').trim().toLowerCase();
  const candidates = [];

  for (const tableMatch of String(rawHtml).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const table = tableMatch[1];
    const headerRow = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || table.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[1];
    const headers = Array.from(String(headerRow || '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi), match => htmlText(match[1]).toLowerCase());
    const modelIndex = headers.findIndex(header => header === 'model');
    const inputIndex = headers.findIndex(header => /base input/.test(header));
    const cachedInputIndex = headers.findIndex(header => /cache hits|cache read|缓存读取/.test(header));
    const outputIndex = headers.findIndex(header => /output tokens?/.test(header));
    if ([modelIndex, inputIndex, cachedInputIndex, outputIndex].some(index => index < 0) || headers.some(header => /batch/.test(header))) continue;

    for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = Array.from(rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), match => htmlText(match[1]));
      if (cells.length <= Math.max(modelIndex, inputIndex, cachedInputIndex, outputIndex)) continue;
      const rowIdentity = anthropicIdentity(cells[modelIndex]);
      if (!sameAnthropicIdentity(rowIdentity, officialIdentity)) continue;
      if (officialIdentity.date && cells[modelIndex].normalize('NFKC').toLowerCase() !== exactId) continue;
      const input = parseLabeledPrice(`Input ${cells[inputIndex]}`, 'input');
      const cachedInput = parseLabeledPrice(`Cached input ${cells[cachedInputIndex]}`, 'cached input');
      const output = parseLabeledPrice(`Output ${cells[outputIndex]}`, 'output');
      if (!input || !cachedInput || !output || input.currency !== cachedInput.currency || input.currency !== output.currency) continue;
      candidates.push({ id: cells[modelIndex], currency: input.currency, input: input.amount, cachedInput: cachedInput.amount, output: output.amount });
    }
  }

  if (!candidates.length || candidates.some(candidate => candidate.currency !== candidates[0].currency)) return null;
  return {
    currency: candidates[0].currency,
    input: Math.max(...candidates.map(candidate => candidate.input)),
    output: Math.max(...candidates.map(candidate => candidate.output)),
    cachedInput: Math.max(...candidates.map(candidate => candidate.cachedInput)),
    unitTokens,
    source: PROVIDER_PAGES.anthropic,
    candidates: candidates.map(candidate => candidate.id),
  };
}

function parseAnthropicPrices(text, modelId, modelName, unitTokens) {
  const officialIdentity = anthropicIdentity(modelId);
  const displayIdentity = anthropicIdentity(modelName);
  if (!sameAnthropicIdentity(officialIdentity, displayIdentity)) return null;

  const anchors = anthropicAnchors(text);
  const exactId = String(modelId || '').normalize('NFKC').trim().toLowerCase();
  const candidates = [];

  anchors.forEach((anchor, index) => {
    if (!sameAnthropicIdentity(anchor.identity, officialIdentity)) return;
    if (officialIdentity.date && anchor.value.normalize('NFKC').toLowerCase() !== exactId) return;
    const nextAnchor = anchors[index + 1];
    const modelScope = text.slice(anchor.end, nextAnchor ? nextAnchor.start : text.length);
    const standardMatch = modelScope.match(/(?:^|\s)standard(?:\s+pricing)?\s+([\s\S]*?)(?=\s(?:batch|long context|priority|regional)\b|$)/i);
    const hasSpecialPricing = /(?:^|\s)(?:batch|long context|priority|regional)\b/i.test(modelScope);
    if (hasSpecialPricing && !standardMatch) return;
    const scope = standardMatch ? standardMatch[1] : modelScope;
    const input = parseLabeledPrice(scope, 'input|输入');
    const output = parseLabeledPrice(scope, 'output|输出');
    const cachedInput = parseLabeledPrice(scope, 'cached input|缓存(?:输入)?|cache read');
    if (!input || !output || input.currency !== output.currency || (cachedInput && cachedInput.currency !== input.currency)) return;
    candidates.push({
      id: anchor.value,
      currency: input.currency,
      input: input.amount,
      output: output.amount,
      cachedInput: cachedInput ? cachedInput.amount : input.amount,
    });
  });

  if (!candidates.length || candidates.some(candidate => candidate.currency !== candidates[0].currency)) return null;
  return {
    currency: candidates[0].currency,
    input: Math.max(...candidates.map(candidate => candidate.input)),
    output: Math.max(...candidates.map(candidate => candidate.output)),
    cachedInput: Math.max(...candidates.map(candidate => candidate.cachedInput)),
    unitTokens,
    source: PROVIDER_PAGES.anthropic,
    candidates: candidates.map(candidate => candidate.id),
  };
}

function parseOfficialPrices(html, provider, modelId, modelName = modelId) {
  const rawHtml = String(html);
  const text = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const unitTokens = 1_000_000;
  const cardValue = (label) => rawHtml.match(new RegExp(`<div>${label}<\\/div><div[^>]*>\\s*(?:\\$|¥|￥)?\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'))?.[1];
  const cardInput = cardValue('Input');
  const cardOutput = cardValue('Output');
  if (provider === 'openai' && cardInput && cardOutput) {
    return {
      currency: 'USD', input: parseMoney(cardInput), output: parseMoney(cardOutput),
      cachedInput: parseMoney(cardValue('Cached input') || cardInput), unitTokens, source: PROVIDER_PAGES[provider],
    };
  }
  if (provider === 'anthropic') {
    return parseAnthropicTablePrices(rawHtml, modelId, modelName, unitTokens)
      || parseAnthropicPrices(text, modelId, modelName, unitTokens);
  }
  const id = String(modelId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const windowMatch = id ? text.match(new RegExp(`.{0,500}${id}.{0,1800}`, 'i')) : null;
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
    headers: { 'User-Agent': 'IonAiLabs-official-pricing-sync/1.0' },
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
  const models = db.prepare("SELECT * FROM models WHERE status='active' AND model_type!='image' AND COALESCE(official_pricing_mode,'auto')='auto'").all();
  const result = { updated: 0, skipped: 0, failed: 0, details: [] };

  for (const model of models) {
    const provider = inferProvider(model);
    if (!provider) continue;
    try {
      const modelId = model.official_model_id || model.model_code;
      const { html, url } = await fetchProviderPage(provider, modelId);
      const price = parseOfficialPrices(html, provider, modelId, model.model_name);
      if (!price) {
        result.skipped++;
        result.details.push({ model: model.model_code, status: 'skipped', reason: '官方模型标识、显示名称或标准价格未能严格匹配' });
        continue;
      }
      db.prepare('UPDATE models SET official_provider=?,official_model_id=?,official_currency=?,official_input_price=?,official_output_price=?,official_cached_input_price=?,official_unit_tokens=?,official_price_source=?,official_price_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(provider, modelId, price.currency, price.input, price.output, price.cachedInput, price.unitTokens, url, model.id);
      result.updated++;
      result.details.push({ model: model.model_code, status: 'updated', currency: price.currency, candidates: price.candidates || [modelId] });
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
