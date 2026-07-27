# Graph Report - ai-api-proxy  (2026-07-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 884 nodes · 1286 edges · 62 communities (50 shown, 12 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 75 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

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
- init.js
- pricing-engine.js
- routing-group-models.js
- pricing-sync.js
- middleware/auth.js
- src/index.js
- user.js
- src/views/admin/Keys.vue
- src/views/admin/Users.vue
- src/views/admin/Settings.vue
- easypay-payment.test.js
- user/Models.vue
- easypay.js
- model-capabilities.test.js
- AdminLayout.vue
- src/views/admin/Pricing.vue
- UserLayout.vue
- Subscribe.vue
- payment.js
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
- model-sync.js
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

## God Nodes (most connected - your core abstractions)
1. `getDatabase()` - 33 edges
2. `handleImageBilledRequest()` - 31 edges
3. `initDatabase()` - 26 edges
4. `saveDatabase()` - 11 edges
5. `listModelsForApiKey()` - 10 edges
6. `buildRequestPricing()` - 9 edges
7. `walletBalances()` - 9 edges
8. `loadAll()` - 9 edges
9. `buildPricing()` - 8 edges
10. `resolveFixedUnitPrice()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `createOrder()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/tests/admin-finance.test.js → backend/src/database/init.js
- `main()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/scripts/create-initial-admin.js → backend/src/database/init.js
- `seed()` --calls--> `saveDatabase()`  [EXTRACTED]
  backend/src/database/seed-models.js → backend/src/database/init.js
- `seed()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/src/database/seed.js → backend/src/database/init.js
- `seed()` --calls--> `getDatabase()`  [EXTRACTED]
  backend/src/database/seed-viewer.js → backend/src/database/init.js

## Import Cycles
- None detected.

## Communities (62 total, 12 thin omitted)

### Community 0 - "proxy.js"
Cohesion: 0.05
Nodes (77): { apiKeyCanUseModel, listModelsForApiKey }, assertSupportedBillableInput(), { authenticateApiKey }, availableWalletBalance(), axios, billableTextProjection(), {
  billingModeForRequest,
  channelTokenOfficial,
  resolveBillingModel,
  resolveFixedUnitPrice,
}, buildChannelImagePricing() (+69 more)

### Community 1 - "src/views/admin/Channels.vue"
Cohesion: 0.05
Nodes (43): activeChannels, activeGroups, billingFields, channelDialog, channelForm, channelLoading, channels, collapsedSections (+35 more)

### Community 2 - "user/Logs.vue"
Cohesion: 0.05
Nodes (40): allLogs, autoRefresh, billingBreakdown, billingDialog, billingSum, billingTitle, billingVersion, chartsReady (+32 more)

### Community 3 - "dependencies"
Cohesion: 0.04
Nodes (45): dayjs, echarts, echarts-liquidfill, element-plus, @element-plus/icons-vue, dependencies, axios, dayjs (+37 more)

### Community 4 - "ApiKeys.vue"
Cohesion: 0.05
Nodes (36): activeCode, activeTab, channelLoading, channels, copyExported(), copyKey(), createDialog, createKey() (+28 more)

### Community 5 - "dependencies"
Cohesion: 0.05
Nodes (39): dependencies, axios, bcryptjs, cors, dotenv, express, express-rate-limit, helmet (+31 more)

### Community 6 - "admin/Models.vue"
Cohesion: 0.09
Nodes (26): activeModels, activeProvider, activeType, asMultimodal(), dialogVisible, emptyForm(), expandedSections, fetchModels() (+18 more)

### Community 7 - "Wallet.vue"
Cohesion: 0.08
Nodes (22): activeTab, availableBalance, fetchOrders(), fetchTx(), fetchWallet(), lo, ltx, oPage (+14 more)

### Community 8 - "admin.js"
Cohesion: 0.10
Nodes (22): { authenticate, requireAdmin }, axios, BILLING_MODEL_SOURCES, CHANNEL_BILLING_MODES, CHANNEL_PRICE_FIELDS, channelModelPayload(), { encrypt, desensitize }, express (+14 more)

### Community 9 - "init.js"
Cohesion: 0.14
Nodes (22): bcrypt, { initDatabase, getDatabase, saveDatabase }, main(), createTables(), fs, initDatabase(), initSqlJs, logger (+14 more)

### Community 10 - "pricing-engine.js"
Cohesion: 0.18
Nodes (20): hasBillableUsage(), buildBillingDetail(), { calculatePricing }, number(), perMillionPrice(), rounded(), calculateDimensions(), calculateImagePricing() (+12 more)

### Community 11 - "routing-group-models.js"
Cohesion: 0.18
Nodes (19): ALLOWED_CHANNEL_CAPABILITIES, channelModelSupportsImageInput(), channelSupportsCapability(), DEFAULT_CHANNEL_CAPABILITIES, parseChannelCapabilities(), serializeChannelCapabilities(), axios, { channelModelSupportsImageInput, channelSupportsCapability } (+11 more)

### Community 12 - "pricing-sync.js"
Cohesion: 0.14
Nodes (19): fs, logDir, logger, path, winston, axios, currencyFromSymbol(), fetchProviderPage() (+11 more)

### Community 13 - "middleware/auth.js"
Cohesion: 0.11
Nodes (17): authenticate(), authenticateApiKey(), bcrypt, findApiKey(), generateToken(), { getDatabase }, jwt, requireAdmin() (+9 more)

### Community 14 - "src/index.js"
Cohesion: 0.11
Nodes (18): adminRoutes, app, authRoutes, cors, express, globalLimiter, helmet, { initDatabase, getDatabase } (+10 more)

