require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initDatabase, getDatabase } = require('./database/init');
const { createApplicationRuntime } = require('./runtime/services');
const { createBootstrapRouter, createRuntimeBootstrapAuthenticate } = require('./routes/bootstrap');
const { createRuntimeRouter } = require('./routes/runtime-router');
const { createPostgresAuthRouter } = require('./routes/postgres-auth');
const { createPostgresUserRouter } = require('./routes/postgres-user');
const { createPostgresAdminRouter } = require('./routes/postgres-admin');
const { createPostgresPublicRouter } = require('./routes/postgres-public');
const { createPostgresPaymentRouter } = require('./routes/postgres-payment');
const { createPostgresProxyRouter } = require('./routes/postgres-proxy');
const { createPostgresPaymentService } = require('./modules/postgres-payment');
const { authenticate, requireAdmin } = require('./middleware/auth');
const logger = require('./utils/logger');
const os = require('os');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const proxyRoutes = require('./routes/proxy');
const publicRoutes = require('./routes/public');
const paymentRoutes = require('./routes/payment');
const { shouldSkipAccessLog } = require('./utils/access-log');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const startTime = Date.now();
let applicationRuntime = null;
let httpServer = null;
const postgresRouters = {
  auth: null,
  user: null,
  admin: null,
  public: null,
  payment: null,
  proxy: null,
};

function runtimeService(name) {
  return new Proxy({}, {
    get(_target, property) {
      return (...args) => {
        const service = applicationRuntime?.[name];
        if (!service || typeof service[property] !== 'function') {
          const error = new Error(`${name} service is not ready`);
          error.status = 503;
          error.code = 'SERVICE_NOT_READY';
          throw error;
        }
        return service[property](...args);
      };
    },
  });
}

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
  stream: isProduction ? logger.accessLogStream : process.stdout,
  skip: shouldSkipAccessLog,
}));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { error: '请求过于频繁，请稍后再试' } });
app.use('/api/', globalLimiter);

const bootstrapAuthenticate = createRuntimeBootstrapAuthenticate({
  getRuntime: () => applicationRuntime,
  legacyAuthenticate: authenticate,
});

app.use('/api', createBootstrapRouter({
  authenticate: bootstrapAuthenticate,
  requireUser: (req, res, next) => req.user?.role === 'user'
    ? next()
    : res.status(403).json({ error: '仅普通用户可访问' }),
  requireAdmin,
  dashboardReadModel: runtimeService('dashboardReadModel'),
  controlPlane: runtimeService('controlPlane'),
  logger,
}));

app.use('/api/auth', createRuntimeRouter({ legacyRouter: authRoutes, getPostgresRouter: () => postgresRouters.auth }));
app.use('/api/user', createRuntimeRouter({ legacyRouter: userRoutes, getPostgresRouter: () => postgresRouters.user }));
app.use('/api/admin', createRuntimeRouter({ legacyRouter: adminRoutes, getPostgresRouter: () => postgresRouters.admin }));
app.use('/api/public', createRuntimeRouter({ legacyRouter: publicRoutes, getPostgresRouter: () => postgresRouters.public }));
app.use('/api/payment', createRuntimeRouter({ legacyRouter: paymentRoutes, getPostgresRouter: () => postgresRouters.payment }));
app.use('/v1', createRuntimeRouter({ legacyRouter: proxyRoutes, getPostgresRouter: () => postgresRouters.proxy }));

// ========== 健康检查（优化版） ==========
async function healthResponse(req, res) {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  let runtimeHealth = { status: 'degraded', ready: false, database: { status: 'down' }, redis: { status: 'unknown' } };
  let dbSize = 0;
  const fs = require('fs');
  const dbPath = process.env.DB_PATH || './data/proxy.db';
  try {
    runtimeHealth = applicationRuntime ? await applicationRuntime.health() : runtimeHealth;
    if (applicationRuntime?.mode === 'legacy_sqljs' && fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      dbSize = stat.size;
    }
  } catch (e) {
    logger.error('健康检查 — 运行时异常', { error: e.message });
  }
  const overallStatus = runtimeHealth.ready ? 'ok' : 'degraded';
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
      ...runtimeHealth.database,
      size: `${(dbSize/1024/1024).toFixed(2)} MB`,
      ...(applicationRuntime?.mode === 'legacy_sqljs' ? { path: dbPath } : {}),
    },
    redis: runtimeHealth.redis,
    schema: runtimeHealth.schema || { status: applicationRuntime?.mode === 'legacy_sqljs' ? 'disabled' : 'unknown' },
    worker: runtimeHealth.worker || { status: applicationRuntime?.mode === 'legacy_sqljs' ? 'disabled' : 'unknown' },
    runtime: applicationRuntime?.mode || 'starting',
    ready: runtimeHealth.ready,
    environment: isProduction ? 'production' : 'development',
    nodeVersion: process.version,
    pid: process.pid
  });
}

