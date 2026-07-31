const DEFAULT_LOAD_TARGET = 'http://127.0.0.1:4010';

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function normalizedTarget(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error('LOAD_TARGET 必须是有效的 HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('LOAD_TARGET 仅支持 HTTP(S)');
  if (parsed.username || parsed.password) throw new Error('LOAD_TARGET 不能包含凭据；请使用 LOAD_API_KEY 环境变量');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/, '');
}

function resolveLoadConfig(environment = process.env) {
  const target = normalizedTarget(environment.LOAD_TARGET || DEFAULT_LOAD_TARGET);
  const isLocalTarget = isLoopbackHost(new URL(target).hostname);
  const allowExternal = String(environment.ALLOW_EXTERNAL_LOAD_TARGET || '').toLowerCase() === 'true';
  if (!isLocalTarget && !allowExternal) {
    throw new Error('拒绝非 localhost 压测目标；仅在明确确认后设置 ALLOW_EXTERNAL_LOAD_TARGET=true');
  }
  return Object.freeze({
    target,
    isLocalTarget,
    allowExternal,
    apiKey: String(environment.LOAD_API_KEY || '').trim(),
    model: String(environment.LOAD_MODEL || 'load-chat').trim() || 'load-chat',
  });
}

function requestHeaders(config) {
  return {
    'content-type': 'application/json',
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
  };
}

module.exports = { DEFAULT_LOAD_TARGET, isLoopbackHost, requestHeaders, resolveLoadConfig };
