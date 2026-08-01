# 基础设施健康契约

PostgreSQL 运行模式已经接入 Express API 与独立 worker。`DATABASE_URL` 是唯一规范连接串；`POSTGRES_URL` 仅作兼容别名，两者同时存在但不相等时 API、worker、迁移和导入都会拒绝启动。

## Readiness

`GET /api/ready` 是依赖就绪检查，会并行核对：

- `checkPostgres(pool)`：执行只读 `SELECT 1`。
- `checkPostgresSchema(pool)`：按仓库迁移文件的原始字节 SHA-256 核对全部 `schema_migrations` 版本与 checksum，并确认当前月请求日志分区挂载在父表下。
- `checkRedis(client)`：执行只读 `PING`，且必须得到 `PONG`。
- worker heartbeat：独立于顺序维护任务刷新；超过 120 秒未更新视为 stale。

四项均为 `ok` 时返回 HTTP 200；任一项失败返回 HTTP 503。API 和 worker 启动前都会拒绝缺迁移或 checksum 漂移，并预建当前月及未来三个月的日志分区，但绝不会自动执行 schema migration。响应不得泄露连接串、用户名、密码、SQL 错误或上游密钥。

```json
{
  "status": "ok",
  "database": { "status": "ok", "driver": "postgresql", "latencyMs": 3 },
  "schema": {
    "status": "ok",
    "expectedCount": 5,
    "appliedCount": 5,
    "missing": [],
    "mismatched": [],
    "unexpected": [],
    "currentPartition": { "status": "ok", "attached": true, "partitionName": "api_request_logs_2026_08" }
  },
  "redis": { "status": "ok", "latencyMs": 1 },
  "worker": { "status": "ok", "heartbeat": "2026-08-01T00:00:00.000Z" },
  "ready": true
}
```

当前 `/api/health` 与 `/api/ready` 都返回完整依赖状态；发布与负载均衡判定必须使用 `ready` 和 HTTP 状态，而不是仅判断进程存活。

## 运行边界

- `docker-compose.infrastructure.yml` 只启动 PostgreSQL、Redis 和 PostgreSQL 备份任务，不启动应用进程。
- 迁移必须通过 `node backend/scripts/migrate-postgres.js --apply` 显式执行；省略 `--apply` 仅列出候选迁移。
- worker 只接受 30–365 天的请求日志保留期；非法值会在连接数据库前失败，避免误删全部日志。
- `node backend/scripts/import-sqljs-control-plane.js --source <path>` 默认 dry-run。正式导入还要求 `--apply`、`CONTROL_PLANE_IMPORT_CONFIRM=apply-control-plane`，以及 `--backup-manifest <path>`（或 `SQLJS_CONTROL_PLANE_BACKUP_MANIFEST`）。程序会重新校验源库与备份的 SHA-256，并只从已验证备份读取。
- 导入只处理控制面、账号池和非普通用户的后台账号；普通用户、API Key、钱包、订单和请求日志一律不导入。在线支付开关和支付服务商状态导入后均保持关闭。