app.get('/api/health', (req, res, next) => healthResponse(req, res).catch(next));
app.get('/api/ready', (req, res, next) => healthResponse(req, res).catch(next));

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error(`[GlobalError] ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误', code: err.code || 'INTERNAL_ERROR' });
});

async function start() {
  const postgresEnabled = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  if (!postgresEnabled) await initDatabase();
  applicationRuntime = await createApplicationRuntime({
    env: process.env,
    legacyDb: postgresEnabled ? null : getDatabase(),
    logger,
  });
  app.locals.runtime = applicationRuntime;
  if (applicationRuntime.mode === 'postgres_redis') {
    const { pool, secretBox, identity } = applicationRuntime;
    const paymentService = createPostgresPaymentService({ pool, secretBox });
    postgresRouters.auth = createPostgresAuthRouter({ pool, identity });
    postgresRouters.user = createPostgresUserRouter({ pool, identity, secretBox, paymentService });
    postgresRouters.admin = createPostgresAdminRouter({
      pool,
      secretBox,
      authenticate: identity.authenticate,
      requireAdmin,
      onMutation: () => applicationRuntime.controlPlane.bumpConfigVersion(),
    });
    postgresRouters.public = createPostgresPublicRouter({ pool });
    postgresRouters.payment = createPostgresPaymentRouter({ paymentService });
    postgresRouters.proxy = createPostgresProxyRouter({
      runtime: applicationRuntime,
      identity,
      upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 120_000),
    });
  }
  // 默认密码安全检查
  try {
    const bcrypt = require('bcryptjs');
    if (applicationRuntime.mode !== 'legacy_sqljs') throw new Error('default-password scan is legacy-only');
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
  if (applicationRuntime.mode === 'legacy_sqljs') {
    // 回滚兼容模式仍保留旧定时器；PostgreSQL 模式由独立 worker 承担后台任务。
    try { const { startHealthCheck } = require('./utils/channel-selector'); startHealthCheck(getDatabase()); } catch(e) { console.error('[健康检查启动失败]', e.message); }
    try { const { startPricingSchedules } = require('./utils/pricing-sync'); startPricingSchedules(getDatabase()); } catch(e) { console.error('[计费同步启动失败]', e.message); }
  }
  httpServer = app.listen(PORT, () => {
    logger.info(`IonAiLabs 已启动 — 端口: ${PORT}, 环境: ${isProduction ? 'production' : 'development'}`);
    console.log(`\n🚀 IonAiLabs 已启动: http://localhost:${PORT}`);
    console.log(`📡 代理端点: http://localhost:${PORT}/v1/chat/completions`);
    console.log(`🌍 运行环境: ${isProduction ? 'production' : 'development'}`);
    console.log(`🗄️ 数据运行时: ${applicationRuntime.mode}`);
    console.log(`📋 日志目录: ./logs/\n`);
    if (typeof process.send === 'function') process.send('ready');
  });
}
start().catch(e => {
  logger.error('启动失败', { error: e.message, stack: e.stack });
  console.error(e);
});
module.exports = app;

const { saveDatabase } = require('./database/init');
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info(`API 收到 ${signal}，正在安全退出`);
  if (applicationRuntime?.mode === 'legacy_sqljs') {
    try { saveDatabase(); } catch(e) { logger.error('退出保存数据库失败', { error: e.message }); }
  }
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  if (applicationRuntime) await applicationRuntime.close();
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

// 未捕获异常
process.on('uncaughtException', (err) => {
  logger.error(`未捕获异常: ${err.message}`, { stack: err.stack });
  console.error(err);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`未处理的 Promise 拒绝: ${reason}`);
  console.error(reason);
});
