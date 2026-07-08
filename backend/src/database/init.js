const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/proxy.db';
let sqlDb = null;    // 原始 sql.js 实例
let db = null;       // 包装后的实例

// ========== 持久化保存 ==========
function saveDatabase() {
  if (sqlDb) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = sqlDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

// ========== 创建 Statement 包装 ==========
function makeStmt(sql) {
  return {
    get: (...params) => {
      try {
        const st = sqlDb.prepare(sql);
        if (params.length > 0) st.bind(params.flat());
        let result = null;
        if (st.step()) result = st.getAsObject();
        st.free();
        return result;
      } catch(e) { console.error('[SQL get]', sql, e.message); return null; }
    },
    all: (...params) => {
      try {
        const st = sqlDb.prepare(sql);
        if (params.length > 0) st.bind(params.flat());
        const results = [];
        while (st.step()) results.push(st.getAsObject());
        st.free();
        return results;
      } catch(e) { console.error('[SQL all]', sql, e.message); return []; }
    },
    run: (...params) => {
      try {
        const st = sqlDb.prepare(sql);
        if (params.length > 0) st.bind(params.flat());
        st.step();
        const changes = sqlDb.getRowsModified();
        st.free();
        let lastId = 0;
        try {
          const idSt = sqlDb.prepare('SELECT last_insert_rowid() as id');
          if (idSt.step()) lastId = idSt.getAsObject().id || 0;
          idSt.free();
        } catch(e) {}
        saveDatabase();
        return { changes, lastInsertRowid: lastId };
      } catch(e) { console.error('[SQL run]', sql, e.message); saveDatabase(); return { changes: 0, lastInsertRowid: 0 }; }
    }
  };
}

// ========== 包装数据库 ==========
function wrapDb() {
  return {
    exec: (sql) => { sqlDb.run(sql); saveDatabase(); return null; },
    pragma: (sql) => { sqlDb.run('PRAGMA ' + sql); saveDatabase(); },
    prepare: (sql) => makeStmt(sql)
  };
}

function getDatabase() {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return db;
}

// ========== 创建所有表 ==========
function createTables() {
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
      phone TEXT, password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin','operator','finance')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled','banned')),
      user_group_id INTEGER DEFAULT 1, register_ip TEXT, last_login_ip TEXT,
      last_login_time DATETIME, register_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
    recharge_balance REAL DEFAULT 0, gift_balance REAL DEFAULT 0,
    quota_balance REAL DEFAULT 0, gift_quota REAL DEFAULT 0,
    frozen_balance REAL DEFAULT 0, total_spent REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  // 旧数据库迁移：添加 quota_balance 与 gift_quota 列
  try { sqlDb.run('ALTER TABLE wallets ADD COLUMN quota_balance REAL DEFAULT 0'); } catch(e) { /* 列已存在 */ }
  try { sqlDb.run('ALTER TABLE wallets ADD COLUMN gift_quota REAL DEFAULT 0'); } catch(e) { /* 列已存在 */ }
  // 将旧 recharge_balance/gift_balance 同步到新字段
  try { sqlDb.run('UPDATE wallets SET quota_balance = recharge_balance WHERE quota_balance = 0 AND recharge_balance > 0'); } catch(e) { /* 忽略 */ }
  try { sqlDb.run('UPDATE wallets SET gift_quota = gift_balance WHERE gift_quota = 0 AND gift_balance > 0'); } catch(e) { /* 忽略 */ }

  sqlDb.run(`CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('purchase','gift','consume','refund','manual_add','manual_deduct','freeze','unfreeze','recharge')),
    balance_type TEXT NOT NULL CHECK(balance_type IN ('quota','gift_quota','frozen','recharge','gift')),
    amount REAL NOT NULL, before_balance REAL, after_balance REAL,
    related_order_id INTEGER, related_request_id TEXT, remark TEXT,
    operator_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_wt_user ON wallet_transactions(user_id)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_wt_created ON wallet_transactions(created_at)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS quota_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL, amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'manual_transfer',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','granted','cancelled','abnormal')),
    payment_proof TEXT, admin_remark TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, paid_at DATETIME, granted_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_qo_user ON quota_orders(user_id)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_qo_status ON quota_orders(status)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT, model_code TEXT UNIQUE NOT NULL,
    model_name TEXT NOT NULL, upstream_model_name TEXT,
    model_type TEXT DEFAULT 'llm' CHECK(model_type IN ('llm','embedding','image','audio','video')),
    context_length INTEGER DEFAULT 4096, is_multimodal INTEGER DEFAULT 0,
    description TEXT, base_input_price REAL DEFAULT 0, base_output_price REAL DEFAULT 0,
    display_multiplier_input REAL DEFAULT 1.0, display_multiplier_output REAL DEFAULT 1.0,
    billing_multiplier_input REAL DEFAULT 1.0, billing_multiplier_output REAL DEFAULT 1.0,
    channel_id INTEGER REFERENCES upstream_channels(id),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance')),
    sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_models_channel ON models(channel_id)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rule_name TEXT NOT NULL, model_code TEXT,
    scope_type TEXT DEFAULT 'platform' CHECK(scope_type IN ('platform','user_group','user','api_key')),
    scope_id INTEGER, display_multiplier_input REAL DEFAULT 1.0, display_multiplier_output REAL DEFAULT 1.0,
    billing_multiplier_input REAL DEFAULT 1.0, billing_multiplier_output REAL DEFAULT 1.0,
    priority INTEGER DEFAULT 0, start_time DATETIME, end_time DATETIME,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  sqlDb.run(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    key_name TEXT, key_hash TEXT UNIQUE NOT NULL, key_prefix TEXT NOT NULL,
    key_encrypted TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled','revoked')),
    rate_limit_per_min INTEGER DEFAULT 60, max_spend_limit REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expired_at DATETIME, last_used_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_ak_user ON api_keys(user_id)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_ak_hash ON api_keys(key_hash)');
  // 迁移：为已有 api_keys 表添加 key_encrypted 列
  try { sqlDb.run('ALTER TABLE api_keys ADD COLUMN key_encrypted TEXT'); } catch(e) { /* 列已存在，忽略 */ }

  sqlDb.run(`CREATE TABLE IF NOT EXISTS api_key_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, api_key_id INTEGER NOT NULL,
    model_code TEXT NOT NULL, status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
    UNIQUE(api_key_id, model_code)
  )`);

  sqlDb.run(`CREATE TABLE IF NOT EXISTS api_request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL,
    user_id INTEGER, api_key_id INTEGER, model_code TEXT, upstream_channel_id INTEGER,
    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0, status TEXT DEFAULT 'pending' CHECK(status IN ('success','failed','blocked')),
    error_message TEXT, error_type TEXT, request_ip TEXT, latency_ms INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_arl_user ON api_request_logs(user_id)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_arl_created ON api_request_logs(created_at)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS upstream_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel_name TEXT NOT NULL,
    base_url TEXT NOT NULL, api_key TEXT NOT NULL, model_mapping TEXT,
    priority INTEGER DEFAULT 0, weight INTEGER DEFAULT 100,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','error')),
    health_score REAL DEFAULT 100, last_check_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  sqlDb.run(`CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, config_key TEXT UNIQUE NOT NULL,
    config_value TEXT, description TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 默认配置
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('registration_enabled', 'true', '是否开放注册')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('new_user_gift_amount', '1.00', '新用户赠送金额')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('new_user_gift_enabled', 'true', '是否开启新用户赠送')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('default_rate_limit', '60', '默认每分钟限速')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('platform_name', '11AiLabs', '平台名称')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('platform_announcement', '欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数', '平台公告')");
  // 确保公告始终为最新
  sqlDb.run("UPDATE system_config SET config_value='欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数' WHERE config_key='platform_announcement' AND config_value!='欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数'");

  sqlDb.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL,
    target_type TEXT, target_id TEXT, detail TEXT, ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function initDatabase() {
  const SQL = await initSqlJs();

  // 如果已有数据库文件，读取它
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  // 创建表
  createTables();
  saveDatabase();

  // 包装 API
  db = wrapDb();
  console.log('✅ 数据库初始化完成');
  return db;
}

module.exports = { getDatabase, initDatabase, saveDatabase };
