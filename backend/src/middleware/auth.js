const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDatabase } = require('../database/init');
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

async function findApiKey(db, rawKey) {
  const candidates = db.prepare("SELECT ak.*, u.id as user_id, u.status as user_status FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_prefix = ? AND ak.status = 'active'").all(rawKey.substring(0, 12));
  for (const candidate of candidates) {
    if (await bcrypt.compare(rawKey, candidate.key_hash)) return candidate;
  }
}

function apiKeyFromRequest(req) {
  const anthropicKey = String(req.headers['x-api-key'] || '').trim();
  if (anthropicKey) return anthropicKey;
  const authHeader = String(req.headers.authorization || '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function apiKeyAuthError(req, res, status, message, type) {
  if (String(req.path || '').startsWith('/messages')) {
    const anthropicType = status === 403 ? 'permission_error' : 'authentication_error';
    return res.status(status).json({
      type: 'error',
      error: { type: anthropicType, message },
    });
  }
  return res.status(status).json({ error: { message, type } });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '未提供认证令牌' });
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) { return res.status(401).json({ error: '令牌无效或已过期' }); }
}

async function authenticateApiKey(req, res, next) {
  const rawKey = apiKeyFromRequest(req);
  if (!rawKey) {
    return apiKeyAuthError(req, res, 401, '未提供 API Key', 'invalid_api_key');
  }
  try {
    const db = getDatabase();
    const apiKey = await findApiKey(db, rawKey);
    if (!apiKey) return apiKeyAuthError(req, res, 401, 'API Key 无效', 'invalid_api_key');
    if (apiKey.user_status !== 'active') return apiKeyAuthError(req, res, 403, '账户已被禁用', 'user_disabled');
    if (apiKey.expired_at && new Date(apiKey.expired_at) < new Date()) return apiKeyAuthError(req, res, 401, 'API Key 已过期', 'expired_key');
    req.apiKey = apiKey;
    req.userId = apiKey.user_id;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const allowed = roles.length > 0 ? roles : ['admin', 'operator', 'finance'];
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: '权限不足' });
    next();
  };
}

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

module.exports = {
  authenticate,
  authenticateApiKey,
  requireAdmin,
  generateToken,
  findApiKey,
  apiKeyFromRequest,
  JWT_SECRET,
};
