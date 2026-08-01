const SENSITIVE_ACCESS_LOG_PATHS = new Set(['/api/payment/easypay/notify']);

function requestPath(req = {}) {
  const value = String(req.path || req.originalUrl || req.url || '').split('?', 1)[0];
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function shouldSkipAccessLog(req) {
  return SENSITIVE_ACCESS_LOG_PATHS.has(requestPath(req));
}

module.exports = { requestPath, shouldSkipAccessLog };
