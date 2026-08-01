# Graph Report - ai-api-proxy  (2026-08-01)

## Corpus Check
- 224 files · ~139,707 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2210 nodes · 3601 edges · 161 communities (134 shown, 27 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 269 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `32b81722`
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
- pricing-engine.js
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
- init.js
- loadGroups
- emptyChannel
- easypay-payment.test.js
- channel-selector.js
- channel-docs.js
- payment.js
- channel-capabilities.js
- user-model-multipliers.test.js
- billing-detail.js
- public.js
- channel-model-policy.js
- model-sync.js
- check-user-actions.mjs
- element-plus
- migrate-postgres.js
- vue-chartjs
- vue-router
- DashboardReadModel
- UsageSettlement
- 基础设施健康契约
- infrastructure-static-contract.test.js
- dayjs
- echarts
- gsap
- easypay.js
- ensureModels
- postgres-tasks.js
- withTransaction
- multiplier-policy.js
- backend/package.json
- scripts
- runtime-services.test.js
- BackgroundWorker
- pricingPayload
- channel-model-policy.js
- crypto.js
- model-sync.js
- axios
- cors
- dotenv
- express
- form-data
- helmet
- morgan
- sql.js
- uuid
- vue-chartjs
- dashboard-read-model/legacy-repository.js
- .key
- billing-detail.js
- channel-capabilities.js
- channel-docs.js
- winston
- axios
- control-plane/postgres-repository.js
- postgres-proxy.js
- withTransaction
- postgres-public.test.js
- estimatedChatInputTokens
- PostgreSQL/Redis 隔离演练与发布准备记录
- mock-upstream.js
- runtime-router.test.js
- postgres-admin.test.js
- echarts
- createTransformationBody
- 性能与压测验证
- cors
- worker-runtime.test.js
- request-limits.js
- bcryptjs
- express-rate-limit
- multer
- winston

## God Nodes (most connected - your core abstractions)
1. `PostgresAdminCompatRepository` - 65 edges
2. `getDatabase()` - 39 edges
3. `initDatabase()` - 32 edges
4. `handleImageBilledRequest()` - 28 edges
5. `withTransaction()` - 22 edges
6. `text()` - 22 edges
7. `createPostgresIdentity()` - 19 edges
8. `createPostgresUserRouter()` - 19 edges
9. `buildControlPlaneImportPlan()` - 16 edges
10. `scripts` - 15 edges

## Surprising Connections (you probably didn't know these)
- `buildChannelProtocolDocs()` --indirect_call--> `enabled()`  [INFERRED]
  backend/src/routes/postgres-user.js → frontend/src/views/admin/Settings.vue
- `resolveEffectiveMultiplierPolicy()` --indirect_call--> `source()`  [INFERRED]
  backend/src/utils/multiplier-policy.js → frontend/scripts/check-first-paint-budget.mjs
- `query()` --indirect_call--> `params()`  [INFERRED]
  backend/tests/postgres-worker-tasks.test.js → backend/load/k6-scenarios.js
- `shutdown()` --calls--> `saveDatabase()`  [EXTRACTED]
  backend/src/index.js → backend/src/database/init.js
- `createOrder()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/tests/admin-finance.test.js → backend/src/database/init.js

## Import Cycles
- None detected.

## Communities (161 total, 27 thin omitted)

### Community 0 - "proxy.js"
Cohesion: 0.06
Nodes (38): ANTHROPIC_LOG_CONTEXT, ANTHROPIC_RESPONSE_HEADERS, { apiKeyCanUseModel, listModelsForApiKey }, assertSupportedBillableInput(), { authenticateApiKey }, axios, billableTextProjection(), {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveFixedUnitPrice,
  withProviderCachePricing,
} (+30 more)

### Community 1 - "src/views/admin/Channels.vue"
Cohesion: 0.06
Nodes (29): activeChannels, activeGroups, billingFields, channelDialog, channelForm, channelLoading, channels, collapsedSections (+21 more)

### Community 2 - "user/Logs.vue"
Cohesion: 0.04
Nodes (36): allLogs, analyticsRequest, autoRefresh, billingBreakdown, billingDialog, billingFxRate, billingMultiplier, billingPrimaryDimension (+28 more)

### Community 3 - "dependencies"
Cohesion: 0.10
Nodes (21): chart.js, dayjs, @element-plus/icons-vue, dependencies, axios, chart.js, dayjs, @element-plus/icons-vue (+13 more)

### Community 4 - "ApiKeys.vue"
Cohesion: 0.06
Nodes (32): activeCode, activeTab, channelLoading, channels, copiedKeyId, copyingKeyId, copyKey(), createDialog (+24 more)

### Community 5 - "dependencies"
Cohesion: 0.12
Nodes (17): dependencies, axios, dotenv, express, form-data, helmet, jsonwebtoken, pg (+9 more)

### Community 6 - "admin/Models.vue"
Cohesion: 0.08
Nodes (28): activeModels, activeProvider, activeType, asMultimodal(), currency(), dialogVisible, emptyForm(), expandedSections (+20 more)

### Community 7 - "Wallet.vue"
Cohesion: 0.08
Nodes (23): activeTab, availableBalance, fetchOrders(), fetchTx(), fetchWallet(), lo, ltx, oPage (+15 more)

### Community 8 - "admin.js"
Cohesion: 0.07
Nodes (34): { authenticate, requireAdmin }, axios, BILLING_MODEL_SOURCES, CHANNEL_BILLING_MODES, CHANNEL_PRICE_FIELDS, channelModelPayload(), { defaultImageDisplayPricing }, { encrypt, desensitize } (+26 more)

### Community 9 - "pricing-engine.js"
Cohesion: 0.06
Nodes (57): backupPlan(), createVerifiedBackup(), crypto, fs, main(), parseArguments(), path, sha256File() (+49 more)

### Community 10 - "user.js"
Cohesion: 0.15
Nodes (16): anthropicUpstreamHeaders(), postWithSafeFailover(), SAFE_FAILOVER_STATUSES, CHANNEL_PROTOCOLS, isSupportedChannelProtocol(), SUPPORTED_CHANNEL_PROTOCOLS, upstreamRequestHeaders(), axios (+8 more)

### Community 11 - "routing-group-models.js"
Cohesion: 0.09
Nodes (38): assertPostgresSchemaCurrent(), checkPostgres(), createPostgresPool(), ensureApiRequestLogPartitions(), resolveDatabaseUrl(), checkRedis(), createRedisClient(), resolveRedis() (+30 more)

### Community 12 - "pricing-sync.js"
Cohesion: 0.09
Nodes (30): axios, configScalar(), PostgresPricingSyncService, { PROVIDER_PAGES, inferProvider, parseOfficialPrices }, { withTransaction }, fs, logDir, logger (+22 more)

### Community 13 - "middleware/auth.js"
Cohesion: 0.06
Nodes (35): routingGroupMultiplierPayload(), requestMultipliers(), activeRule(), multiplierFields, multiplierPolicyContext(), positiveMultiplier(), resolveEffectiveMultiplierPolicy(), resolveModelMultiplierPolicy() (+27 more)

### Community 14 - "src/index.js"
Cohesion: 0.06
Nodes (33): adminRoutes, app, { authenticate, requireAdmin }, authRoutes, bootstrapAuthenticate, cors, { createApplicationRuntime }, { createBootstrapRouter, createRuntimeBootstrapAuthenticate } (+25 more)

### Community 15 - "init.js"
Cohesion: 0.25
Nodes (17): buildPricing(), buildRequestPricing(), capChatRequestToReservedBalance(), channelHasTokenPricing(), getUsdCnyRate(), insertSuccessLog(), positiveOrOne(), pricingModelForChannel() (+9 more)

### Community 16 - "src/views/admin/Keys.vue"
Cohesion: 0.12
Nodes (13): allModels, editingKeyId, expandedUsers, fetch(), groups, loading, modelGroups, page (+5 more)

### Community 17 - "src/views/admin/Users.vue"
Cohesion: 0.12
Nodes (16): adj, adjustDialog, adjusting, detailDialog, detailUser, doAdjust(), fetch(), limit (+8 more)

### Community 18 - "src/views/admin/Settings.vue"
Cohesion: 0.13
Nodes (17): baseConfigs, booleanConfigKeys, configs, enabled(), freshProvider(), load(), openProvider(), paymentConfigs (+9 more)

### Community 19 - "easypay-payment.test.js"
Cohesion: 0.18
Nodes (12): activeMapping(), asNumber(), GatewayScheduler, GatewaySchedulerError, IMAGE_INPUT_CAPABILITIES, includesGroup(), isEligible(), isRetryableUpstreamFailure() (+4 more)

### Community 20 - "user/Models.vue"
Cohesion: 0.20
Nodes (5): groups, hasApiKeys, loading, modelCount, router

### Community 21 - "Proposed Changes"
Cohesion: 0.10
Nodes (16): { authenticate }, bcrypt, { buildBillingDetail }, { buildEasyPayRequest, supportedPaymentMethods }, buildLogFilters(), { defaultImageDisplayPricing }, { encrypt, decrypt, desensitize }, express (+8 more)

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
Cohesion: 0.12
Nodes (14): api, billingFields, billingFieldsStart, canceledGuard, channels, currentDir, errorToast, frontendRoot (+6 more)

### Community 30 - "user/Dashboard.vue"
Cohesion: 0.10
Nodes (14): appStore, authStore, bootstrapWallet, chartLoading, DashboardCharts, hasApiKeys, hasStatsData, isMobile (+6 more)

### Community 31 - "Login.vue"
Cohesion: 0.22
Nodes (7): authStore, form, frm, loading, loginError, router, rules

### Community 32 - "Register.vue"
Cohesion: 0.22
Nodes (7): authStore, form, frm, loading, result, router, rules

### Community 33 - "getDatabase"
Cohesion: 0.13
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
Cohesion: 0.22
Nodes (5): { initDatabase, getDatabase }, proxyRoutes, require, TEST_IMAGE_BYTES, userRoutes

### Community 39 - "src/components/DashboardCharts.vue"
Cohesion: 0.05
Nodes (33): baseOptions, blockedCount, chartRoot, chartsVisible, failedCount, isMobile, LazyBarChart, modelChartData (+25 more)

### Community 40 - "ChangePassword.vue"
Cohesion: 0.33
Nodes (4): form, formRef, loading, rules

### Community 42 - "admin/Dashboard.vue"
Cohesion: 0.15
Nodes (9): AdminTrendChart, dashboardError, dashboardLoading, data, hasTrendData, isMobile, metrics, trendRoot (+1 more)

### Community 43 - "pricing-engine.js"
Cohesion: 0.22
Nodes (18): buildChannelImagePricing(), buildImagePricing(), calculateDimensions(), calculateImagePricing(), calculatePricing(), configuredImageUnitPrice(), defaultImageDisplayPricing(), hasNumericPrice() (+10 more)

### Community 44 - "registration.test.js"
Cohesion: 0.50
Nodes (3): authRoutes, { getDatabase, initDatabase }, require

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
Nodes (22): 1. 后端, 2. 前端, 3. 访问, IonAiLabs — AI API 中转平台, Nginx 配置（首次部署后执行一次）, 一键部署, 主要功能, 健康检查 (+14 more)

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
Cohesion: 0.11
Nodes (22): activeCode, activeGroup, activeModelGroup, activeProtocol, activeProtocolMeta, appStore, authStore, codeExamples (+14 more)

### Community 74 - "image-billing.js"
Cohesion: 0.26
Nodes (14): classifyImageBillingTier(), countGeneratedImages(), decodeImageDimensions(), explicitImageSize(), generatedImageOutputSizes(), IMAGE_BILLING_TIERS, imageBillingIntent(), imagePriceForSize() (+6 more)

### Community 75 - "easypay.js"
Cohesion: 0.13
Nodes (13): allModels, currentDir, fadeContent, frontendRoot, landing, landingCss, login, modelGroups (+5 more)

### Community 76 - "handleImageBilledRequest"
Cohesion: 0.23
Nodes (5): LOG_FIELDS, PostgresSettlementRepository, { randomUUID }, WALLET_FIELDS, { withTransaction }

### Community 77 - "billing.test.js"
Cohesion: 0.60
Nodes (8): deductWalletBalance(), insertTransaction(), numeric(), positiveAmount(), releaseWalletReservation(), reserveWalletBalance(), settleWalletReservation(), walletBalances()

### Community 78 - "anthropic-protocol.test.js"
Cohesion: 0.25
Nodes (6): adminRoutes, { generateToken }, { initDatabase, getDatabase }, proxyRoutes, require, userRoutes

### Community 79 - "loadAll"
Cohesion: 0.29
Nodes (7): deleteChannel(), loadAll(), loadChannels(), saveChannel(), saveMappings(), syncModels(), toggleChannel()

### Community 80 - "user-model-multipliers.test.js"
Cohesion: 0.12
Nodes (18): apiKeyAuthError(), apiKeyFromRequest(), authenticate(), authenticateApiKey(), bcrypt, findApiKey(), generateToken(), { getDatabase } (+10 more)

### Community 81 - "fetchAll"
Cohesion: 0.40
Nodes (5): fetchAll(), getPresetRange(), onPresetChange(), scheduleCharts(), toggleAutoRefresh()

### Community 83 - "init.js"
Cohesion: 0.20
Nodes (18): handleMultipartImageRequest(), appendFields(), appendFile(), arrayValue(), assertSupportedFields(), compactBody(), createMultipartPayload(), detectedImageMimeType() (+10 more)

### Community 84 - "loadGroups"
Cohesion: 0.50
Nodes (4): deleteGroup(), loadGroups(), saveGroup(), toggleGroup()

### Community 86 - "easypay-payment.test.js"
Cohesion: 0.22
Nodes (8): callbackFields(), { encrypt }, { generateToken }, { initDatabase, getDatabase }, paymentRoutes, require, signEasyPay(), userRoutes

### Community 87 - "channel-selector.js"
Cohesion: 0.05
Nodes (37): { ACCOUNT_CAPABILITIES, ACCOUNT_PROTOCOLS }, asArray(), asObject(), axios, { defaultImageDisplayPricing }, generatedKey(), { inferProvider }, normalizedUrl() (+29 more)

### Community 88 - "channel-docs.js"
Cohesion: 0.11
Nodes (19): chrome-launcher, devDependencies, chrome-launcher, lighthouse, @playwright/test, sass, terser, unplugin-auto-import (+11 more)

### Community 89 - "payment.js"
Cohesion: 0.25
Nodes (9): easypayNotify(), express, fail(), { getDatabase }, { grantQuotaOrder }, router, { verifyEasyPayCallback }, grantQuotaOrder() (+1 more)

### Community 90 - "channel-capabilities.js"
Cohesion: 0.13
Nodes (15): scripts, build, dev, preview, test:first-paint-budget, test:http-channel-contracts, test:landing, test:login-bootstrap (+7 more)

### Community 91 - "user-model-multipliers.test.js"
Cohesion: 0.10
Nodes (18): aggregatePhase, appStore, authStore, backgroundAuthIndex, currentDir, dashboard, fallbackPhase, fallbackStart (+10 more)

### Community 92 - "billing-detail.js"
Cohesion: 0.12
Nodes (20): asObject(), configBoolean(), createPostgresPaymentService(), crypto, moneyFromConfig(), normalizedBaseUrl(), parseMoney(), parseStoredOrderMoney() (+12 more)

### Community 93 - "public.js"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 95 - "model-sync.js"
Cohesion: 0.33
Nodes (6): asyncRoute(), createBootstrapRouter(), createRuntimeBootstrapAuthenticate(), express, serve(), servers

### Community 96 - "check-user-actions.mjs"
Cohesion: 0.33
Nodes (4): apiKeys, router, userRoutes, wallet

### Community 97 - "element-plus"
Cohesion: 0.11
Nodes (5): express, authenticateApiKey(), baseOptions(), listen(), servers

### Community 98 - "migrate-postgres.js"
Cohesion: 0.12
Nodes (22): assertChecksum(), buildSchemaMigrationsBootstrapSql(), buildTransactionalMigrationSql(), crypto, discoverMigrations(), fs, loadMigration(), main() (+14 more)

### Community 99 - "vue-chartjs"
Cohesion: 0.33
Nodes (3): LegacyControlPlaneRepository, parseCapabilities(), { randomUUID }

### Community 100 - "vue-router"
Cohesion: 0.20
Nodes (8): {
  calculateImagePricing,
  calculatePricing,
  resolveImageUnitPrice,
}, {
  generatedImageOutputSizes,
  resolveImageBillingSize,
}, jsonObject(), numeric(), positive(), PostgresProxyBillingPolicy, PostgresProxyRepository, price()

### Community 101 - "DashboardReadModel"
Cohesion: 0.27
Nodes (4): cacheValue(), DashboardReadModel, normalizeLogQuery(), positiveInteger()

### Community 102 - "UsageSettlement"
Cohesion: 0.11
Nodes (21): { buildBillingDetailFromSnapshot }, numberValues(), pgLogFilters(), PostgresDashboardRepository, publicLog(), amount(), assertReservation(), balances() (+13 more)

### Community 103 - "基础设施健康契约"
Cohesion: 0.50
Nodes (3): Readiness, 基础设施健康契约, 运行边界

### Community 105 - "dayjs"
Cohesion: 0.17
Nodes (4): createGatewayScheduler(), BehaviorRedis, listCandidates(), schedulerAccount()

### Community 106 - "echarts"
Cohesion: 0.27
Nodes (4): mapAccountRows(), numberValue(), parseJson(), PostgresAccountRepository

### Community 107 - "gsap"
Cohesion: 0.31
Nodes (5): asString(), extendRedisCooldown(), normalizeRedisKeyPrefix(), redisAccountKey(), RedisLeaseStore

### Community 108 - "easypay.js"
Cohesion: 0.18
Nodes (17): paymentProviderPayload(), publicPaymentProvider(), crypto, decrypt(), desensitize(), encrypt(), getKey(), buildEasyPayRequest() (+9 more)

### Community 109 - "ensureModels"
Cohesion: 0.67
Nodes (3): ensureModels(), openGroup(), openMappings()

### Community 112 - "postgres-tasks.js"
Cohesion: 0.16
Nodes (19): accountHeaders(), aggregateUsage(), axios, createPostgresWorkerTasks(), dateInBeijing(), { extendRedisCooldown }, isIsoDate(), maintainPartitions() (+11 more)

### Community 113 - "withTransaction"
Cohesion: 0.12
Nodes (26): asObject(), { buildBillingDetailFromSnapshot }, buildChannelProtocolDocs(), buildLogFilters(), { createPostgresIdentity }, { createPostgresPaymentService }, createPostgresUserRouter(), csvField() (+18 more)

### Community 114 - "multiplier-policy.js"
Cohesion: 0.15
Nodes (11): cappedMemoryStorage(), createImageUploadMiddleware(), createTransformationBody(), dataUrl(), imageOperationForEndpoint(), ImageRequestExecutor, multer, file() (+3 more)

### Community 115 - "backend/package.json"
Cohesion: 0.29
Nodes (7): autocannon, devDependencies, autocannon, nodemon, vitest, nodemon, vitest

### Community 116 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, backup:sqljs, create-initial-admin, dev, import:control-plane, load:autocannon, load:mock, migrate:postgres (+5 more)

### Community 121 - "pricingPayload"
Cohesion: 0.30
Nodes (9): browserElapsedMs(), CORE_DATA_BUDGET_MS, delayedJson(), installSessionMocks(), json(), localUsers, userOverview(), mockAdminUsers() (+1 more)

### Community 122 - "channel-model-policy.js"
Cohesion: 0.18
Nodes (5): isLoopback, loopbackHosts, metricBudgets, target, thresholds

### Community 123 - "crypto.js"
Cohesion: 0.18
Nodes (4): RedisSnapshotCache, firstSetting(), anthropicReservationUsage(), PaymentOptionsPool

### Community 125 - "model-sync.js"
Cohesion: 0.22
Nodes (8): main, name, overrides, body-parser, brace-expansion, hyperid, postcss, version

### Community 126 - "axios"
Cohesion: 0.10
Nodes (25): availableScenarioNames(), boundedPositive(), createAutocannonScenario(), { requestHeaders }, SCENARIOS, createMockUpstreamServer(), http, isChatPath() (+17 more)

### Community 128 - "cors"
Cohesion: 0.30
Nodes (10): applyReleaseControlPlaneOverrides(), assertVerified(), { createPostgresPool, withTransaction }, main(), path, { randomUUID }, readTarget(), releaseOverridePlan() (+2 more)

### Community 129 - "dotenv"
Cohesion: 0.27
Nodes (11): availableWalletBalance(), channelBillingForModel(), handleImageBilledRequest(), insertImageSettlementFailureLog(), insertImageSuccessLog(), insertSettlementFailureLog(), insertUpstreamFailureLog(), requestContainsImage() (+3 more)

### Community 130 - "express"
Cohesion: 0.38
Nodes (5): createRuntimeRouter(), { createRuntimeRouter }, require, serve(), servers

### Community 132 - "helmet"
Cohesion: 0.33
Nodes (5): frontendRoot, isLoopback, loopbackHosts, port, target

### Community 135 - "uuid"
Cohesion: 0.43
Nodes (5): requestPath(), SENSITIVE_ACCESS_LOG_PATHS, shouldSkipAccessLog(), require, { shouldSkipAccessLog }

### Community 136 - "vue-chartjs"
Cohesion: 0.15
Nodes (21): isoDate(), LegacyDashboardRepository, legacyWhere(), { listModelsForApiKey, mergeAvailableModel }, listModels(), channelModelSupportsImageInput(), channelSupportsCapability(), apiKeyCanUseModel() (+13 more)

### Community 138 - "dashboard-read-model/legacy-repository.js"
Cohesion: 0.11
Nodes (20): start(), requireAdmin(), AdminCompatError, actorFromRequest(), asyncRoute(), { authenticate: defaultAuthenticate, requireAdmin: defaultRequireAdmin }, BOOLEAN_CONFIG_KEYS, boundedInteger() (+12 more)

### Community 139 - ".key"
Cohesion: 0.16
Nodes (11): main(), secretBoxFromEnvironment(), createSecretBox(), crypto, fromBase64Url(), normalizeKey(), normalizeKeyring(), parseEnvelope() (+3 more)

### Community 140 - "billing-detail.js"
Cohesion: 0.10
Nodes (18): apiKeyAad(), bcryptjs, createPostgresIdentity(), desensitizeKey(), jwtLibrary, { createPostgresAdminRouter }, { createPostgresIdentity }, { createPostgresUserRouter } (+10 more)

### Community 141 - "channel-capabilities.js"
Cohesion: 0.23
Nodes (13): appendMultipartValue(), authorizationHeaders(), executeJsonUpstream(), executeMultipartUpstream(), multipartBody(), retryAfterMilliseconds(), SAFE_RESPONSE_HEADERS, safeResponseHeaders() (+5 more)

### Community 142 - "channel-docs.js"
Cohesion: 0.31
Nodes (9): capacity(), chat(), isLocalTarget, options, params(), post(), rateLimitFailover(), target (+1 more)

### Community 145 - "control-plane/postgres-repository.js"
Cohesion: 0.27
Nodes (4): accountKey(), PostgresControlPlaneRepository, { randomUUID }, { withTransaction }

### Community 146 - "postgres-proxy.js"
Cohesion: 0.16
Nodes (13): jsonEventsFromSnapshot(), jsonFromSnapshot(), writeSnapshot(), { countGeneratedImages }, createPostgresProxyRouter(), { extractUsage }, finishSnapshotResponse(), identityFromRequest() (+5 more)

### Community 148 - "withTransaction"
Cohesion: 0.15
Nodes (12): compatibleEmail(), createPostgresAuthRouter(), { createPostgresIdentity }, express, jsonConfigValue(), publicEmail(), { withTransaction }, { buildChannelProtocolDocs, createPostgresUserRouter, effectiveModelCapabilities } (+4 more)

### Community 149 - "postgres-public.test.js"
Cohesion: 0.27
Nodes (7): configBoolean(), configMap(), createPostgresPublicRouter(), express, { createPostgresPublicRouter }, require, servers

### Community 151 - "PostgreSQL/Redis 隔离演练与发布准备记录"
Cohesion: 0.22
Nodes (8): PostgreSQL/Redis 隔离演练与发布准备记录, SQL.js 备份与控制面导入, 上线前门禁与回滚, 测试与性能, 渠道、图片与计费证据, 演练中修复的问题, 迁移核对, 隔离运行环境

### Community 152 - "mock-upstream.js"
Cohesion: 0.22
Nodes (6): createPostgresPaymentRouter(), express, { createPostgresPaymentRouter }, { createPostgresPaymentService }, { createPostgresUserRouter }, require

### Community 153 - "runtime-router.test.js"
Cohesion: 0.29
Nodes (5): { generateToken }, { initDatabase, getDatabase }, insertLog(), require, userRoutes

### Community 154 - "postgres-admin.test.js"
Cohesion: 0.48
Nodes (6): ALLOWED_CHANNEL_CAPABILITIES, CHANNEL_CAPABILITIES_BY_PROTOCOL, DEFAULT_CHANNEL_CAPABILITIES, defaultChannelCapabilities(), parseChannelCapabilities(), serializeChannelCapabilities()

### Community 158 - "createTransformationBody"
Cohesion: 0.33
Nodes (4): adminRoutes, { generateToken }, { initDatabase, getDatabase }, require

### Community 159 - "性能与压测验证"
Cohesion: 0.33
Nodes (5): 安全边界, 性能与压测验证, 本地执行顺序, 浏览器基线配置, 验收指标

### Community 160 - "cors"
Cohesion: 0.33
Nodes (4): { generateToken }, { initDatabase, getDatabase }, require, userRoutes

### Community 161 - "worker-runtime.test.js"
Cohesion: 0.12
Nodes (14): checkPostgresSchema(), crypto, fs, inspectCurrentRequestLogPartition(), inspectPostgresSchema(), path, readPostgresMigrationManifest(), resolvePg() (+6 more)

### Community 163 - "request-limits.js"
Cohesion: 0.60
Nodes (3): positiveInteger(), PROVIDER_OUTPUT_LIMITS, resolveChatOutputLimit()

## Knowledge Gaps
- **941 isolated node(s):** `backup.sh script`, `{ requestHeaders }`, `SCENARIOS`, `target`, `isLocalTarget` (+936 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **27 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PostgresAdminCompatRepository` connect `channel-selector.js` to `dashboard-read-model/legacy-repository.js`, `billing-detail.js`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `withTransaction()` connect `cors` to `worker-runtime.test.js`, `pricing-engine.js`, `.key`, `pricing-sync.js`, `handleImageBilledRequest`, `postgres-tasks.js`, `control-plane/postgres-repository.js`, `withTransaction`, `withTransaction`, `channel-selector.js`, `billing-detail.js`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `getDatabase()` connect `getDatabase` to `proxy.js`, `dotenv`, `admin.js`, `vue-chartjs`, `dashboard-read-model/legacy-repository.js`, `src/index.js`, `Proposed Changes`, `model-capabilities.test.js`, `runtime-router.test.js`, `billing-detail.js`, `createTransformationBody`, `cors`, `admin-finance.test.js`, `image-generations.test.js`, `registration.test.js`, `billing.test.js`, `anthropic-protocol.test.js`, `user-model-multipliers.test.js`, `easypay-payment.test.js`, `payment.js`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `backup.sh script`, `{ requestHeaders }`, `SCENARIOS` to the rest of the system?**
  _941 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `proxy.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06342494714587738 - nodes in this community are weakly interconnected._
- **Should `src/views/admin/Channels.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `user/Logs.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._