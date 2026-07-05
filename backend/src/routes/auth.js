const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { authenticate, generateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.post('/register', (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 3 || username.length > 32) return res.status(400).json({ error: '用户名长度 3-32 字符' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const db = getDatabase();

  const regConfig = db.prepare("SELECT config_value FROM system_config WHERE config_key='registration_enabled'").get();
  if (regConfig && regConfig.config_value === 'false') return res.status(403).json({ error: '暂未开放注册' });

  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email||'');
  if (existing) return res.status(409).json({ error: '用户名或邮箱已被注册' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const registerIp = req.ip || '127.0.0.1';
  const result = db.prepare("INSERT INTO users (username,email,password_hash,role,status,register_ip,last_login_ip,last_login_time) VALUES (?,?,?,'user','active',?,?,CURRENT_TIMESTAMP)").run(username, email||null, passwordHash, registerIp, registerIp);
  const userId = result.lastInsertRowid;

  db.prepare('INSERT INTO wallets (user_id, recharge_balance, gift_balance) VALUES (?,0,0)').run(userId);

  const giftEnabled = db.prepare("SELECT config_value FROM system_config WHERE config_key='new_user_gift_enabled'").get();
  const giftAmount = db.prepare("SELECT config_value FROM system_config WHERE config_key='new_user_gift_amount'").get();
  let giftGiven = 0;
  if (giftEnabled && giftEnabled.config_value === 'true' && giftAmount) {
    const amount = parseFloat(giftAmount.config_value);
    if (amount > 0) {
      db.prepare('UPDATE wallets SET gift_balance=? WHERE user_id=?').run(amount, userId);
      db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,remark) VALUES (?,'gift','gift',?,0,?,'新用户注册赠送')").run(userId, amount, amount);
      giftGiven = amount;
    }
  }

  const keyRaw = 'sk-' + uuidv4().replace(/-/g, '');
  const keyHash = bcrypt.hashSync(keyRaw, 10);
  const keyPrefix = keyRaw.substring(0, 12);
  const keyResult = db.prepare("INSERT INTO api_keys (user_id,key_name,key_hash,key_prefix,status) VALUES (?,'默认密钥',?,?,'active')").run(userId, keyHash, keyPrefix);
  const activeModels = db.prepare("SELECT model_code FROM models WHERE status='active'").all();
  const insertPerm = db.prepare('INSERT OR IGNORE INTO api_key_permissions (api_key_id,model_code) VALUES (?,?)');
  for (const m of activeModels) insertPerm.run(keyResult.lastInsertRowid, m.model_code);

  const token = generateToken({ id: userId, username, role: 'user' });
  res.status(201).json({ message: '注册成功', token, gift_amount: giftGiven, api_key: keyRaw, user: { id: userId, username, email: email||null, role: 'user' } });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(username, username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  if (user.status !== 'active') return res.status(403).json({ error: '账户已被禁用' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });
  const loginIp = req.ip || '127.0.0.1';
  db.prepare('UPDATE users SET last_login_ip=?, last_login_time=CURRENT_TIMESTAMP WHERE id=?').run(loginIp, user.id);
  const token = generateToken(user);
  res.json({ message: '登录成功', token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

router.get('/me', authenticate, (req, res) => {
  const db = getDatabase();
  const user = db.prepare('SELECT id,username,email,phone,role,status,register_time,last_login_time FROM users WHERE id=?').get(req.user.id);
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(req.user.id);
  res.json({ user, wallet: wallet || { recharge_balance: 0, gift_balance: 0, frozen_balance: 0 } });
});

router.put('/password', authenticate, (req, res) => {
  const { old_password, new_password } = req.body;
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(old_password, user.password_hash)) return res.status(400).json({ error: '原密码错误' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ message: '密码修改成功' });
});

module.exports = router;
