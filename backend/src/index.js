require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initDatabase, getDatabase } = require('./database/init');
const logger = require('./utils/logger');
const os = require('os');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const proxyRoutes = require('./routes/proxy');
const publicRoutes = require('./routes/public');
const paymentRoutes = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const startTime = Date.now();

// 生产环境：信任反向代理
if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP 请求日志：开发环境 → 控制台，生产环境 → access.log 文件
app.use(morgan(isProduction ? 'combined' : 'dev', {
  stream: isProduction ? logger.accessLogStream : process.stdout
}));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { error: '请求过于频繁，请稍后再试' } });
app.use('/api/', globalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/v1', proxyRoutes);

// ========== 健康检查（优化版） ==========
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  let dbStatus = 'ok';
  let dbSize = 0;
  const fs = require('fs');
  const dbPath = process.env.DB_PATH || './data/proxy.db';
  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();  // 快速连接测试
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      dbSize = stat.size;
    }
  } catch (e) {
    dbStatus = 'error';
    logger.error('健康检查 — 数据库异常', { error: e.message });
  }
  const overallStatus = dbStatus === 'ok' ? 'ok' : 'degraded';
  const httpCode = overallStatus === 'ok' ? 200 : 503;
  res.status(httpCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    uptimeFormatted: `${Math.floor(uptime/86400)}d ${Math.floor(uptime%86400/3600)}h ${Math.floor(uptime%3600/60)}m ${Math.floor(uptime%60)}s`,
    memory: {
      rss: `${(mem.rss/1024/1024).toFixed(1)} MB`,
      heapUsed: `${(mem.heapUsed/1024/1024).toFixed(1)} MB`,
      heapTotal: `${(mem.heapTotal/1024/1024).toFixed(1)} MB`
    },
    cpu: {
      loadavg: os.loadavg(),
      cpus: os.cpus().length
    },
    database: {
      status: dbStatus,
      size: `${(dbSize/1024/1024).toFixed(2)} MB`,
      path: dbPath
    },
    environment: isProduction ? 'production' : 'development',
    nodeVersion: process.version,
    pid: process.pid
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error(`[GlobalError] ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误', code: err.code || 'INTERNAL_ERROR' });
});

async function start() {
  await initDatabase();
  // 默认密码安全检查
  try {
    const bcrypt = require('bcryptjs');
    const db = getDatabase();
    const users = db.prepare("SELECT username, password_hash FROM users WHERE username IN ('admin','testuser')").all();
    const defaults = { admin: 'admin123', testuser: 'user123' };
    const warnings = [];
    for (const u of users) {
      if (defaults[u.username] && bcrypt.compareSync(defaults[u.username], u.password_hash)) {
        const msg = `${u.username} 仍在使用默认密码 ${defaults[u.username]}`;
        warnings.push(msg);
        logger.warn(`默认密码未修改: ${msg}`);
      }
    }
    if (warnings.length > 0) {
      console.error('\n' + '='.repeat(60));
      console.error('🔴 安全警告 — 以下账号使用默认密码：');
      warnings.forEach(w => console.error(`   • ${w}`));
      console.error('   请在管理后台或通过 API 立即修改密码！');
      console.error('='.repeat(60) + '\n');
      if (isProduction) {
        logger.error(`生产环境检测到 ${warnings.length} 个默认密码未修改`);
      }
    }
  } catch(e) { /* 非致命 */ }
  // 启动上游渠道健康检查
  try { const { startHealthCheck } = require('./utils/channel-selector'); startHealthCheck(getDatabase()); } catch(e) { console.error('[健康检查启动失败]', e.message); }
  // 官方价格每周同步；美元汇率每日同步。失败时保留最近一次成功数据。
  try { const { startPricingSchedules } = require('./utils/pricing-sync'); startPricingSchedules(getDatabase()); } catch(e) { console.error('[计费同步启动失败]', e.message); }
  app.listen(PORT, () => {
    logger.info(`11AiLabs 已启动 — 端口: ${PORT}, 环境: ${isProduction ? 'production' : 'development'}`);
    console.log(`\n🚀 11AiLabs 已启动: http://localhost:${PORT}`);
    console.log(`📡 代理端点: http://localhost:${PORT}/v1/chat/completions`);
    console.log(`🌍 运行环境: ${isProduction ? 'production' : 'development'}`);
    console.log(`📋 日志目录: ./logs/\n`);
  });
}
start().catch(e => {
  logger.error('启动失败', { error: e.message, stack: e.stack });
  console.error(e);
});
module.exports = app;

// 定时自动保存数据库（每 30 秒）
const { saveDatabase } = require('./database/init');
setInterval(() => {
  try { saveDatabase(); } catch(e) { logger.error('自动保存数据库失败', { error: e.message }); }
}, 30000);

// 进程退出时保存
process.on('SIGINT', () => { saveDatabase(); process.exit(); });
process.on('SIGTERM', () => { saveDatabase(); process.exit(); });

// 未捕获异常
process.on('uncaughtException', (err) => {
  logger.error(`未捕获异常: ${err.message}`, { stack: err.stack });
  console.error(err);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`未处理的 Promise 拒绝: ${reason}`);
  console.error(reason);
});
