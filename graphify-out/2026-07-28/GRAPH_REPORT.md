# Graph Report - ai-api-proxy  (2026-07-28)

## Corpus Check
- 116 files · ~64,425 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1187 nodes · 1707 edges · 90 communities (78 shown, 12 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 95 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7bfd4dd7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- proxy.js
- src/views/admin/Channels.vue
- user/Logs.vue
- dependencies
- ApiKeys.vue
- dependencies
- admin/Models.vue
- Wallet.vue
- admin.js
- pricing-engine.js
- user.js
- routing-group-models.js
- pricing-sync.js
- middleware/auth.js
- src/index.js
- init.js
- src/views/admin/Keys.vue
- src/views/admin/Users.vue
- src/views/admin/Settings.vue
- easypay-payment.test.js
- user/Models.vue
- Proposed Changes
- model-capabilities.test.js
- AdminLayout.vue
- src/views/admin/Pricing.vue
- UserLayout.vue
- Subscribe.vue
- billing-detail.js
- src/views/admin/Orders.vue
- src/components/logs/UsageCharts.vue
- user/Dashboard.vue
- Login.vue
- Register.vue
- getDatabase
- check-mobile-bundle.mjs
- admin-finance.test.js
- main.js
- admin/Logs.vue
- image-generations.test.js
- src/components/DashboardCharts.vue
- ChangePassword.vue
- src/components/AdminTrendChart.vue
- admin/Dashboard.vue
- crypto.js
- registration.test.js
- components.d.ts
- useMobile
- setup.js
- check-login-error-ui.mjs
- time.js
- test.sh
- backup.sh
- deploy.sh
- api/index.js
- app.js
- stores/auth.js
- 六、目前比较明显的问题和风险
- 11AiLabs — AI API 中转平台
- channel-multipliers.js
- Sub2API 渠道与分组管理调研（2026-07-15）
- Sub2API 自动生图与计费调研（2026-07-19）
- 生产数据库方案评估
- Sub2API Codex 图片桥接复核（2026-07-23）
- Sub2API 图片自动生图：用户调用记录显示的模型
- Sub2API balance-billing parity
- Round 1: Schema Baseline
- Sub2API 与 IonAiLabs 用户端性能体验对比报告
- image-billing.js
- easypay.js
- handleImageBilledRequest
- billing.test.js
- anthropic-protocol.test.js
- loadAll
- user-model-multipliers.test.js
- fetchAll
- formatTokenUnit
- payment.js
- loadGroups
- emptyChannel
- easypay-payment.test.js
- billing-detail.js
- channel-docs.js
- crypto.js

## God Nodes (most connected - your core abstractions)
1. `getDatabase()` - 39 edges
2. `initDatabase()` - 31 edges
3. `handleImageBilledRequest()` - 30 edges
4. `saveDatabase()` - 11 edges
5. `generateToken()` - 11 edges
6. `listModelsForApiKey()` - 11 edges
7. `六、目前比较明显的问题和风险` - 11 edges
8. `insertSuccessLog()` - 10 edges
9. `buildPricing()` - 9 edges
10. `buildRequestPricing()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `createOrder()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/tests/admin-finance.test.js → backend/src/database/init.js
- `insertLog()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/tests/user-logs.test.js → backend/src/database/init.js
- `authenticateApiKey()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/src/middleware/auth.js → backend/src/database/init.js
- `easypayNotify()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/src/routes/payment.js → backend/src/database/init.js
- `handleImageBilledRequest()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/src/routes/proxy.js → backend/src/database/init.js

## Import Cycles
- None detected.

## Communities (90 total, 12 thin omitted)

### Community 0 - "proxy.js"
Cohesion: 0.07
Nodes (31): ANTHROPIC_LOG_CONTEXT, ANTHROPIC_RESPONSE_HEADERS, { apiKeyCanUseModel, listModelsForApiKey }, assertSupportedBillableInput(), { authenticateApiKey }, axios, billableTextProjection(), {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveFixedUnitPrice,
  withProviderCachePricing,
} (+23 more)

### Community 1 - "src/views/admin/Channels.vue"
Cohesion: 0.05
Nodes (29): activeChannels, activeGroups, billingFields, channelDialog, channelForm, channelLoading, channels, collapsedSections (+21 more)

### Community 2 - "user/Logs.vue"
Cohesion: 0.05
Nodes (31): allLogs, autoRefresh, billingBreakdown, billingDialog, billingSum, billingTitle, billingVersion, chartsReady (+23 more)

### Community 3 - "dependencies"
Cohesion: 0.04
Nodes (46): chart.js, dayjs, echarts, element-plus, @element-plus/icons-vue, dependencies, axios, chart.js (+38 more)

### Community 4 - "ApiKeys.vue"
Cohesion: 0.05
Nodes (38): activeCode, activeTab, channelLoading, channels, copyExported(), copyKey(), createDialog, createKey() (+30 more)

### Community 5 - "dependencies"
Cohesion: 0.05
Nodes (39): dependencies, axios, bcryptjs, cors, dotenv, express, express-rate-limit, helmet (+31 more)

### Community 6 - "admin/Models.vue"
Cohesion: 0.08
Nodes (28): activeModels, activeProvider, activeType, asMultimodal(), currency(), dialogVisible, emptyForm(), expandedSections (+20 more)

### Community 7 - "Wallet.vue"
Cohesion: 0.08
Nodes (22): activeTab, availableBalance, fetchOrders(), fetchTx(), fetchWallet(), lo, ltx, oPage (+14 more)

### Community 8 - "admin.js"
Cohesion: 0.06
Nodes (50): { authenticate, requireAdmin }, axios, BILLING_MODEL_SOURCES, CHANNEL_BILLING_MODES, CHANNEL_MULTIPLIER_FIELDS, CHANNEL_PRICE_FIELDS, channelModelPayload(), channelMultiplierPayload() (+42 more)

### Community 9 - "pricing-engine.js"
Cohesion: 0.17
Nodes (21): buildChannelImagePricing(), buildImagePricing(), extractAnthropicUsage(), hasBillableUsage(), mergeAnthropicStreamUsage(), calculateDimensions(), calculateImagePricing(), configuredImageUnitPrice() (+13 more)

### Community 10 - "user.js"
Cohesion: 0.10
Nodes (32): anthropicUpstreamHeaders(), listModels(), ALLOWED_CHANNEL_CAPABILITIES, CHANNEL_CAPABILITIES_BY_PROTOCOL, channelModelSupportsImageInput(), channelSupportsCapability(), DEFAULT_CHANNEL_CAPABILITIES, defaultChannelCapabilities() (+24 more)

### Community 11 - "routing-group-models.js"
Cohesion: 0.29
Nodes (5): { generateToken }, { initDatabase, getDatabase }, insertLog(), require, userRoutes

### Community 12 - "pricing-sync.js"
Cohesion: 0.14
Nodes (23): fs, logDir, logger, path, winston, anthropicAnchors(), anthropicIdentity(), axios (+15 more)

### Community 13 - "middleware/auth.js"
Cohesion: 0.12
Nodes (17): apiKeyAuthError(), apiKeyFromRequest(), authenticateApiKey(), bcrypt, findApiKey(), generateToken(), { getDatabase }, jwt (+9 more)

### Community 14 - "src/index.js"
Cohesion: 0.11
Nodes (18): adminRoutes, app, authRoutes, cors, express, globalLimiter, helmet, { initDatabase, getDatabase } (+10 more)

### Community 15 - "init.js"
Cohesion: 0.26
Nodes (16): buildPricing(), buildRequestPricing(), capChatRequestToReservedBalance(), getUsdCnyRate(), insertSuccessLog(), positiveOrOne(), pricingModelForChannel(), billingModeForRequest() (+8 more)

### Community 16 - "src/views/admin/Keys.vue"
Cohesion: 0.12
Nodes (13): allModels, editingKeyId, expandedUsers, fetch(), groups, loading, modelGroups, page (+5 more)

### Community 17 - "src/views/admin/Users.vue"
Cohesion: 0.12
Nodes (16): adj, adjustDialog, adjusting, detailDialog, detailUser, doAdjust(), fetch(), limit (+8 more)

### Community 18 - "src/views/admin/Settings.vue"
Cohesion: 0.14
Nodes (14): baseConfigs, configs, freshProvider(), load(), openProvider(), paymentConfigs, providerDialog, providerForm (+6 more)

### Community 19 - "easypay-payment.test.js"
Cohesion: 0.25
Nodes (13): paymentProviderPayload(), publicPaymentProvider(), decrypt(), buildEasyPayRequest(), crypto, { decrypt }, normalizedBaseUrl(), paymentTypeFor() (+5 more)

### Community 20 - "user/Models.vue"
Cohesion: 0.13
Nodes (10): activeProvider, activeType, filteredModels, loading, models, providerModels, providers, providerTabs (+2 more)

### Community 21 - "Proposed Changes"
Cohesion: 0.09
Nodes (21): 1. 更新用户端图表依赖, 2. 重写调用记录图表组件, 3. 调整调用记录的图表挂载条件并清理遗留代码, 4. 重写用户控制台图表组件, 5. 样式收敛与兼容处理, 6. 增加用户图表 bundle 回归检查, Assumptions & Decisions, Current State Analysis (+13 more)

### Community 22 - "model-capabilities.test.js"
Cohesion: 0.14
Nodes (11): express, { getDatabase }, { listSystemModelCapabilities }, router, adminRoutes, { generateToken }, { initDatabase, getDatabase }, proxyRoutes (+3 more)

### Community 23 - "AdminLayout.vue"
Cohesion: 0.10
Nodes (11): authStore, isCompactDesktop, { isMobile, drawerOpen, drawerRef, triggerRef, openDrawer, closeDrawer }, menuItems, narrowScreen, pageTitle, roleLabel, route (+3 more)

### Community 24 - "src/views/admin/Pricing.vue"
Cohesion: 0.19
Nodes (11): delRule(), dialogVisible, empty(), fetchRules(), form, isEdit, loading, openDialog() (+3 more)

### Community 25 - "UserLayout.vue"
Cohesion: 0.17
Nodes (9): appStore, authStore, isCompactDesktop, { isMobile, drawerOpen, drawerRef, triggerRef, openDrawer, closeDrawer }, narrowScreen, navItems, route, router (+1 more)

### Community 26 - "Subscribe.vue"
Cohesion: 0.18
Nodes (8): fetchOrders(), form, orders, ordersLoading, page, submit(), submitting, total

### Community 27 - "billing-detail.js"
Cohesion: 0.25
Nodes (4): adminRoutes, { generateToken }, { initDatabase, getDatabase }, require

### Community 28 - "src/views/admin/Orders.vue"
Cohesion: 0.22
Nodes (8): confirmOrder(), fetch(), loading, orders, page, rejectOrder(), statusFilter, total

### Community 29 - "src/components/logs/UsageCharts.vue"
Cohesion: 0.14
Nodes (11): costChartData, costChartOptions, hasCallData, hasCostData, modelUsage, palette, props, rankChartData (+3 more)

### Community 30 - "user/Dashboard.vue"
Cohesion: 0.18
Nodes (8): appStore, chartLoading, DashboardCharts, isMobile, models, stats, todaySuccess, wallet

### Community 31 - "Login.vue"
Cohesion: 0.22
Nodes (7): authStore, form, frm, loading, loginError, router, rules

### Community 32 - "Register.vue"
Cohesion: 0.22
Nodes (7): authStore, form, frm, loading, result, router, rules

### Community 33 - "getDatabase"
Cohesion: 0.12
Nodes (27): bcrypt, { initDatabase, getDatabase, saveDatabase }, main(), createTables(), fs, getDatabase(), initDatabase(), initSqlJs (+19 more)

### Community 34 - "check-mobile-bundle.mjs"
Cohesion: 0.20
Nodes (8): distDir, html, oversizedElementBundle, packageJson, projectDir, scriptBytes, staleChartDependency, styleBytes

### Community 35 - "admin-finance.test.js"
Cohesion: 0.29
Nodes (5): adminRoutes, createOrder(), { generateToken }, { initDatabase, getDatabase }, require

### Community 36 - "main.js"
Cohesion: 0.33
Nodes (4): authStore, app, router, routes

### Community 37 - "admin/Logs.vue"
Cohesion: 0.25
Nodes (5): f, loading, logs, page, total

### Community 38 - "image-generations.test.js"
Cohesion: 0.33
Nodes (4): { initDatabase, getDatabase }, proxyRoutes, require, userRoutes

### Community 39 - "src/components/DashboardCharts.vue"
Cohesion: 0.12
Nodes (15): baseOptions, blockedCount, failedCount, isMobile, modelChartData, modelChartOptions, props, rankedModels (+7 more)

### Community 40 - "ChangePassword.vue"
Cohesion: 0.33
Nodes (4): form, formRef, loading, rules

### Community 42 - "admin/Dashboard.vue"
Cohesion: 0.33
Nodes (4): AdminTrendChart, data, isMobile, metrics

### Community 43 - "crypto.js"
Cohesion: 0.10
Nodes (16): { authenticate }, bcrypt, { buildBillingDetail }, { buildEasyPayRequest, supportedPaymentMethods }, buildLogFilters(), { defaultImageDisplayPricing }, { encrypt, decrypt, desensitize }, express (+8 more)

### Community 44 - "registration.test.js"
Cohesion: 0.18
Nodes (9): authenticate(), { authenticate, generateToken }, bcrypt, express, { getDatabase }, router, authRoutes, { getDatabase, initDatabase } (+1 more)

### Community 45 - "components.d.ts"
Cohesion: 0.50
Nodes (3): ComponentCustomProperties, GlobalComponents, vue

### Community 49 - "time.js"
Cohesion: 0.26
Nodes (9): first, latest, logs, second, createLatestRequest(), beijingParts(), formatBeijingDate(), formatBeijingTime() (+1 more)

### Community 62 - "六、目前比较明显的问题和风险"
Cohesion: 0.07
Nodes (26): 10. 健康检查状态可能误导, 1. 没有自动化测试, 1. 用户和权限体系, 2. API Key 管理, 2. SQL 错误被吞掉, 3. 模型代理, 3. 缺少真正的事务, 4. SQL.js 不适合高并发生产计费 (+18 more)

### Community 63 - "11AiLabs — AI API 中转平台"
Cohesion: 0.09
Nodes (21): 1. 后端, 2. 前端, 3. 访问, IonAiLabs — AI API 中转平台, Nginx 配置（首次部署后执行一次）, 一键部署, 主要功能, 健康检查 (+13 more)

### Community 64 - "channel-multipliers.js"
Cohesion: 0.39
Nodes (8): exportLogs(), fetchLogs(), logParams(), normalizeRange(), onCustomChange(), onLogFilterChange(), openAllLogs(), validateRange()

### Community 65 - "Sub2API 渠道与分组管理调研（2026-07-15）"
Cohesion: 0.17
Nodes (11): 1. “渠道”不是单个上游 URL，而是面向分组的计费、模型映射与可见模型策略, 2. 分组是调度边界；账号可多归属，渠道与分组是一对一归属, 3. 模型权限、展示与实际转发分层处理, 4. 调度、优先级与故障回退均在“账号池”层完成, 5. 健康监控独立于请求调度, Sub2API 渠道与分组管理调研（2026-07-15）, 与 11AiLabs 当前架构的高层对照, 对后续方案的约束建议（调研结论，不是实施） (+3 more)

### Community 66 - "Sub2API 自动生图与计费调研（2026-07-19）"
Cohesion: 0.20
Nodes (9): 1. 同时支持专用生图端点和 Responses 原生工具, 2. 仅 Codex/OpenAI 路径有可选的自动工具桥接, 3. 实际生图模型和张数由 Responses 处理链带入最终结果, 4. 生图可按图/尺寸计费并记录明细，但一次 Responses 调用只形成一条用量流水, Sub2API 自动生图与计费调研（2026-07-19）, 对 11AiLabs 方案的可借鉴点与边界, 已确认的实现, 调研边界 (+1 more)

### Community 67 - "生产数据库方案评估"
Cohesion: 0.29
Nodes (6): 备选：better-sqlite3 (原生 SQLite 驱动), 建议, 当前方案：SQL.js, 推荐方案, 生产数据库方案评估, 首选：PostgreSQL + Prisma / Knex

### Community 68 - "Sub2API Codex 图片桥接复核（2026-07-23）"
Cohesion: 0.40
Nodes (4): Sub2API Codex 图片桥接复核（2026-07-23）, 术语澄清, 直接证据, 结论

### Community 69 - "Sub2API 图片自动生图：用户调用记录显示的模型"
Cohesion: 0.40
Nodes (4): Sub2API 图片自动生图：用户调用记录显示的模型, 对 11AiLabs 的含义, 结论, 证据链

### Community 70 - "Sub2API balance-billing parity"
Cohesion: 0.40
Nodes (4): Goal, Public test seams, Required behavior, Sub2API balance-billing parity

### Community 71 - "Round 1: Schema Baseline"
Cohesion: 0.40
Nodes (4): Goal, Requirements, Round 1: Schema Baseline, Verification

### Community 73 - "Sub2API 与 IonAiLabs 用户端性能体验对比报告"
Cohesion: 0.12
Nodes (15): 1. 首次路由加载没有被提前消化, 2. ECharts 是当前最明确的前端成本, 3. 当前筛选逻辑没有处理请求竞争, 4. 后端当前不是主要瓶颈，但存在扩展边界, Sub2API 与 IonAiLabs 用户端性能体验对比报告, 为什么 Sub2API 的时间范围更新更像即时完成, 关键对比, 参考资料 (+7 more)

### Community 74 - "image-billing.js"
Cohesion: 0.26
Nodes (14): classifyImageBillingTier(), countGeneratedImages(), decodeImageDimensions(), explicitImageSize(), generatedImageOutputSizes(), IMAGE_BILLING_TIERS, imageBillingIntent(), imagePriceForSize() (+6 more)

### Community 75 - "easypay.js"
Cohesion: 0.60
Nodes (3): positiveInteger(), PROVIDER_OUTPUT_LIMITS, resolveChatOutputLimit()

### Community 76 - "handleImageBilledRequest"
Cohesion: 0.21
Nodes (14): availableWalletBalance(), channelBillingForModel(), channelHasTokenPricing(), handleImageBilledRequest(), insertImageSettlementFailureLog(), insertImageSuccessLog(), insertSettlementFailureLog(), insertUpstreamFailureLog() (+6 more)

### Community 77 - "billing.test.js"
Cohesion: 0.60
Nodes (8): deductWalletBalance(), insertTransaction(), numeric(), positiveAmount(), releaseWalletReservation(), reserveWalletBalance(), settleWalletReservation(), walletBalances()

### Community 78 - "anthropic-protocol.test.js"
Cohesion: 0.25
Nodes (6): adminRoutes, { generateToken }, { initDatabase, getDatabase }, proxyRoutes, require, userRoutes

### Community 79 - "loadAll"
Cohesion: 0.25
Nodes (8): deleteChannel(), loadAll(), loadChannels(), loadModels(), saveChannel(), saveMappings(), syncModels(), toggleChannel()

### Community 80 - "user-model-multipliers.test.js"
Cohesion: 0.33
Nodes (4): { generateToken }, { initDatabase, getDatabase }, require, userRoutes

### Community 81 - "fetchAll"
Cohesion: 0.40
Nodes (5): fetchAll(), getPresetRange(), onPresetChange(), scheduleCharts(), toggleAutoRefresh()

### Community 83 - "payment.js"
Cohesion: 0.25
Nodes (9): easypayNotify(), express, fail(), { getDatabase }, { grantQuotaOrder }, router, { verifyEasyPayCallback }, grantQuotaOrder() (+1 more)

### Community 84 - "loadGroups"
Cohesion: 0.50
Nodes (4): deleteGroup(), loadGroups(), saveGroup(), toggleGroup()

### Community 86 - "easypay-payment.test.js"
Cohesion: 0.22
Nodes (8): callbackFields(), { encrypt }, { generateToken }, { initDatabase, getDatabase }, paymentRoutes, require, signEasyPay(), userRoutes

### Community 87 - "billing-detail.js"
Cohesion: 0.50
Nodes (6): buildBillingDetail(), { calculatePricing }, number(), perMillionPrice(), rounded(), calculatePricing()

### Community 88 - "channel-docs.js"
Cohesion: 0.47
Nodes (5): CHANNEL_PROTOCOL_MAP, generateDocs(), getConfiguredProtocol(), getProtocol(), PROTOCOLS

### Community 89 - "crypto.js"
Cohesion: 0.50
Nodes (4): crypto, desensitize(), encrypt(), getKey()

## Knowledge Gaps
- **617 isolated node(s):** `backup.sh script`, `name`, `version`, `main`, `start` (+612 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDatabase()` connect `getDatabase` to `proxy.js`, `admin-finance.test.js`, `image-generations.test.js`, `admin.js`, `user.js`, `crypto.js`, `registration.test.js`, `middleware/auth.js`, `src/index.js`, `handleImageBilledRequest`, `anthropic-protocol.test.js`, `billing.test.js`, `routing-group-models.js`, `payment.js`, `user-model-multipliers.test.js`, `model-capabilities.test.js`, `easypay-payment.test.js`, `billing-detail.js`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `initDatabase()` connect `getDatabase` to `admin-finance.test.js`, `image-generations.test.js`, `routing-group-models.js`, `registration.test.js`, `middleware/auth.js`, `anthropic-protocol.test.js`, `billing.test.js`, `src/index.js`, `user-model-multipliers.test.js`, `easypay-payment.test.js`, `model-capabilities.test.js`, `billing-detail.js`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `handleImageBilledRequest()` connect `handleImageBilledRequest` to `proxy.js`, `getDatabase`, `admin.js`, `pricing-engine.js`, `user.js`, `image-billing.js`, `billing.test.js`, `init.js`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `backup.sh script`, `name`, `version` to the rest of the system?**
  _617 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `proxy.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07017543859649122 - nodes in this community are weakly interconnected._
- **Should `src/views/admin/Channels.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `user/Logs.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._