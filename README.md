# 11AiLabs — AI API 中转平台

一个面向用户的 OpenAI API 代理中转平台，支持多模型、多渠道池、智能路由、差异化计费、用户钱包和 API Key 管理。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express + SQL.js |
| 前端 | Vue 3 + Vite + Element Plus + ECharts |
| 数据库 | SQLite (sql.js, 纯 JS 无依赖) |
| 认证 | JWT + bcryptjs |
| 部署 | Nginx + PM2 |

## 项目结构

```
ai-api-proxy/
├── backend/                # 后端服务
│   ├── src/
│   │   ├── index.js        # 入口
│   │   ├── routes/         # 路由 (auth, user, admin, proxy, public)
│   │   ├── middleware/      # 中间件 (认证)
│   │   ├── database/       # 数据库初始化 & 种子数据
│   │   └── utils/          # 工具 (加密等)
│   ├── data/               # SQLite 数据文件 (自动生成)
│   ├── .env                # 环境变量
│   └── package.json
├── frontend/               # Vue 3 前端
│   ├── src/
│   │   ├── views/          # 页面组件
│   │   ├── router/         # 路由配置
│   │   ├── api/            # Axios 封装
│   │   └── layout/         # 布局组件
│   └── package.json
├── nginx.conf              # Nginx 配置
├── deploy.sh               # 一键部署脚本
└── README.md
```

## 快速开始 (本地开发)

### 1. 后端

```bash
cd backend
npm install
npm run seed    # 首次运行：创建管理员账号 (admin/admin123) 和测试用户 (testuser/user123)
npm run dev     # 启动开发服务器，默认 http://localhost:3000
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev     # 启动开发服务器，默认 http://localhost:5173
```

### 3. 访问

| 页面 | 地址 | 账号 |
|------|------|------|
| 用户端 | http://localhost:5173/ | testuser / user123 |
| 管理端 | http://localhost:5173/admin | admin / admin123 |

## 生产环境部署

### 前提条件

- Ubuntu / Debian 服务器
- 已安装 Node.js 18+、npm、Nginx、PM2
- 项目放置在 `/opt/ai-api-proxy`

### 配置文件修改

1. **`backend/.env`** — 已包含随机生成的 JWT_SECRET 和 ENCRYPTION_SECRET，生产环境可自行替换
2. **`nginx.conf`** — 将 `server_name your-domain.com` 改为你的域名

### 一键部署

```bash
chmod +x deploy.sh
./deploy.sh
```

### Nginx 配置（首次部署后执行一次）

```bash
sudo cp nginx.conf /etc/nginx/sites-available/ai-api-proxy
sudo ln -s /etc/nginx/sites-available/ai-api-proxy /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 手动步骤

```bash
# 后端
cd backend
npm install --production
pm2 start src/index.js --name ai-api-proxy --cwd /opt/ai-api-proxy/backend
pm2 save
pm2 startup

# 前端
cd frontend
npm install
npm run build
sudo cp -r dist /var/www/ai-api-proxy/dist
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `production` |
| `PORT` | 后端端口 | `3000` |
| `JWT_SECRET` | JWT 签名密钥 | 随机生成 |
| `JWT_EXPIRES_IN` | JWT 过期时间 | `7d` |
| `ENCRYPTION_SECRET` | API Key 加密密钥 | 随机生成 |
| `DB_PATH` | 数据库路径 | `./data/proxy.db` |

## 主要功能

- **用户管理**：注册、登录、JWT 认证、角色权限 (admin/user/operator/finance)
- **API Key 管理**：创建、启用/禁用、删除，支持按渠道分组自动分配模型权限
- **API Key 安全**：bcrypt 哈希校验 + AES 加密存储，列表脱敏展示，密码验证后恢复完整 Key
- **钱包系统**：充值余额、赠送余额、消费扣款、冻结点数、交易流水
- **模型管理**：LLM / Embedding / Image / Audio 多类型，上下文长度、多模态标记
- **多渠道池**：多上游渠道配置，加权轮询负载均衡，自动健康检查，连续失败熔断降级
- **计费规则**：平台/用户组/用户/API Key 四级计费倍率，生效时间和优先级
- **调用代理**：OpenAI 兼容 `/v1/chat/completions`、`/v1/embeddings`、`/v1/images/generations` 和非流式图片 `/v1/responses`，支持 Chat SSE 流式，自动鉴权→计费→记录日志
- **管理后台**：仪表盘、用户管理、渠道管理、模型管理、计费规则、订单审核、调用日志、系统配置

### 图片生成计费

图片生成采用 Sub2API 风格的“请求预留、响应证实”模式：

1. 在“模型管理”中选择手动价格，配置方图、横图、竖图的每张单价及图片倍率。
2. 在“路由与渠道”中为对应上游启用“生图 / Images Generations”或“Responses 原生工具”接口能力，并保存模型映射。
3. 客户端调用 `POST /v1/images/generations`，或使用非流式 `POST /v1/responses` 并声明 `image_generation` 工具。系统按请求数量冻结额度，只按上游响应中实际返回的有效图片张数结算。
4. 每次请求只生成一条图片计费日志，保存请求模型、计费模型、图片张数、尺寸、质量、单价、倍率和汇率快照；空图片结果不会扣费。

## 运维功能

### 日志系统

使用 **winston** 记录运行日志，日志文件存放在 `backend/logs/` 目录下：

| 文件 | 说明 |
|------|------|
| `logs/combined.log` | 所有日志（info 级别以上），自动轮转（10MB × 5 文件） |
| `logs/error.log` | 错误日志（error 级别），自动轮转（10MB × 5 文件） |
| `logs/access.log` | HTTP 请求日志（morgan combined 格式） |

```bash
# 实时查看日志
tail -f backend/logs/combined.log
tail -f backend/logs/access.log

# PM2 日志
pm2 logs ai-api-proxy
```

**错误捕获：** 启动时自动注册 `uncaughtException` 和 `unhandledRejection` 全局处理器，确保致命错误不会静默丢失。

### 健康检查

```bash
# 基础健康检查
curl http://localhost:3000/api/health

# Nginx 通过后对外暴露
curl https://your-domain.com/api/health
```

**返回数据包含：**

| 字段 | 说明 |
|------|------|
| `status` | `"ok"` 或异常 |
| `uptime` / `uptimeFormatted` | 运行时长 |
| `memory.rss` / `heapUsed` / `heapTotal` | 内存使用 |
| `cpu.loadavg` / `cpu.cpus` | CPU 负载 & 核心数 |
| `database.status` / `database.size` | 数据库状态 & 文件大小 |
| `environment` / `nodeVersion` / `pid` | 运行环境信息 |

### 数据库备份

```bash
chmod +x backend/backup.sh
./backend/backup.sh   # 手动执行一次

# 加入 cron 定时任务（每天凌晨 3:00 自动备份）
crontab -e
0 3 * * * /opt/ai-api-proxy/backend/backup.sh >> /var/log/ai-proxy-backup.log 2>&1
```

**备份特性：**
- 压缩存储（gzip），节省空间
- 自动保留最近 30 天，过期自动清理
- 备份目录：`backend/backups/`

## 安全提示

- **`backend/.env` 中的密钥在生产环境请务必更换**
- 生产环境请启用 HTTPS (配合 Let's Encrypt)
- API Key 创建后仅展示一次，后续需通过「复制」按钮 + 密码验证获取
- 定期备份 `backend/data/proxy.db` 数据库文件
- 查看日志：`tail -f backend/logs/error.log`
