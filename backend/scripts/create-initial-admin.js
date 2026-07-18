require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { initDatabase, getDatabase, saveDatabase } = require('../src/database/init');

async function main() {
  const username = String(process.env.INITIAL_ADMIN_USERNAME || '').trim();
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) throw new Error('INITIAL_ADMIN_USERNAME 必须为 3-32 位字母、数字、下划线或短横线');
  if (password.length < 12) throw new Error('INITIAL_ADMIN_PASSWORD 至少需要 12 位');

  await initDatabase();
  const db = getDatabase();
  const existingUsers = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0);
  if (existingUsers !== 0) throw new Error(`数据库已有 ${existingUsers} 个用户，拒绝执行首次管理员初始化`);

  db.prepare("INSERT INTO users (username,password_hash,role,status) VALUES (?,?,'admin','active')")
    .run(username, bcrypt.hashSync(password, 12));
  saveDatabase();
  console.log(`首次管理员已创建：${username}（未创建钱包或 API Key）`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
