# PostgreSQL/Redis 隔离演练与发布准备记录

日期：2026-08-01

范围：仅本机隔离演练；未修改生产、未推送 GitHub、未切换 Nginx 或线上流量。

## 隔离运行环境

- Compose 项目：`ionailabs-rehearsal-75bd56f`
- PostgreSQL 16：数据库 `ionailabs_rehearsal`，仅监听 `127.0.0.1:55432`
- Redis 7：仅监听 `127.0.0.1:16379`
- API：隔离 PM2 home 下的 `11ailabs-api`，`127.0.0.1:3300`
- worker：同一隔离 PM2 home 下的 `11ailabs-worker`
- 所需环境变量只记录名称：`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`INFRA_SECRET_ACTIVE_VERSION`、`INFRA_SECRET_KEYRING`、`REDIS_KEY_PREFIX`、`GATEWAY_LEASE_TTL_MS`、`UPSTREAM_TIMEOUT_MS`
- 所有凭据由隔离运行环境持有；本文、Git 变更和测试输出均不包含明文密钥。

最终 `/api/ready` 与 `/api/health` 均为 HTTP 200。PostgreSQL、Redis、worker heartbeat、迁移 checksum 和当前月分区 `api_request_logs_2026_08` 均为 `ok`。

## 迁移核对

| 迁移 | SHA-256 |
| --- | --- |
| `000_bootstrap` | `38a2aa49a551d12c3c59d6a0762f7fa60f9c913b3558527aeabd7ebd46094fd0` |
| `001_foundation` | `e85f4c86f963e55c5f6d18df7993e1aa0c26f35d1d0fe4e48828dd833f7b672c` |
| `002_runtime_limits_and_billing` | `b309da7758e8cd7dd11ce9ae8da4538fef0e0be7b1d24c5119501c77f3a53421` |
| `003_public_api_compatibility` | `53526c8ee362b400e2284dd5e6d83fd59e8c0c8590f63ccd74067d4cbd9197a5` |
| `004_api_key_daily_usage` | `e6a098e513663a6295631c8ec6a34f3e728beb9335f4cc851ea72f1c8eccbb58` |

应用启动没有自动执行迁移。API 与 worker 会在启动前拒绝缺失迁移或 checksum 漂移。

## SQL.js 备份与控制面导入

- 已验证 manifest：`backend/backups/release-prep-75bd56f/20260801T025346Z/proxy.db.sha256.json`
- SQL.js SHA-256：`99f661889f5e91f3fee8f4d63da625007df87258aeae620a9b9390f90b038b19`
- 大小：233472 bytes
- 导入来源是备份副本，不是正在写入的旧库。

导入并核对：后台账号 1、模型 26、系统配置 23、上游账号 2、账号模型映射 9、路由分组 3、分组账号 2、分组模型 2、支付服务商 1、平台定价规则 0。三份密文均可通过 AES-256-GCM 密钥环解封；支付开关和支付服务商保持禁用。

最终用户面已经清零：普通用户、钱包、钱包流水、订单、API Key、调用日志、冻结记录和用户/平台日聚合均为 0。清理前备份 `ionailabs-20260801T035607Z.dump` 可恢复；清理后最终备份 `ionailabs-20260801T035753Z.dump` 已通过 `pg_restore --list` 和 SHA-256 校验，最终 dump SHA-256 为 `1e066aeb2ff7fd53b1c0b1d163af183d0ffebae4d51e766f1945dfb304419e24`。

## 渠道、图片与计费证据

- 管理员登录、控制面 bootstrap、两个账号的密钥解密与探测均通过；探测可用率 100%，延迟约 527–581ms。
- `/v1/models` 正确声明 `gpt-image-2`：图片生成和图片编辑为支持，图片变体、图片变换和 Responses 图片工具为不支持。
- 不支持的三类调用均在请求上游前返回 HTTP 400 `capability_not_supported`。
- 使用无敏感测试输入完成一次真实图片生成和一次真实图片编辑，分别耗时 40.787s 与 23.718s，均返回 1 张图片；没有把 Base64 或图片 URL 写入日志或数据库。
- 上游实际返回 1254x1254，系统按实际输出归入 2K 档计费。两次各结算 1.357011 点，预冻结均为 0.904674 点，最终冻结余额为 0，日志记录了操作、输出数量、实际尺寸和 PNG 格式。
- Redis 断开时网关在 116–130ms 内返回 HTTP 503 `redis_unavailable`，未产生冻结余额；恢复 Redis 后 API 和 worker 无需重启即可重新达到 ready。

运行决策：当前策略允许实际输出档位高于请求预冻结档位时补扣差额。若余额只够预冻结、不够最终实际尺寸，可能产生结算债务；生产发布前应明确接受该策略，或改成按可能的最高输出档位预冻结。

## 测试与性能

- 后端全量：54 个测试文件、340 项测试全部通过。
- 前端生产构建通过；首屏预算、性能垂直切片、登录 bootstrap、日志筛选防旧响应覆盖、HTTP 取消与渠道兼容契约均通过。
- Playwright：用户首屏核心数据 1.1s、管理员首屏 868ms；日志 A→B 筛选只保留最新 B 响应。3 项全部通过。
- Lighthouse：Performance 100、Accessibility 100、Best Practices 100、SEO 92；FCP 479ms、LCP 702ms、CLS 0.000。
- 前端 `dist/index.html` SHA-256：`c7da90a19aa0a22fab87132af1fff36f6d4325884dd27da6c67885a80c6ae8f8`。
- 本机 mock 上游 Autocannon 基线：普通 JSON 响应约 8013 req/s，p99 2ms；250ms 延迟场景约 21 req/s，p99 268ms；429 与 503 场景均稳定返回预期非 2xx。
- Redis 原子租约、并发、RPM、TPM、429/503 冷却、释放与失败回退已有自动化测试覆盖。

未完成项：连接隔离 API、账号池和结算模块的端到端 Autocannon/k6 压测未执行。安全门禁拒绝从临时脚本提取测试凭据，并发现早期脚本曾把目标数据库写成未核实的 `ionailabs`；该脚本没有获得执行权限，也没有产生数据库写入或压测请求。后续若要补跑，必须单独确认目标数据库为 `ionailabs_rehearsal`，并以显式提供的一次性测试凭据启动。k6 本机也未安装。

## 演练中修复的问题

- 控制面导入补齐模型能力、价格和排序等一等字段，并统一旧 SQL.js UTC 时间。
- 导入核对改为同一 PostgreSQL client 上顺序查询，消除并发查询弃用告警。
- `/api/health` 与 `/api/ready` 暴露迁移数量、checksum 状态和当前日志分区证据。
- 图片接口增加能力预检，确保不支持的请求不会冻结余额或访问上游。
- 图片结算按返回图片的实际尺寸逐档计费；混合尺寸多图会分别计算 1K/2K/4K 小计，不会把全部图片按最大档收费。日志保留安全的操作/格式/尺寸与分档快照。
- 控制面 JSON 核对改为递归规范化键序后比较，并恢复可读的核对错误信息，避免 PostgreSQL `jsonb` 键重排造成误失败。
- 管理接口中的日期恢复为 ISO 字符串，不再序列化成空对象。
- Redis client 禁用离线队列并补齐 error listener，确保断线快速 503、恢复后自动重连，避免 worker 重启抖动。
- mock 上游支持 `/models`，避免 worker 探测把本机压测账号误判为故障。

## 上线前门禁与回滚

1. 生产切换前再次备份生产 SQL.js 并生成 manifest，禁止复用本次演练备份。
2. 正式导入后核对上述控制面数量、密文可用性、用户面为空和支付关闭。
3. 旧 SQL.js 中 `image2` 没有 `image_edits` 能力且映射的 `supports_image_input` 为 false。本次仅在隔离 PostgreSQL 中按已验证能力修正；生产切换时必须把该差异列入显式导入后配置步骤。
4. 补跑经授权的网关级 mock Autocannon/k6，并确认 RPM/TPM、429 冷却和双账号故障切换的端到端证据。
5. 由用户单独授权后，才可停止旧写入、正式导入、启动生产 API/worker、原子切换前端/Nginx 并执行真实流量验收。
6. 回滚点：生产切换前 SQL.js 备份、PostgreSQL 切换前 dump、旧前端 dist、旧 PM2/Nginx 配置。回滚时先停止新写入，再恢复数据库和前端，最后恢复旧 API 路由。

本次隔离 Docker 与 PM2 API/worker 保持运行，便于人工检查；它们没有接管生产流量。
