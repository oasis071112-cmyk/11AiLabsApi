const express = require('express');
const { withTransaction } = require('../infrastructure/postgres');
const { createPostgresIdentity } = require('../modules/identity');

function jsonConfigValue(row, fallback) {
  if (!row) return fallback;
  const value = row.config_value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_error) { return value; }
  }
  return value;
}

function compatibleEmail(username, email) {
  const normalized = String(email || '').trim();
  return normalized || `${String(username).trim()}@local.invalid`;
}

function publicEmail(value) {
  const email = String(value || '');
  return email.endsWith('@local.invalid') ? null : (email || null);
}

function createPostgresAuthRouter({ pool, identity = createPostgresIdentity({ pool }) } = {}) {
  if (!pool?.query || !pool?.connect) throw new TypeError('PostgreSQL auth pool.query and pool.connect are required');
  if (!identity?.bcrypt || !identity?.generateToken || !identity?.authenticate) {
    throw new TypeError('PostgreSQL identity is required');
  }
  const router = express.Router();

  router.post('/register', async (req, res, next) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const requestedEmail = String(req.body?.email || '').trim();
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (username.length < 3 || username.length > 32) return res.status(400).json({ error: '用户名长度 3-32 字符' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

    try {
      const configResult = await pool.query(`SELECT config_key,config_value FROM system_config
        WHERE config_key = ANY($1::text[])`, [[
        'registration_enabled', 'new_user_gift_enabled', 'new_user_gift_amount',
      ]]);
      const config = new Map(configResult.rows.map(row => [row.config_key, jsonConfigValue(row, null)]));
      if (config.get('registration_enabled') === false) return res.status(403).json({ error: '暂未开放注册' });
      const configuredGift = Number(config.get('new_user_gift_amount'));
      const giftAmount = config.get('new_user_gift_enabled') === true
        && Number.isFinite(configuredGift) && configuredGift > 0 ? configuredGift : 0;
      const email = compatibleEmail(username, requestedEmail);
      const passwordHash = await identity.bcrypt.hash(password, 10);
      const user = await withTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended(lower($1),0))', [username]);
        const existing = await client.query('SELECT id FROM users WHERE username=$1 OR email=$2', [username, email]);
        const staffExisting = await client.query('SELECT id FROM staff_users WHERE username=$1 OR email=$2', [username, email]);
        if (existing.rows[0] || staffExisting.rows[0]) {
          const conflict = new Error('用户名或邮箱已被注册');
          conflict.status = 409;
          throw conflict;
        }
        const inserted = await client.query(`INSERT INTO users (username,email,password_hash,role,status)
          VALUES ($1,$2,$3,'user','active') RETURNING id,username,email,role,status`, [username, email, passwordHash]);
        await client.query(`INSERT INTO wallets (user_id,quota_balance,gift_quota,frozen_balance,total_spent)
          VALUES ($1,0,$2,0,0)`, [inserted.rows[0].id, giftAmount]);
        if (giftAmount > 0) {
          await client.query(`INSERT INTO wallet_transactions
            (transaction_key,user_id,transaction_type,balance_type,amount,balance_after,before_balance,after_balance,remark,metadata)
            VALUES ($1,$2,'gift','gift',$3,$4,0,$4,'新用户注册赠送',$5::jsonb)`, [
            `registration-gift:${inserted.rows[0].id}`, inserted.rows[0].id, giftAmount, giftAmount,
            JSON.stringify({ source: 'registration' }),
          ]);
        }
        return inserted.rows[0];
      });
      return res.status(201).json({
        message: '注册成功，登录中...',
        token: identity.generateToken(user),
        gift_amount: giftAmount,
        user: { id: user.id, username: user.username, email: publicEmail(user.email), role: user.role },
      });
    } catch (error) {
      if (error.status === 409 || error.code === '23505') return res.status(409).json({ error: '用户名或邮箱已被注册' });
      return next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    try {
      let accountTable = 'staff_users';
      let result = await pool.query(`SELECT id,username,email,password_hash,role,status
        FROM staff_users WHERE username=$1 OR email=$1`, [username]);
      if (!result.rows[0]) {
        accountTable = 'users';
        result = await pool.query(`SELECT id,username,email,password_hash,role,status
          FROM users WHERE username=$1 OR email=$1`, [username]);
      }
      const user = result.rows[0];
      if (!user || !(await identity.bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }
      if (user.status !== 'active') return res.status(403).json({ error: '账户已被禁用' });
      await pool.query(`UPDATE ${accountTable} SET updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [user.id]);
      return res.json({
        message: '登录成功', token: identity.generateToken(user),
        user: { id: user.id, username: user.username, email: publicEmail(user.email), role: user.role },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', identity.authenticate, async (req, res, next) => {
    try {
      const accountTable = req.user.role === 'user' ? 'users' : 'staff_users';
      const userSql = accountTable === 'users'
        ? `SELECT id,username,email,role,status,register_time,last_login_time FROM users WHERE id=$1`
        : `SELECT id,username,email,role,status,created_at AS register_time,updated_at AS last_login_time
          FROM staff_users WHERE id=$1`;
      const [userResult, walletResult] = await Promise.all([
        pool.query(userSql, [req.user.id]),
        accountTable === 'users'
          ? pool.query(`SELECT quota_balance,gift_quota,frozen_balance,total_spent FROM wallets WHERE user_id=$1`, [req.user.id])
          : Promise.resolve({ rows: [] }),
      ]);
      const user = userResult.rows[0];
      if (!user) return res.status(404).json({ error: '用户不存在' });
      const wallet = walletResult.rows[0] || { quota_balance: 0, gift_quota: 0, frozen_balance: 0, total_spent: 0 };
      return res.json({ user: { ...user, email: publicEmail(user.email) }, wallet });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/password', identity.authenticate, async (req, res, next) => {
    const oldPassword = String(req.body?.oldPassword ?? req.body?.old_password ?? '');
    const newPassword = String(req.body?.newPassword ?? req.body?.new_password ?? '');
    if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写旧密码和新密码' });
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
    try {
      const accountTable = req.user.role === 'user' ? 'users' : 'staff_users';
      const { rows } = await pool.query(`SELECT password_hash FROM ${accountTable} WHERE id=$1`, [req.user.id]);
      if (!rows[0] || !(await identity.bcrypt.compare(oldPassword, rows[0].password_hash))) {
        return res.status(400).json({ error: '旧密码错误' });
      }
      const passwordHash = await identity.bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE ${accountTable} SET password_hash=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [passwordHash, req.user.id]);
      return res.json({ message: '密码修改成功' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { compatibleEmail, createPostgresAuthRouter, jsonConfigValue, publicEmail };
