# 性能与压测验证

这套交付默认只命中本机 mock，不会探测、调用或枚举真实上游渠道。所有 API Key 只可通过 `LOAD_API_KEY` 环境变量传入；脚本不会读取配置文件、数据库或命令行中的密钥。

## 本地执行顺序

1. 启动 mock 上游：`node backend/load/mock-upstream.js`。默认监听 `http://127.0.0.1:4010`，仅实现聊天完成端点，不会转发任何请求。
2. 若要验证代理本身，将测试账号的上游地址暂时指向 mock。故障切换场景使用 `/primary/v1` 作为主账号、`/fallback/v1` 作为备用账号：mock 会让主账号返回 429 或 503，而备用账号成功返回。容量场景把账号最大并发设为一个小值。
3. 在独立终端设置环境变量，例如 PowerShell：`$env:LOAD_TARGET='http://127.0.0.1:3011'`、`$env:LOAD_API_KEY='<本地测试 Key>'`、`$env:LOAD_SCENARIO='chat'`。不测代理时不要设置 `LOAD_TARGET`，默认直接请求本机 mock。
4. 安装在工作站或以临时工具方式提供 `autocannon` 后，运行 `node backend/load/run-autocannon.js`。可选场景：`chat`、`capacity`、`rate_limit_failover`、`upstream_failure_failover`。
5. 安装 k6 后运行 `k6 run backend/load/k6-scenarios.js`。该脚本顺序执行聊天、容量、429 回退和 503 回退场景。
6. 运行前端静态预算：`node frontend/scripts/check-first-paint-budget.mjs`。它不启动浏览器，也不会发出网络请求。
7. 在 `frontend/` 安装依赖后运行 `npm run test:perf:browser`。命令先构建 `dist`，再由 Playwright 启动 `vite preview`；浏览器用本机 Chrome，不下载 Playwright 自带浏览器。它对 `/console` 与 `/admin` 注入本地占位会话并 mock 认证、bootstrap、日志 overview，只验证页面可见行为。
8. 运行 `npm run test:perf:lighthouse`。命令先构建 `dist`，脚本再启动本机 `vite preview`，用本机 Chrome 和 Lighthouse 官方 desktop/Dense 4G 预设对公开首页 `/` 执行测试。默认门槛为 Performance 70、Accessibility 85、Best Practices 80、SEO 80、FCP 1800ms、LCP 3000ms、CLS 0.10。

## 浏览器基线配置

- Playwright 默认目标为 `http://127.0.0.1:4173`，核心数据预算由 `PERF_CORE_DATA_BUDGET_MS` 调整，默认 1000ms。若 Chrome 不在系统默认位置，可设置 `PLAYWRIGHT_CHROME_EXECUTABLE_PATH` 或 `CHROME_PATH`；也可通过 `PLAYWRIGHT_CHANNEL` 选择本机 Chrome channel。
- Lighthouse 默认目标为 `http://127.0.0.1:4173/`。若 Chrome 不在默认位置，可设置 `LIGHTHOUSE_CHROME_PATH` 或 `CHROME_PATH`。各门槛可分别通过 `LIGHTHOUSE_MIN_PERFORMANCE`、`LIGHTHOUSE_MIN_ACCESSIBILITY`、`LIGHTHOUSE_MIN_BEST_PRACTICES`、`LIGHTHOUSE_MIN_SEO`、`LIGHTHOUSE_MAX_FCP_MS`、`LIGHTHOUSE_MAX_LCP_MS`、`LIGHTHOUSE_MAX_CLS` 调整。
- 两套命令都消费已经构建的 `dist`，不启动 Vite 开发服务器，也不连接真实后端。Playwright 的失败证据默认写入系统临时目录下的 `ionailabs-playwright-performance`；需要保留时用 `PLAYWRIGHT_OUTPUT_DIR` 指定独立归档目录。

## 安全边界

`LOAD_TARGET` 默认是 `http://127.0.0.1:4010`。非 `localhost`、`127.0.0.1` 或 `::1` 的目标会在请求前被拒绝；只有人工明确设置 `ALLOW_EXTERNAL_LOAD_TARGET=true` 后才能继续。该开关不等同于上线许可：先确认目标、并发、额度和回滚窗口。

Playwright 与 Lighthouse 同样默认拒绝非 loopback 目标。只有经人工明确批准后，才可分别设置 `ALLOW_EXTERNAL_BROWSER_TARGET=true` 或 `ALLOW_EXTERNAL_LIGHTHOUSE_TARGET=true`。这些开关仅解除脚本保护，不代表生产测试授权；外部 Lighthouse 也不会启动本地 preview。目标 URL 禁止携带用户名或密码。

不要把 Key 写进场景文件、文档命令、shell 历史或报告。浏览器基线使用固定的无权限占位 token，不读取环境中的业务 Key。压测报告只记录目标、场景、并发、时延、状态分布和错误计数，不记录请求头或请求体。

## 验收指标

- 首屏：P75 页面导航后 **1 秒** 内出现骨架；本机 mock 条件下核心 bootstrap 数据 P75 在 **1 秒** 内可用。网络变慢时骨架仍须先出现，不能空白等待。
- 请求量：每个用户和管理仪表盘首屏只有一个 bootstrap 请求；模型明细和图表 chunk 仅在可见且有数据时加载。
- 筛选：新筛选取消旧请求，旧响应不得覆盖最新页面状态。
- 压测：聊天场景 95 分位小于 1 秒；容量场景可观察受控的 429/503 而不是无限排队；429 与 503 回退场景在配置了 fallback 时返回成功，且 mock 日志中没有任何外网请求。

这些指标是本地压测与回归门槛，不代表生产容量承诺。生产验证必须另外获准，并使用隔离账号、限额和明确的停止条件。
