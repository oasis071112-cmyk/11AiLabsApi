const jwt = require('jsonwebtoken');
const { getDatabase } = require('../database/init');
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '未提供认证令牌' });
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) { return res.status(401).json({ error: '令牌无效或已过期' }); }
}

function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: '未提供 API Key', type: 'invalid_api_key' } });
  }
  const keyPrefix = authHeader.split(' ')[1];
  const db = getDatabase();
  const apiKey = db.prepare("SELECT ak.*, u.id as user_id, u.status as user_status FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_prefix = ? AND ak.status = 'active'").get(keyPrefix.substring(0, 12));
  if (!apiKey) return res.status(401).json({ error: { message: 'API Key 无效', type: 'invalid_api_key' } });
  if (apiKey.user_status !== 'active') return res.status(403).json({ error: { message: '账户已被禁用', type: 'user_disabled' } });
  if (apiKey.expired_at && new Date(apiKey.expired_at) < new Date()) return res.status(401).json({ error: { message: 'API Key 已过期', type: 'expired_key' } });
  req.apiKey = apiKey;
  req.userId = apiKey.user_id;
  next();
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

module.exports = { authenticate, authenticateApiKey, requireAdmin, generateToken, JWT_SECRET };
