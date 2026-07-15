const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

function migrateRoutingGroups(database = db) {
  if (!database) throw new Error('数据库未初始化');

  return database.transaction(() => {
    const channels = database.prepare(`
      SELECT id,channel_name,priority,weight,status FROM upstream_channels ORDER BY id ASC
    `).all();

    for (const channel of channels) {
      let group = database.prepare('SELECT id FROM routing_groups WHERE legacy_channel_id=?').get(channel.id);
      if (!group) {
        const sameName = database.prepare('SELECT id FROM routing_groups WHERE group_name=?').get(channel.channel_name);
        const groupName = sameName ? `${channel.channel_name}（迁移 ${channel.id}）` : channel.channel_name;
        const result = database.prepare(`
          INSERT INTO routing_groups (group_name,description,status,legacy_channel_id)
          VALUES (?,?,?,?)
        `).run(groupName, '由原渠道自动迁移', channel.status === 'active' ? 'active' : 'inactive', channel.id);
        group = { id: result.lastInsertRowid };
      }
      database.prepare(`
        INSERT OR IGNORE INTO routing_group_channels
          (group_id,channel_id,priority,weight,status)
        VALUES (?,?,?,?,?)
      `).run(group.id, channel.id, channel.priority ?? 0, channel.weight ?? 100,
        channel.status === 'active' ? 'active' : 'inactive');
    }

    const legacyModels = database.prepare(`
      SELECT model_code,upstream_model_name,channel_id,status
      FROM models WHERE channel_id IS NOT NULL
    `).all();
    for (const model of legacyModels) {
      database.prepare(`
        INSERT OR IGNORE INTO channel_models
          (channel_id,model_code,upstream_model_name,status)
        VALUES (?,?,?,?)
      `).run(model.channel_id, model.model_code,
        model.upstream_model_name || model.model_code,
        model.status === 'active' ? 'active' : 'inactive');
    }

    const unassignedKeys = database.prepare(`
      SELECT id FROM api_keys WHERE routing_group_id IS NULL ORDER BY id ASC
    `).all();
    for (const apiKey of unassignedKeys) {
      const channelRows = database.prepare(`
        SELECT DISTINCT m.channel_id
        FROM api_key_permissions p
        JOIN models m ON m.model_code=p.model_code
        WHERE p.api_key_id=? AND p.status='active' AND m.channel_id IS NOT NULL
        ORDER BY m.channel_id ASC
      `).all(apiKey.id);
      if (channelRows.length === 0) continue;

      let groupId;
      if (channelRows.length === 1) {
        groupId = database.prepare('SELECT id FROM routing_groups WHERE legacy_channel_id=?')
          .get(channelRows[0].channel_id)?.id;
      } else {
        const groupName = `兼容分组（旧 Key ${apiKey.id}）`;
        let group = database.prepare('SELECT id FROM routing_groups WHERE group_name=?').get(groupName);
        if (!group) {
          const created = database.prepare(`
            INSERT INTO routing_groups (group_name,description,status)
            VALUES (?,?,'active')
          `).run(groupName, '为跨渠道旧 Key 自动创建');
          group = { id: created.lastInsertRowid };
        }
        groupId = group.id;
        for (const row of channelRows) {
          const channel = channels.find(item => item.id === row.channel_id);
          database.prepare(`
            INSERT OR IGNORE INTO routing_group_channels
              (group_id,channel_id,priority,weight,status)
            VALUES (?,?,?,?,?)
          `).run(groupId, row.channel_id, channel?.priority ?? 0, channel?.weight ?? 100, 'active');
        }
      }
      if (groupId) {
        database.prepare('UPDATE api_keys SET routing_group_id=? WHERE id=?').run(groupId, apiKey.id);
      }
    }
  });
}

const DB_PATH = process.env.DB_PATH || './data/proxy.db';
let sqlDb = null;    // 原始 sql.js 实例
let db = null;       // 包装后的实例
let transactionDepth = 0;

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
      } catch(e) {
        if (transactionDepth > 0) throw e;
        logger.error(`[SQL get] ${e.message}`, { sql });
        return null;
      }
    },
    all: (...params) => {
      try {
        const st = sqlDb.prepare(sql);
        if (params.length > 0) st.bind(params.flat());
        const results = [];
        while (st.step()) results.push(st.getAsObject());
        st.free();
        return results;
      } catch(e) {
        if (transactionDepth > 0) throw e;
        console.error('[SQL all]', sql, e.message);
        return [];
      }
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
        if (transactionDepth === 0) saveDatabase();
        return { changes, lastInsertRowid: lastId };
      } catch(e) {
        if (transactionDepth > 0) throw e;
        console.error('[SQL run]', sql, e.message);
        saveDatabase();
        return { changes: 0, lastInsertRowid: 0 };
      }
    }
  };
}