### Community 15 - "user.js"
Cohesion: 0.12
Nodes (15): { authenticate }, bcrypt, { buildBillingDetail }, { buildEasyPayRequest, supportedPaymentMethods }, { encrypt, decrypt, desensitize }, express, { generateDocs }, { getDatabase } (+7 more)

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
Cohesion: 0.16
Nodes (12): crypto, desensitize(), encrypt(), getKey(), callbackFields(), { encrypt }, { generateToken }, { initDatabase, getDatabase } (+4 more)

### Community 20 - "user/Models.vue"
Cohesion: 0.13
Nodes (10): activeProvider, activeType, filteredModels, loading, models, providerModels, providers, providerTabs (+2 more)

### Community 21 - "easypay.js"
Cohesion: 0.25
Nodes (13): paymentProviderPayload(), publicPaymentProvider(), decrypt(), buildEasyPayRequest(), crypto, { decrypt }, normalizedBaseUrl(), paymentTypeFor() (+5 more)

### Community 22 - "model-capabilities.test.js"
Cohesion: 0.14
Nodes (11): express, { getDatabase }, { listSystemModelCapabilities }, router, adminRoutes, { generateToken }, { initDatabase, getDatabase }, proxyRoutes (+3 more)

### Community 23 - "AdminLayout.vue"
Cohesion: 0.15
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

### Community 27 - "payment.js"
Cohesion: 0.25
Nodes (9): easypayNotify(), express, fail(), { getDatabase }, { grantQuotaOrder }, router, { verifyEasyPayCallback }, grantQuotaOrder() (+1 more)

### Community 28 - "src/views/admin/Orders.vue"
Cohesion: 0.22
Nodes (8): confirmOrder(), fetch(), loading, orders, page, rejectOrder(), statusFilter, total

### Community 29 - "src/components/logs/UsageCharts.vue"
Cohesion: 0.20
Nodes (8): costGaugeOption, isMobile, modelPieOption, modelRankOption, props, showDesktopEmptyState, tokenGaugeOption, totalTokens

### Community 30 - "user/Dashboard.vue"
Cohesion: 0.20
Nodes (8): appStore, chartLoading, DashboardCharts, isMobile, models, stats, todaySuccess, wallet

### Community 31 - "Login.vue"
Cohesion: 0.22
Nodes (7): authStore, form, frm, loading, loginError, router, rules

### Community 32 - "Register.vue"
Cohesion: 0.22
Nodes (7): authStore, form, frm, loading, result, router, rules

### Community 33 - "getDatabase"
Cohesion: 0.29
Nodes (6): getDatabase(), { initDatabase, getDatabase, saveDatabase }, MODELS, seed(), start(), listModels()

### Community 34 - "check-mobile-bundle.mjs"
Cohesion: 0.25
Nodes (6): distDir, html, oversizedElementBundle, projectDir, scriptBytes, styleBytes

### Community 35 - "admin-finance.test.js"
Cohesion: 0.29
Nodes (5): adminRoutes, createOrder(), { generateToken }, { initDatabase, getDatabase }, require

### Community 36 - "main.js"
Cohesion: 0.33
Nodes (4): authStore, app, router, routes

### Community 37 - "admin/Logs.vue"
Cohesion: 0.29
Nodes (5): f, loading, logs, page, total

### Community 38 - "image-generations.test.js"
Cohesion: 0.33
Nodes (4): { initDatabase, getDatabase }, proxyRoutes, require, userRoutes

### Community 39 - "src/components/DashboardCharts.vue"
Cohesion: 0.33
Nodes (5): isMobile, modelRankOption, props, showDesktopEmptyState, todayStatsOption

### Community 40 - "ChangePassword.vue"
Cohesion: 0.33
Nodes (4): form, formRef, loading, rules

### Community 42 - "admin/Dashboard.vue"
Cohesion: 0.40
Nodes (4): AdminTrendChart, data, isMobile, metrics

### Community 44 - "registration.test.js"
Cohesion: 0.50
Nodes (3): authRoutes, { getDatabase, initDatabase }, require

### Community 45 - "components.d.ts"
Cohesion: 0.50
Nodes (3): ComponentCustomProperties, GlobalComponents, vue

## Knowledge Gaps
- **454 isolated node(s):** `backup.sh script`, `name`, `version`, `main`, `start` (+449 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDatabase()` connect `getDatabase` to `proxy.js`, `admin-finance.test.js`, `image-generations.test.js`, `admin.js`, `init.js`, `routing-group-models.js`, `pricing-sync.js`, `middleware/auth.js`, `src/index.js`, `user.js`, `registration.test.js`, `easypay-payment.test.js`, `model-capabilities.test.js`, `payment.js`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `initDatabase()` connect `init.js` to `proxy.js`, `getDatabase`, `admin-finance.test.js`, `image-generations.test.js`, `routing-group-models.js`, `pricing-sync.js`, `middleware/auth.js`, `src/index.js`, `registration.test.js`, `easypay-payment.test.js`, `model-capabilities.test.js`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `listModelsForApiKey()` connect `routing-group-models.js` to `admin.js`, `proxy.js`, `user.js`, `getDatabase`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `backup.sh script`, `name`, `version` to the rest of the system?**
  _454 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `proxy.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05268414481897628 - nodes in this community are weakly interconnected._
- **Should `src/views/admin/Channels.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.05230496453900709 - nodes in this community are weakly interconnected._
- **Should `user/Logs.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.04902867715078631 - nodes in this community are weakly interconnected._