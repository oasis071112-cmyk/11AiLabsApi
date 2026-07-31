const bcryptjs = require('bcryptjs');
const jwtLibrary = require('jsonwebtoken');

function desensitizeKey(value) {
  const key = String(value || '');
  if (key.length < 11) return key;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

function apiKeyAad(keyId) {
  return `api_keys:${String(keyId)}`;
}

function rawApiKey(req) {
  const anthropic = String(req.headers['x-api-key'] || '').trim();
  if (anthropic) return anthropic;
  const authorization = String(req.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function apiKeyError(req, res, status, message, type) {
  if (String(req.path || req.originalUrl || '').includes('/messages')) {
    return res.status(status).json({
      type: 'error',
      error: { type: status === 403 ? 'permission_error' : 'authentication_error', message },
    });
  }
  return res.status(status).json({ error: { message, type } });
}

function createPostgresIdentity({
  pool,
  secretBox = null,
  bcrypt = bcryptjs,
  jwt = jwtLibrary,
  jwtSecret = process.env.JWT_SECRET,
  jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d',
} = {}) {
  if (!pool?.query) throw new TypeError('PostgreSQL identity pool.query is required');
  if (!bcrypt?.compare || !bcrypt?.hash) throw new TypeError('bcrypt hash and compare are required');
  if (!jwt?.sign || !jwt?.verify) throw new TypeError('jwt sign and verify are required');
  if (!jwtSecret || Buffer.byteLength(String(jwtSecret), 'utf8') < 32) {
    throw new TypeError('PostgreSQL identity JWT_SECRET must contain at least 32 bytes');
  }

  function generateToken(user) {
    return jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
  }

  async function authenticate(req, res, next) {
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '未提供认证令牌' });
    try {
      const tokenUser = jwt.verify(authHeader.slice(7).trim(), jwtSecret);
      const isStaff = tokenUser.role && tokenUser.role !== 'user';
      const table = isStaff ? 'staff_users' : 'users';
      const { rows } = await pool.query(`SELECT id,username,role,status FROM ${table} WHERE id=$1`, [tokenUser.id]);
      const current = rows[0];
      if (!current || current.status !== 'active' || current.role !== tokenUser.role) {
        return res.status(401).json({ error: '账户不存在、已禁用或权限已变更' });
      }
      req.user = {
        ...tokenUser,
        username: current.username,
        ...(isStaff ? { staff_id: current.id } : {}),
      };
      return next();
    } catch (_error) {
      return res.status(401).json({ error: '令牌无效或已过期' });
    }
  }

  async function findApiKey(rawKey) {
    const key = String(rawKey || '');
    if (!key) return null;
    const { rows } = await pool.query(`SELECT ak.*,u.id AS user_id,u.status AS user_status
      FROM api_keys ak JOIN users u ON u.id=ak.user_id
      WHERE ak.key_prefix=$1 AND ak.status='active'`, [key.slice(0, 12)]);
    for (const candidate of rows) {
      if (await bcrypt.compare(key, candidate.key_hash)) return candidate;
    }
    return null;
  }

  async function allowedModels(apiKey) {
    const { rows } = await pool.query(`SELECT DISTINCT m.model_code
      FROM routing_groups rg
      JOIN routing_group_accounts rga ON rga.routing_group_id=rg.id AND rga.status='active'
      JOIN upstream_accounts ua ON ua.id=rga.account_id AND ua.status='active'
      JOIN account_models am ON am.account_id=ua.id AND am.status='active'
      JOIN models m ON m.model_code=am.model_code AND m.status='active'
      LEFT JOIN routing_group_models rgm ON rgm.routing_group_id=rg.id
        AND rgm.model_code=m.model_code AND rgm.status='active'
      LEFT JOIN api_key_permissions permission ON permission.api_key_id=$2
        AND permission.model_code=m.model_code AND permission.status='active'
      WHERE rg.id=$1 AND (rg.restrict_models=FALSE OR rgm.model_code IS NOT NULL)
        AND ($3='group_dynamic' OR permission.api_key_id IS NOT NULL)
      ORDER BY m.model_code`, [apiKey.routing_group_id, apiKey.id, apiKey.permission_mode || 'group_dynamic']);
    return rows.map(row => row.model_code);
  }

  async function authenticateApiKey(req, res, next) {
    const key = rawApiKey(req);
    if (!key) return apiKeyError(req, res, 401, '未提供 API Key', 'invalid_api_key');
    try {
      const apiKey = await findApiKey(key);
      if (!apiKey) return apiKeyError(req, res, 401, 'API Key 无效', 'invalid_api_key');
      if (apiKey.user_status !== 'active') return apiKeyError(req, res, 403, '账户已被禁用', 'user_disabled');
      if (apiKey.expired_at && new Date(apiKey.expired_at).getTime() < Date.now()) {
        return apiKeyError(req, res, 401, 'API Key 已过期', 'expired_key');
      }
      const models = await allowedModels(apiKey);
      req.apiIdentity = {
        userId: apiKey.user_id,
        apiKeyId: apiKey.id,
        routingGroupId: apiKey.routing_group_id,
        permissionMode: apiKey.permission_mode || 'group_dynamic',
        allowedModels: models,
      };
      req.userId = apiKey.user_id;
      req.apiKey = {
        id: apiKey.id,
        user_id: apiKey.user_id,
        routing_group_id: apiKey.routing_group_id,
        permission_mode: apiKey.permission_mode || 'group_dynamic',
      };
      await pool.query('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=$1', [apiKey.id]);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function sealApiKey(keyId, rawKey) {
    if (!secretBox?.seal) throw new Error('PostgreSQL API key encryption requires secretBox.seal');
    return secretBox.seal(rawKey, { aad: apiKeyAad(keyId) });
  }

  function openApiKey(keyId, envelope) {
    if (!secretBox?.open) throw new Error('PostgreSQL API key decryption requires secretBox.open');
    return secretBox.open(envelope, { aad: apiKeyAad(keyId) });
  }

  return Object.freeze({
    apiKeyAad,
    authenticate,
    authenticateApiKey,
    allowedModels,
    bcrypt,
    desensitizeKey,
    findApiKey,
    generateToken,
    openApiKey,
    sealApiKey,
  });
}

module.exports = { apiKeyAad, createPostgresIdentity, desensitizeKey };
