// 生成测试用户 + 90天大量随机调用数据
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { initDatabase, getDatabase, saveDatabase } = require('./init');
const bcrypt = require('bcryptjs');

const MODELS = ['gpt-4o-mini','gpt-4o','gpt-3.5-turbo','deepseek-chat','claude-3.5-sonnet','gemini-2.0-flash','qwen-plus','glm-4-flash'];
const CHANNELS = { 'gpt-4o-mini':1,'gpt-4o':1,'gpt-3.5-turbo':1,'deepseek-chat':2,'claude-3.5-sonnet':3,'gemini-2.0-flash':4,'qwen-plus':5,'glm-4-flash':6 };

async function seed() {
  await initDatabase();
  const db = getDatabase();

  const hash = bcrypt.hashSync('viewer123', 10);
  const existing = db.prepare("SELECT id FROM users WHERE username='viewer'").get();
  let userId;
  if (existing) { userId = existing.id; } else {
    db.prepare("INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)").run('viewer','viewer@11ailabs.com',hash,'user','active');
    userId = db.prepare("SELECT id FROM users WHERE username='viewer'").get().id;
    db.prepare("INSERT OR IGNORE INTO wallets (user_id,quota_balance,gift_quota,total_spent) VALUES (?,?,?,?)").run(userId, 500.0, 20.0, 0);
    console.log('创建用户 viewer / viewer123, id:', userId);
  }

  const { v4: uuidv4 } = require('uuid');
  const ak = db.prepare("SELECT id FROM api_keys WHERE user_id=? AND status='active'").get(userId);
  let apiKeyId;
  if (ak) { apiKeyId = ak.id; } else {
    const keyRaw = 'sk-' + uuidv4().replace(/-/g, '');
    const hash = bcrypt.hashSync(keyRaw, 10);
    const r = db.prepare("INSERT INTO api_keys (user_id,key_name,key_hash,key_prefix,status) VALUES (?,?,?,?,?)").run(userId, '测试密钥', hash, keyRaw.substring(0,12), 'active');
    apiKeyId = r.lastInsertRowid;
    for (const m of MODELS) db.prepare("INSERT OR IGNORE INTO api_key_permissions (api_key_id,model_code) VALUES (?,?)").run(apiKeyId, m);
  }

  // 清旧数据
  db.prepare("DELETE FROM api_request_logs WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM wallet_transactions WHERE user_id=?").run(userId);

  // 重置钱包余额到 500
  db.prepare("UPDATE wallets SET quota_balance=500, gift_quota=20, total_spent=0 WHERE user_id=?").run(userId);

  const now = new Date();
  let totalCost = 0;
  const DAYS = 90;
  const totalRecords = [];

  for (let day = DAYS - 1; day >= 0; day--) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    const calls = 30 + Math.floor(Math.random() * 50); // 30-80 per day
    for (let c = 0; c < calls; c++) {
      const model = MODELS[Math.floor(Math.random() * MODELS.length)];
      const h = 7 + Math.floor(Math.random() * 16); const m = Math.floor(Math.random() * 60); const s = Math.floor(Math.random() * 60);
      date.setHours(h, m, s);
      const inputTokens = 500 + Math.floor(Math.random() * 15000);
      const outputTokens = 200 + Math.floor(Math.random() * 8000);
      const cost = (inputTokens/1000 * 0.002) + (outputTokens/1000 * 0.008);
      const r = Math.random();
      const status = r > 0.94 ? 'failed' : r > 0.88 ? 'blocked' : 'success';
      const requestId = 'req_' + Math.random().toString(36).substring(2, 18);
      totalRecords.push([
        requestId, userId, apiKeyId, model, CHANNELS[model]||1,
        inputTokens, outputTokens, parseFloat(cost.toFixed(6)), status,
        status==='failed'?'upstream timeout':status==='blocked'?'balance insufficient':null,
        '127.0.0.1', 150 + Math.floor(Math.random()*5000),
        date.toISOString().replace('T',' ').substring(0,19)
      ]);
      if (status==='success') totalCost += cost;
    }
  }

  // 批量插入
  const insert = db.prepare("INSERT INTO api_request_logs (request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,output_tokens,total_cost,status,error_message,request_ip,latency_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const row of totalRecords) insert.run(...row);

  db.prepare("UPDATE wallets SET total_spent=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(parseFloat(totalCost.toFixed(4)), userId);
  db.prepare("UPDATE api_keys SET last_used_at=(SELECT MAX(created_at) FROM api_request_logs WHERE api_key_id=api_keys.id AND user_id=?) WHERE user_id=? AND status='active'").run(userId, userId);
  saveDatabase();

  const count = db.prepare("SELECT COUNT(*) as c FROM api_request_logs WHERE user_id=?").get(userId);
  console.log(`✅ 生成 ${count.c} 条调用记录, 90天跨度, 累计消费 ${totalCost.toFixed(2)} 点`);
  console.log('🎉 测试数据完成！账号: viewer / viewer123');
}

seed().catch(e => { console.error(e); process.exit(1); });