// ========== 包装数据库 ==========
function wrapDb() {
  return {
    exec: (sql) => { sqlDb.run(sql); saveDatabase(); return null; },
    pragma: (sql) => { sqlDb.run('PRAGMA ' + sql); saveDatabase(); },
    prepare: (sql) => makeStmt(sql),
    transaction: (work) => {
      if (transactionDepth > 0) return work();
      transactionDepth = 1;
      sqlDb.run('BEGIN IMMEDIATE');
      try {
        const result = work();
        if (result && typeof result.then === 'function') throw new Error('数据库事务不支持异步回调');
        sqlDb.run('COMMIT');
        saveDatabase();
        return result;
      } catch (error) {
        try { sqlDb.run('ROLLBACK'); } catch (rollbackError) { logger.error('数据库事务回滚失败', { error: rollbackError.message }); }
        throw error;
      } finally {
        transactionDepth = 0;
      }
    }
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
  // 官方价格快照：仅用于用户侧公开定价与点数扣费，和渠道实际成本分离。
  try { sqlDb.run("ALTER TABLE models ADD COLUMN official_provider TEXT DEFAULT 'manual'"); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_model_id TEXT'); } catch(e) {}
  try { sqlDb.run("ALTER TABLE models ADD COLUMN official_currency TEXT DEFAULT 'CNY'"); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_input_price REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_output_price REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_cached_input_price REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_unit_tokens INTEGER DEFAULT 1000000'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_price_source TEXT'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE models ADD COLUMN official_price_updated_at DATETIME'); } catch(e) {}
  try { sqlDb.run("ALTER TABLE models ADD COLUMN official_pricing_mode TEXT DEFAULT 'auto'"); } catch(e) {}

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
    permission_mode TEXT DEFAULT 'legacy' CHECK(permission_mode IN ('legacy','group_dynamic')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','disabled','revoked')),
    rate_limit_per_min INTEGER DEFAULT 60, max_spend_limit REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expired_at DATETIME, last_used_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_ak_user ON api_keys(user_id)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_ak_hash ON api_keys(key_hash)');
  // 迁移：为已有 api_keys 表添加 key_encrypted 列
  try { sqlDb.run('ALTER TABLE api_keys ADD COLUMN key_encrypted TEXT'); } catch(e) { /* 列已存在，忽略 */ }
  try { sqlDb.run('ALTER TABLE api_keys ADD COLUMN routing_group_id INTEGER REFERENCES routing_groups(id)'); } catch(e) {}
  try { sqlDb.run("ALTER TABLE api_keys ADD COLUMN permission_mode TEXT DEFAULT 'legacy'"); } catch(e) {}

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
  // 每次调用固化当时的定价与汇率，后续官方调价不会改写历史账单。
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN cached_input_tokens INTEGER DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_provider TEXT'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_currency TEXT'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_input_price REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_output_price REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_cached_input_price REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_unit_tokens INTEGER DEFAULT 1000000'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN usd_cny_rate REAL DEFAULT 1'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN billing_multiplier_input REAL DEFAULT 1'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN billing_multiplier_output REAL DEFAULT 1'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN official_cost_cny REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN channel_cost_cny REAL DEFAULT 0'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE api_request_logs ADD COLUMN profit_cny REAL DEFAULT 0'); } catch(e) {}

  sqlDb.run(`CREATE TABLE IF NOT EXISTS upstream_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel_name TEXT NOT NULL,
    base_url TEXT NOT NULL, api_key TEXT NOT NULL, model_mapping TEXT,
    priority INTEGER DEFAULT 0, weight INTEGER DEFAULT 100,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','error')),
    health_score REAL DEFAULT 100, last_check_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // 健康检查 & 熔断字段（兼容已有数据库）
  try { sqlDb.run("ALTER TABLE upstream_channels ADD COLUMN failure_count INTEGER DEFAULT 0"); } catch(e) {}
  try { sqlDb.run("ALTER TABLE upstream_channels ADD COLUMN circuit_breaker_until DATETIME"); } catch(e) {}
  try { sqlDb.run("ALTER TABLE upstream_channels ADD COLUMN consecutive_failures INTEGER DEFAULT 0"); } catch(e) {}
  try { sqlDb.run("ALTER TABLE upstream_channels ADD COLUMN total_requests INTEGER DEFAULT 0"); } catch(e) {}
  try { sqlDb.run("ALTER TABLE upstream_channels ADD COLUMN total_successes INTEGER DEFAULT 0"); } catch(e) {}
  try { sqlDb.run("ALTER TABLE upstream_channels ADD COLUMN protocol_type TEXT DEFAULT 'openai_compatible'"); } catch(e) {}

  sqlDb.run(`CREATE TABLE IF NOT EXISTS routing_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT UNIQUE NOT NULL,
    description TEXT,
    protocol_type TEXT DEFAULT 'openai_compatible',
    restrict_models INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    fallback_group_id INTEGER REFERENCES routing_groups(id),
    legacy_channel_id INTEGER UNIQUE REFERENCES upstream_channels(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { sqlDb.run('ALTER TABLE routing_groups ADD COLUMN restrict_models INTEGER DEFAULT 0'); } catch(e) {}

  sqlDb.run(`CREATE TABLE IF NOT EXISTS routing_group_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES routing_groups(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES upstream_channels(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    weight INTEGER DEFAULT 100,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id,channel_id)
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_rgc_group ON routing_group_channels(group_id)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_rgc_channel ON routing_group_channels(channel_id)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS channel_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES upstream_channels(id) ON DELETE CASCADE,
    model_code TEXT NOT NULL REFERENCES models(model_code) ON DELETE CASCADE,
    upstream_model_name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id,model_code)
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_cm_model ON channel_models(model_code)');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS routing_group_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES routing_groups(id) ON DELETE CASCADE,
    model_code TEXT NOT NULL REFERENCES models(model_code) ON DELETE CASCADE,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id,model_code)
  )`);
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_rgm_group ON routing_group_models(group_id)');

  // 渠道成本不参与产品计费，也不在管理端展示；旧表会在首次迁移时删除。

  sqlDb.run(`CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, config_key TEXT UNIQUE NOT NULL,
    config_value TEXT, description TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 旧字段只做一次性废弃迁移。早期版本已经把余额复制到 quota/gift 字段；
  // 绝不能在每次重启时按“新余额为 0”回填，否则会把已扣完的点数恢复出来。
  const walletMigration = sqlDb.exec("SELECT config_value FROM system_config WHERE config_key='wallet_balance_columns_retired_v1'");
  if (walletMigration[0]?.values?.[0]?.[0] !== 'done') {
    sqlDb.run('BEGIN IMMEDIATE');
    try {
      sqlDb.run('UPDATE wallets SET recharge_balance=0, gift_balance=0 WHERE recharge_balance<>0 OR gift_balance<>0');
      sqlDb.run("INSERT OR REPLACE INTO system_config (config_key,config_value,description,updated_at) VALUES ('wallet_balance_columns_retired_v1','done','旧钱包余额字段已停用，防止重启回填已扣余额',CURRENT_TIMESTAMP)");
      sqlDb.run('COMMIT');
    } catch (error) {
      try { sqlDb.run('ROLLBACK'); } catch (rollbackError) { logger.error('旧钱包字段迁移回滚失败', { error: rollbackError.message }); }
      throw error;
    }
  }

  // 默认配置
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('registration_enabled', 'true', '是否开放注册')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('new_user_gift_amount', '1.00', '新用户赠送金额')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('new_user_gift_enabled', 'true', '是否开启新用户赠送')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('default_rate_limit', '60', '默认每分钟限速')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('platform_name', '11AiLabs', '平台名称')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('platform_announcement', '欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数', '平台公告')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('usd_cny_exchange_rate', '7', '美元兑人民币汇率；1点=1人民币')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('usd_cny_rate_updated_at', '', '美元兑人民币汇率最近更新时间')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('official_pricing_last_sync_at', '', '官方价格最近同步时间')");
  sqlDb.run("INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES ('official_pricing_last_sync_status', 'never', '官方价格最近同步状态')");
  // 确保公告始终为最新
  sqlDb.run("UPDATE system_config SET config_value='欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数' WHERE config_key='platform_announcement' AND config_value!='欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数'");
  // 历史上的“展示倍率”现在就是唯一的用户扣费倍率，确保规则保存后立即生效。
  sqlDb.run('UPDATE models SET billing_multiplier_input=display_multiplier_input, billing_multiplier_output=display_multiplier_output');
  sqlDb.run('UPDATE pricing_rules SET billing_multiplier_input=display_multiplier_input, billing_multiplier_output=display_multiplier_output');
  // API Key/用户组规则无法在通用用户模型页准确展示，停用后保证“看到的倍率=实际倍率”。
  sqlDb.run("UPDATE pricing_rules SET status='inactive' WHERE scope_type IN ('api_key','user_group') AND status='active'");
  sqlDb.run("UPDATE pricing_rules SET model_code=NULL WHERE model_code IS NOT NULL AND trim(model_code)='' ");
  // 不再删除非官方渠道；自定义 OpenAI 兼容渠道与模型是正式能力。

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
  const routingMigration = db.prepare("SELECT config_value FROM system_config WHERE config_key='routing_groups_v1'").get();
  if (routingMigration?.config_value !== 'done') {
    migrateRoutingGroups(db);
    db.prepare(`INSERT OR REPLACE INTO system_config
      (config_key,config_value,description,updated_at)
      VALUES ('routing_groups_v1','done','旧渠道、模型与 API Key 已迁移到路由分组',CURRENT_TIMESTAMP)`).run();
  }
  console.log('✅ 数据库初始化完成');
  return db;
}

module.exports = { getDatabase, initDatabase, saveDatabase, migrateRoutingGroups };
