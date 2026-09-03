# Graph Report - .  (2026-09-03)

## Corpus Check
- Large corpus: 254 files · ~356,568 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 4856 nodes · 7266 edges · 296 communities detected
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 291 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 254 · Candidates: 373
- Excluded: 114 untracked · 37135 ignored · 3 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `68457ba`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `src/index.js` - 77 edges
2. `src/views/admin/Logs.vue` - 73 edges
3. `PostgresAdminCompatRepository` - 66 edges
4. `PostgresAdminCompatRepository` - 66 edges
5. `src/views/admin/Channels.vue` - 50 edges
6. `user/Logs.vue` - 43 edges
7. `getDatabase()` - 39 edges
8. `initDatabase()` - 32 edges
9. `src/views/admin/Models.vue` - 30 edges
10. `handleImageBilledRequest()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `createMockUpstreamServer()` --indirect_call--> `delay()`  [INFERRED]
  backend/load/mock-upstream.js → frontend/src/views/user/Wallet.vue
- `buildChannelProtocolDocs()` --indirect_call--> `enabled()`  [INFERRED]
  backend/src/routes/postgres-user.js → frontend/src/views/admin/Settings.vue
- `resolveEffectiveMultiplierPolicy()` --indirect_call--> `source()`  [INFERRED]
  backend/src/utils/multiplier-policy.js → frontend/scripts/check-first-paint-budget.mjs
- `src/components/DashboardCharts.vue` --dynamic_import--> `@/components/charts/LazyBarChart.vue`  [EXTRACTED]
  frontend/src/components/DashboardCharts.vue → @/components/charts/LazyBarChart.vue
- `admin/Dashboard.vue` --dynamic_import--> `@/components/AdminTrendChart.vue`  [EXTRACTED]
  frontend/src/views/admin/Dashboard.vue → @/components/AdminTrendChart.vue

## Communities

### Community 24 - "src/views/admin/Pricing.vue"
Cohesion: 0.07
Nodes (25): { requestHeaders }, SCENARIOS, boundedPositive(), availableScenarioNames(), createAutocannonScenario(), http, createMockUpstreamServer(), { resolveLoadConfig } (+17 more)

### Community 169 - "live-admin-dashboard.spec.mjs"
Cohesion: 0.31
Nodes (9): target, isLocalTarget, options, params(), post(), chat(), capacity(), rateLimitFailover() (+1 more)

### Community 282 - "Community 282"
Cohesion: 1
Nodes (1): schema_migrations

### Community 69 - "Sub2API 图片自动生图：用户调用记录显示的模型"
Cohesion: 0.19
Nodes (20): staff_users, models, pricing_rules, system_config, payment_providers, upstream_accounts, account_models, routing_groups (+12 more)

### Community 221 - "Community 221"
Cohesion: 0.53
Nodes (5): usage_reservations, users, api_keys, upstream_account_probes, upstream_accounts

### Community 254 - "Community 254"
Cohesion: 0.83
Nodes (3): user_api_key_daily_usage, users, api_keys

### Community 170 - "openLogDetail"
Cohesion: 0.31
Nodes (9): { randomUUID }, path, { createPostgresPool, withTransaction }, releaseOverridePlan(), sameJson(), readTarget(), assertVerified(), applyReleaseControlPlaneOverrides() (+1 more)

### Community 102 - "apply-release-control-plane-overrides.js"
Cohesion: 0.16
Nodes (16): crypto, fs, path, timestamp(), sha256File(), parseArguments(), backupPlan(), createVerifiedBackup() (+8 more)

### Community 25 - "UserLayout.vue"
Cohesion: 0.08
Nodes (27): bcrypt, { initDatabase, getDatabase, saveDatabase }, initSqlJs, path, fs, os, logger, migrateRoutingGroups() (+19 more)

### Community 146 - "postgres-proxy.js"
Cohesion: 0.2
Nodes (10): fs, path, { createPostgresPool, withTransaction }, { createSecretBox }, { decrypt: decryptLegacySecret }, { sha256File }, {
  createPostgresControlPlaneSink,
  executeControlPlaneImport,
  loadSqlJsControlPlaneSnapshot,
}, parseImportArguments() (+2 more)

### Community 11 - "routing-group-models.js"
Cohesion: 0.06
Nodes (39): crypto, fs, path, { spawnSync }, { resolveDatabaseUrl }, discoverMigrations(), sha256(), parseAppliedMigrations() (+31 more)

### Community 7 - "Wallet.vue"
Cohesion: 0.05
Nodes (41): express, cors, helmet, morgan, rateLimit, { initDatabase, getDatabase }, { createApplicationRuntime }, { createBootstrapRouter, createRuntimeBootstrapAuthenticate } (+33 more)

### Community 40 - "ChangePassword.vue"
Cohesion: 0.1
Nodes (26): crypto, fs, path, resolvePg(), resolveDatabaseUrl(), createPostgresPool(), readPostgresMigrationManifest(), inspectPostgresSchema() (+18 more)

### Community 158 - "axios"
Cohesion: 0.2
Nodes (5): withTransaction(), { randomUUID }, { withTransaction }, accountKey(), PostgresControlPlaneRepository

### Community 41 - "src/components/AdminTrendChart.vue"
Cohesion: 0.09
Nodes (15): resolveRedis(), createRedisClient(), checkRedis(), WorkerHeartbeat, BackgroundWorker, path, {
  assertPostgresSchemaCurrent,
  checkPostgres,
  createPostgresPool,
  ensureApiRequestLogPartitions,
  resolveDatabaseUrl,
}, { createRedisClient, checkRedis } (+7 more)

### Community 49 - "time.js"
Cohesion: 0.15
Nodes (23): fs, crypto, CONTROL_PLANE_USER_ROLES, EXCLUDED_USER_PLANE_TABLES, CUTOVER_DISABLED_CONFIG, jsonValue(), stableKey(), finiteNumber() (+15 more)

### Community 252 - "Community 252"
Cohesion: 0.4
Nodes (5): rowsFromSqlJs(), hasSqlJsTable(), tableRows(), legacyControlPlaneSnapshot(), loadSqlJsControlPlaneSnapshot()

### Community 119 - "usage-settlement/index.js"
Cohesion: 0.13
Nodes (15): createPostgresControlPlaneSink(), require, {
  buildControlPlaneImportPlan,
  createPostgresControlPlaneSink,
  executeControlPlaneImport,
}, { createSecretBox }, snapshot, plan, writes, secretBox (+7 more)

### Community 60 - "Docs.vue"
Cohesion: 0.11
Nodes (15): jwt, bcrypt, { getDatabase }, findApiKey(), apiKeyFromRequest(), apiKeyAuthError(), authenticate(), authenticateApiKey() (+7 more)

### Community 76 - "usage-settlement/index.js"
Cohesion: 0.1
Nodes (18): generateToken(), require, { initDatabase, getDatabase }, { generateToken }, adminRoutes, db, admin, app (+10 more)

### Community 53 - "api/index.js"
Cohesion: 0.11
Nodes (17): axios, { withTransaction }, { extendRedisCooldown }, { PostgresPricingSyncService }, { UsageSettlement }, { PostgresSettlementRepository }, { PostgresProxyBillingPolicy }, validateRetentionDays() (+9 more)

### Community 81 - "fetchAll"
Cohesion: 0.13
Nodes (16): { randomUUID }, axios, { withTransaction }, { ACCOUNT_CAPABILITIES, ACCOUNT_PROTOCOLS }, { normalizeUpstreamModels, inferModelType }, { inferProvider }, {
  canonicalImagePrices,
  hasCompleteImagePrices,
  missingImagePriceTiers,
}, { buildBillingDetailFromSnapshot } (+8 more)

### Community 44 - "registration.test.js"
Cohesion: 0.17
Nodes (10): AdminCompatError, text(), optionalNumber(), positiveInteger(), positiveWeight(), positiveMultiplier(), optionalTimestamp(), status() (+2 more)

### Community 230 - "Community 230"
Cohesion: 0.33
Nodes (2): asArray(), publicChannel()

### Community 22 - "model-capabilities.test.js"
Cohesion: 0.08
Nodes (1): PostgresAdminCompatRepository

### Community 122 - "channel-model-policy.js"
Cohesion: 0.21
Nodes (10): { randomUUID }, ACCOUNT_PROTOCOLS, ACCOUNT_CAPABILITIES, SECRET_FIELDS, controlPlaneError(), sanitize(), integerLimit(), naturalAccountKey() (+2 more)

### Community 206 - "Community 206"
Cohesion: 0.29
Nodes (2): { randomUUID }, LegacyControlPlaneRepository

### Community 159 - "性能与压测验证"
Cohesion: 0.29
Nodes (4): positiveInteger(), normalizeLogQuery(), cacheValue(), DashboardReadModel

### Community 182 - "Community 182"
Cohesion: 0.33
Nodes (4): { listModelsForApiKey, mergeAvailableModel }, isoDate(), legacyWhere(), LegacyDashboardRepository

### Community 91 - "user-model-multipliers.test.js"
Cohesion: 0.19
Nodes (12): { buildBillingDetailFromSnapshot }, numberValues(), pgLogFilters(), PostgresDashboardRepository, { calculatePricing }, number(), rounded(), object() (+4 more)

### Community 43 - "pricing-engine.js"
Cohesion: 0.09
Nodes (21): RedisSnapshotCache, path, {
  assertPostgresSchemaCurrent,
  checkPostgres,
  checkPostgresSchema,
  createPostgresPool,
  ensureApiRequestLogPartitions,
  resolveDatabaseUrl,
}, { createRedisClient, checkRedis }, { createSecretBox }, { ControlPlane }, { LegacyControlPlaneRepository }, { PostgresControlPlaneRepository } (+13 more)

### Community 17 - "src/views/admin/Users.vue"
Cohesion: 0.09
Nodes (22): { randomUUID }, { PostgresAccountRepository }, IMAGE_INPUT_CAPABILITIES, GatewaySchedulerError, asNumber(), asString(), normalizeRedisKeyPrefix(), redisAccountKey() (+14 more)

### Community 61 - "vite.config.js"
Cohesion: 0.09
Nodes (12): bcryptjs, jwtLibrary, createPostgresIdentity(), express, { withTransaction }, { createPostgresIdentity }, createPostgresAuthRouter(), require (+4 more)

### Community 65 - "Sub2API 渠道与分组管理调研（2026-07-15）"
Cohesion: 0.15
Nodes (16): crypto, { randomUUID }, { withTransaction }, PostgresPaymentError, asObject(), supportedPaymentMethods(), parseMoney(), parseStoredOrderMoney() (+8 more)

### Community 173 - "postgres-payment.js"
Cohesion: 0.2
Nodes (9): createPostgresPaymentService(), require, { createPostgresPaymentService, signEasyPay }, { createSecretBox }, suffix, secretBox, userId, service (+1 more)

### Community 82 - "formatTokenUnit"
Cohesion: 0.22
Nodes (9): {
  calculateImagePricing,
  calculatePricing,
  resolveImageUnitPrice,
}, {
  generatedImageOutputSizes,
  resolveImageBillingSize,
}, { resolveCachePrices }, jsonObject(), numeric(), price(), positive(), PostgresProxyBillingPolicy (+1 more)

### Community 74 - "image-billing.js"
Cohesion: 0.1
Nodes (12): PostgresProxyRepository, jsonFromSnapshot(), express, { randomUUID }, { extractUsage, mergeUsage }, { countGeneratedImages, generatedImageOutputSizes }, {
  ImageRequestExecutor,
  createImageUploadMiddleware,
  imageFilesFromRequest,
}, {
  UpstreamHttpError,
  executeJsonUpstream,
  executeMultipartUpstream,
  jsonEventsFromSnapshot,
  jsonFromSnapshot,
  writeSnapshot,
} (+4 more)

### Community 56 - "clipboard.js"
Cohesion: 0.17
Nodes (21): { StringDecoder }, SAFE_RESPONSE_HEADERS, UpstreamHttpError, UpstreamTransportError, timeoutError(), retryAfterMilliseconds(), upstreamUrl(), authorizationHeaders() (+13 more)

### Community 33 - "getDatabase"
Cohesion: 0.11
Nodes (23): axios, { withTransaction }, { PROVIDER_PAGES, inferProvider, parseOfficialPrices }, PostgresPricingSyncService, axios, logger, PROVIDER_PAGES, getConfig() (+15 more)

### Community 116 - "scripts"
Cohesion: 0.25
Nodes (7): quantizeAmount(), amount(), balances(), requireRequestId(), reservationAmount(), assertReservation(), UsageSettlement

### Community 117 - "runtime-services.test.js"
Cohesion: 0.13
Nodes (5): { randomUUID }, { withTransaction }, WALLET_FIELDS, LOG_FIELDS, PostgresSettlementRepository

### Community 0 - "proxy.js"
Cohesion: 0.02
Nodes (112): express, axios, router, { getDatabase }, { authenticate, requireAdmin }, { normalizeUpstreamModels, inferModelType }, { syncOfficialPricing, syncUsdCnyRate, inferProvider }, { listModelsForApiKey, listRoutingGroupModels } (+104 more)

### Community 253 - "Community 253"
Cohesion: 0.5
Nodes (5): supportedProvider(), nonNegativePrice(), imagePricesPayload(), pricingPayload(), keys

### Community 319 - "Community 319"
Cohesion: 1
Nodes (2): nullableChannelPrice(), channelModelPayload()

### Community 320 - "Community 320"
Cohesion: 1
Nodes (2): pricingPolicyModelCodes(), enforcePricingPolicyConsistency()

### Community 107 - "easypay.js"
Cohesion: 0.12
Nodes (16): express, bcrypt, router, { getDatabase }, { authenticate, generateToken }, db, regConfig, existing (+8 more)

### Community 184 - "Community 184"
Cohesion: 0.22
Nodes (6): express, CODEX_ROOT_POST_PATHS, createCodexCompatibilityRouter(), require, { createCodexCompatibilityRouter }, servers

### Community 161 - "worker-runtime.test.js"
Cohesion: 0.22
Nodes (8): express, router, { getDatabase }, { verifyEasyPayCallback }, { grantQuotaOrder }, fail(), easypayNotify(), grantQuotaOrder()

### Community 15 - "init.js"
Cohesion: 0.05
Nodes (38): asyncRoute(), createPostgresAdminRouter(), require, { PostgresAdminCompatRepository }, { createSecretBox }, { createPostgresIdentity }, { createPostgresAdminRouter }, { createPostgresUserRouter } (+30 more)

### Community 149 - "postgres-public.test.js"
Cohesion: 0.17
Nodes (8): express, createPostgresPublicRouter(), require, { createPostgresPublicRouter }, servers, pool, app, server

### Community 94 - "channel-model-policy.js"
Cohesion: 0.12
Nodes (14): { randomUUID }, express, { withTransaction }, { createPostgresIdentity }, { createPostgresPaymentService }, { canonicalImagePrices }, { generateDocs, generateImageDocs }, { buildBillingDetailFromSnapshot } (+6 more)

### Community 58 - "vitest.config.mjs"
Cohesion: 0.08
Nodes (20): buildChannelProtocolDocs(), require, { createPostgresIdentity }, { createPostgresAuthRouter }, { buildChannelProtocolDocs, createPostgresUserRouter, effectiveModelCapabilities }, MemoryUserPool, app, staff (+12 more)

### Community 85 - "emptyChannel"
Cohesion: 0.1
Nodes (13): createPostgresUserRouter(), require, { createPostgresUserRouter }, { createPostgresPaymentService }, { createPostgresPaymentRouter }, PaymentOptionsPool, identity, app (+5 more)

### Community 3 - "dependencies"
Cohesion: 0.04
Nodes (45): express, router, { getDatabase }, { authenticateApiKey }, { v4: uuidv4 }, axios, { selectChannel, reportResult }, { apiKeyCanUseModel, listModelsForApiKey } (+37 more)

### Community 195 - "Community 195"
Cohesion: 0.33
Nodes (9): positiveOrOne(), getUsdCnyRate(), channelHasTokenPricing(), pricingModelForChannel(), buildPricing(), buildImagePricing(), buildChannelImagePricing(), buildRequestPricing() (+1 more)

### Community 129 - "dotenv"
Cohesion: 0.19
Nodes (15): requestMultipliers(), channelBillingForModel(), setLogProtocols(), setLogBillingAudit(), insertSuccessLog(), insertSettlementFailureLog(), insertUpstreamFailureLog(), insertImageSuccessLog() (+7 more)

### Community 156 - "operationsParams"
Cohesion: 0.23
Nodes (12): estimatedInputTokens(), billableTextProjection(), listImageInputs(), estimatedImageReservationTokens(), estimatedChatInputTokens(), estimatedAnthropicInputTokens(), fallbackChatUsage(), fallbackEmbeddingUsage() (+4 more)

### Community 140 - "billing-detail.js"
Cohesion: 0.15
Nodes (12): express, router, { getDatabase }, { listSystemModelCapabilities }, db, platformName, announcement, regEnabled (+4 more)

### Community 1 - "src/views/admin/Channels.vue"
Cohesion: 0.03
Nodes (68): express, router, { getDatabase }, { authenticate }, { v4: uuidv4 }, bcrypt, { encrypt, decrypt, desensitize }, { generateDocs } (+60 more)

### Community 277 - "Community 277"
Cohesion: 0.67
Nodes (3): parseLogDate(), sqliteUtcTime(), buildLogFilters()

### Community 208 - "Community 208"
Cohesion: 0.33
Nodes (5): SENSITIVE_ACCESS_LOG_PATHS, requestPath(), shouldSkipAccessLog(), require, { shouldSkipAccessLog }

### Community 150 - "postgres-admin.test.js"
Cohesion: 0.24
Nodes (10): parseBillingSnapshot(), currencyCode(), isUsdSnapshot(), deriveUserDeductionUsd(), postgresSettledLogSql(), sqliteUserDeductionUsdSql(), postgresUserDeductionUsdSql(), strictUserDeductionUsdAggregateSql() (+2 more)

### Community 123 - "asObject"
Cohesion: 0.24
Nodes (13): finitePrice(), modelPricePerToken(), billingModeForRequest(), withProviderCachePricing(), resolveCachePrices(), channelTokenOfficial(), resolveBillingModel(), resolveFixedUnitPrice() (+5 more)

### Community 185 - "Community 185"
Cohesion: 0.33
Nodes (8): CHANNEL_CAPABILITIES_BY_PROTOCOL, DEFAULT_CHANNEL_CAPABILITIES, ALLOWED_CHANNEL_CAPABILITIES, defaultChannelCapabilities(), parseChannelCapabilities(), serializeChannelCapabilities(), channelSupportsCapability(), channelModelSupportsImageInput()

### Community 209 - "Community 209"
Cohesion: 0.38
Nodes (6): PROTOCOLS, CHANNEL_PROTOCOL_MAP, getProtocol(), getConfiguredProtocol(), generateDocs(), generateImageDocs()

### Community 186 - "Community 186"
Cohesion: 0.31
Nodes (8): reconcileModelStatus(), routedModelCodesForChannels(), validateActiveRoutingPolicies(), validateMappingActivation(), setChannelModelStatus(), { hasCompleteImagePrices, missingImagePriceTiers }, missingImagePriceTiers(), hasCompleteImagePrices()

### Community 124 - "channel-docs.js"
Cohesion: 0.15
Nodes (11): CHANNEL_PROTOCOLS, SUPPORTED_CHANNEL_PROTOCOLS, isSupportedChannelProtocol(), upstreamRequestHeaders(), axios, { channelModelSupportsImageInput, channelSupportsCapability }, { upstreamRequestHeaders }, state (+3 more)

### Community 223 - "Community 223"
Cohesion: 0.47
Nodes (5): crypto, getKey(), encrypt(), decrypt(), desensitize()

### Community 162 - "Community 162"
Cohesion: 0.31
Nodes (10): crypto, { decrypt }, normalizedBaseUrl(), signedFields(), signEasyPay(), signaturesMatch(), supportedPaymentMethods(), paymentTypeFor() (+2 more)

### Community 131 - "form-data"
Cohesion: 0.2
Nodes (11): STANDARD_IMAGE_SIZES, IMAGE_BILLING_TIERS, positiveInteger(), normalizeImageSize(), classifyImageBillingTier(), normalizeImageBillingTier(), imageTierRank(), resolveImageBillingSize() (+3 more)

### Community 39 - "src/components/DashboardCharts.vue"
Cohesion: 0.14
Nodes (26): multer, FormData, SUPPORTED_IMAGE_MIME_TYPES, OUTPUT_FORMATS, INPUT_FIDELITIES, JSON_IMAGE_EDIT_FIELDS, MULTIPART_FIELDS, requestError() (+18 more)

### Community 104 - "infrastructure-static-contract.test.js"
Cohesion: 0.12
Nodes (14): ImageRequestExecutor, require, {
  IMAGE_MAX_FILES,
  IMAGE_MAX_TOTAL_BYTES,
  ImageRequestExecutor,
  cappedMemoryStorage,
  imageFilesFromRequest,
}, imageBytes(), file(), executor, prepared, oversized (+6 more)

### Community 225 - "Community 225"
Cohesion: 0.33
Nodes (5): winston, path, fs, logDir, logger

### Community 269 - "Community 269"
Cohesion: 0.67
Nodes (2): normalizeUpstreamModels(), inferModelType()

### Community 210 - "Community 210"
Cohesion: 0.43
Nodes (6): positiveMultiplier(), multiplierFields, resolveEffectiveMultiplierPolicy(), activeRule(), multiplierPolicyContext(), resolveModelMultiplierPolicy()

### Community 75 - "easypay.js"
Cohesion: 0.2
Nodes (20): number(), normalizeCurrency(), toCny(), hasNumericPrice(), normalizedModelCode(), usesSub2ApiLongContextPricing(), serviceTierMultiplier(), calculateDimensions() (+12 more)

### Community 255 - "Community 255"
Cohesion: 0.67
Nodes (3): PROVIDER_OUTPUT_LIMITS, positiveInteger(), resolveChatOutputLimit()

### Community 118 - "BackgroundWorker"
Cohesion: 0.23
Nodes (15): { channelModelSupportsImageInput, channelSupportsCapability }, { CHANNEL_PROTOCOLS }, IMAGE_INPUT_OPERATION_CAPABILITIES, imageOperationCapabilities(), emptyImageOperationCapabilities(), mergeImageOperationCapabilities(), listRoutingGroupProtocolTypes(), mergeAvailableModel() (+7 more)

### Community 187 - "Community 187"
Cohesion: 0.36
Nodes (7): numeric(), positiveAmount(), walletBalances(), reserveWalletBalance(), releaseWalletReservation(), settleWalletReservation(), deductWalletBalance()

### Community 108 - "channel-selector.js"
Cohesion: 0.12
Nodes (14): require, { initDatabase, getDatabase }, { generateToken }, adminRoutes, db, admin, user, app (+6 more)

### Community 46 - "useMobile"
Cohesion: 0.08
Nodes (25): require, { initDatabase, getDatabase }, { generateToken }, adminRoutes, proxyRoutes, userRoutes, upstreamRequests, db (+17 more)

### Community 211 - "Community 211"
Cohesion: 0.29
Nodes (6): db, exists, user, token, decoded, prefix

### Community 188 - "Community 188"
Cohesion: 0.22
Nodes (8): calls, tasks, worker, aggregate, scheduled, task, now, expensive

### Community 291 - "Community 291"
Cohesion: 1
Nodes (1): detail

### Community 189 - "Community 189"
Cohesion: 0.22
Nodes (8): db, exists, user, wallet, result, transactions, pricing, log

### Community 125 - "model-sync.js"
Cohesion: 0.13
Nodes (12): servers, deps, logger, timestamps, forbidden, allowed, staff, pool (+4 more)

### Community 83 - "init.js"
Cohesion: 0.1
Nodes (16): require, { initDatabase, getDatabase }, { generateToken }, adminRoutes, db, admin, app, model (+8 more)

### Community 212 - "Community 212"
Cohesion: 0.29
Nodes (6): repository, controlPlane, created, secretCipher, cache, baseAccount

### Community 226 - "Community 226"
Cohesion: 0.33
Nodes (5): snapshot, repository, values, cache, readModel

### Community 292 - "Community 292"
Cohesion: 1
Nodes (1): result

### Community 132 - "helmet"
Cohesion: 0.15
Nodes (12): require, { initDatabase, getDatabase }, { generateToken }, userRoutes, paymentRoutes, { encrypt }, signEasyPay(), db (+4 more)

### Community 256 - "Community 256"
Cohesion: 0.5
Nodes (3): calls, pool, repository

### Community 84 - "loadGroups"
Cohesion: 0.11
Nodes (15): BehaviorRedis, error, accounts, accountRepository, scheduler, redis, request, healthReports (+7 more)

### Community 293 - "Community 293"
Cohesion: 1
Nodes (1): prices

### Community 77 - "billing.test.js"
Cohesion: 0.1
Nodes (17): require, { initDatabase, getDatabase }, userRoutes, proxyRoutes, { createCodexCompatibilityRouter }, TEST_IMAGE_BYTES, chunks, raw (+9 more)

### Community 201 - "Community 201"
Cohesion: 0.25
Nodes (7): repositoryRoot, compose, environment, healthContract, apiSource, nginxFiles, nginx

### Community 257 - "Community 257"
Cohesion: 0.5
Nodes (3): db, getSpy, model

### Community 51 - "backup.sh"
Cohesion: 0.08
Nodes (23): require, { initDatabase, getDatabase }, { generateToken }, adminRoutes, userRoutes, publicRoutes, proxyRoutes, requestBody (+15 more)

### Community 295 - "Community 295"
Cohesion: 1
Nodes (1): payload

### Community 296 - "Community 296"
Cohesion: 1
Nodes (1): migration

### Community 258 - "Community 258"
Cohesion: 0.5
Nodes (2): pool, repository

### Community 227 - "Community 227"
Cohesion: 0.33
Nodes (5): pool, repository, policy, context, selection

### Community 8 - "admin.js"
Cohesion: 0.04
Nodes (43): servers, parser, bytes, repository, checks, pool, options, schedulerRequests (+35 more)

### Community 297 - "Community 297"
Cohesion: 1
Nodes (1): migration

### Community 141 - "channel-capabilities.js"
Cohesion: 0.15
Nodes (12): queries, pool, secretBox, http, logger, tasks, probe, query (+4 more)

### Community 151 - "PostgreSQL/Redis 隔离演练与发布准备记录"
Cohesion: 0.17
Nodes (11): require, { channelTokenOfficial }, result, prices, common, model, openAiCompatible, nativeAnthropic (+3 more)

### Community 298 - "Community 298"
Cohesion: 1
Nodes (1): html

### Community 213 - "Community 213"
Cohesion: 0.29
Nodes (6): require, { getDatabase, initDatabase }, authRoutes, app, db, user

### Community 133 - "morgan"
Cohesion: 0.14
Nodes (12): existingCapabilities, effectiveCapabilities, imagePricesUsd, queries, client, accountUpdate, mappingUpdate, modelUpdate (+4 more)

### Community 78 - "anthropic-protocol.test.js"
Cohesion: 0.1
Nodes (20): db, suffix, channel, user, key, group, mapping, migratedKey (+12 more)

### Community 228 - "Community 228"
Cohesion: 0.33
Nodes (4): require, { createRuntimeRouter }, servers, postgres

### Community 134 - "sql.js"
Cohesion: 0.15
Nodes (6): FakePool, repositoryMigrationRows(), redis, partitionProvision, expected, { JWT_SECRET: _removed, ...env }

### Community 152 - "mock-upstream.js"
Cohesion: 0.17
Nodes (8): migrationDirectory, migrationDbPath, legacy, migrated, channelColumns, logColumns, fresh, result

### Community 270 - "Community 270"
Cohesion: 0.67
Nodes (2): testDbDirectory, testDbPath

### Community 214 - "Community 214"
Cohesion: 0.29
Nodes (6): require, { createVerifiedBackup }, { parseImportArguments, verifyBackupManifest }, root, source, backup

### Community 215 - "Community 215"
Cohesion: 0.29
Nodes (4): repository, settlement, request, originalTransaction

### Community 142 - "logger.js"
Cohesion: 0.15
Nodes (10): require, { initDatabase, getDatabase }, { generateToken }, userRoutes, db, user, other, app (+2 more)

### Community 126 - "axios"
Cohesion: 0.13
Nodes (13): require, { initDatabase, getDatabase }, { generateToken }, userRoutes, db, user, app, group (+5 more)

### Community 229 - "Community 229"
Cohesion: 0.33
Nodes (5): callbacks, redis, heartbeat, timer, clearIntervalFn

### Community 143 - "winston"
Cohesion: 0.15
Nodes (9): require, { readPostgresMigrationManifest }, migrationDirectory, pg, redis, sql, manifest, conflicting (+1 more)

### Community 30 - "user/Dashboard.vue"
Cohesion: 0.06
Nodes (3): GlobalComponents, ComponentCustomProperties, vue

### Community 232 - "Community 232"
Cohesion: 0.33
Nodes (2): listRows, drawer

### Community 248 - "Community 248"
Cohesion: 0.4
Nodes (4): configWrites, providerWrites, paymentSwitch, dialog

### Community 262 - "Community 262"
Cohesion: 0.5
Nodes (3): scenarios, requests, startedAt

### Community 163 - "billingModeLabel"
Cohesion: 0.2
Nodes (4): CORE_DATA_BUDGET_MS, localUsers, json(), delayedJson()

### Community 263 - "Community 263"
Cohesion: 0.5
Nodes (2): maxLongTaskMs, mismatches

### Community 303 - "Community 303"
Cohesion: 1
Nodes (1): serverErrors

### Community 264 - "Community 264"
Cohesion: 0.5
Nodes (3): model, recentTable, modelSelect

### Community 191 - "Community 191"
Cohesion: 0.22
Nodes (7): userRow, consoleErrors, table, button, writes, warnings, giftSwitch

### Community 164 - "bcryptjs"
Cohesion: 0.18
Nodes (7): startedAt, startedBeforeVue, starts, state, popupPromise, baseline, nativeSetTimeout

### Community 217 - "Community 217"
Cohesion: 0.48
Nodes (5): target, loopbackHosts, isLoopback, port, frontendRoot

### Community 233 - "Community 233"
Cohesion: 0.33
Nodes (4): logs, desktopRanking, mobileRanking, mobileDetails

### Community 109 - "ensureModels"
Cohesion: 0.12
Nodes (14): userDashboard, adminDashboard, dashboardCharts, usageCharts, logs, app, main, index (+6 more)

### Community 110 - "src/components/charts/LazyBarChart.vue"
Cohesion: 0.12
Nodes (14): currentDir, frontendRoot, api, channels, interceptorStart, canceledGuard, errorToast, openGroup (+6 more)

### Community 127 - "postgres-admin.test.js"
Cohesion: 0.13
Nodes (13): currentDir, frontendRoot, landing, landingCss, fadeContent, router, userLayout, login (+5 more)

### Community 87 - "channel-selector.js"
Cohesion: 0.1
Nodes (18): currentDir, frontendRoot, authStore, appStore, login, userLayout, dashboard, loginStoreStart (+10 more)

### Community 272 - "Community 272"
Cohesion: 0.67
Nodes (2): login, api

### Community 175 - "channel-capabilities.js"
Cohesion: 0.2
Nodes (8): projectDir, distDir, html, scriptBytes, styleBytes, oversizedElementBundle, packageJson, staleChartDependency

### Community 96 - "check-user-actions.mjs"
Cohesion: 0.11
Nodes (18): logs, allLogsDialog, userDashboard, adminDashboard, dashboardCharts, usageCharts, channels, coordinator (+10 more)

### Community 234 - "Community 234"
Cohesion: 0.33
Nodes (4): apiKeys, wallet, router, userRoutes

### Community 218 - "Community 218"
Cohesion: 0.29
Nodes (6): logs, allLogsDialog, billingDetailsDialog, latest, first, second

### Community 136 - "vue-chartjs"
Cohesion: 0.14
Nodes (8): target, loopbackHosts, isLoopback, thresholds, metricBudgets, failures, scores, metrics

### Community 192 - "Community 192"
Cohesion: 0.22
Nodes (6): app, pinia, routes, router, token, role

### Community 240 - "Community 240"
Cohesion: 0.4
Nodes (4): api, t, isLoginRequest, currentToken

### Community 306 - "Community 306"
Cohesion: 1
Nodes (1): useAppStore

### Community 308 - "Community 308"
Cohesion: 1
Nodes (1): useAuthStore

### Community 266 - "Community 266"
Cohesion: 0.5
Nodes (1): coldStartKeys

### Community 250 - "Community 250"
Cohesion: 0.8
Nodes (4): parseStoredTime(), beijingParts(), formatBeijingTime(), formatBeijingDate()

### Community 318 - "Community 318"
Cohesion: 1
Nodes (1): env

### Community 281 - "Community 281"
Cohesion: 1
Nodes (1): backup.sh script

### Community 112 - "gateway-scheduler.test.js"
Cohesion: 0.23
Nodes (13): { requestHeaders }, SCENARIOS, boundedPositive(), availableScenarioNames(), createAutocannonScenario(), { resolveLoadConfig }, { availableScenarioNames, createAutocannonScenario }, loadAutocannon() (+5 more)

### Community 157 - "gsap"
Cohesion: 0.27
Nodes (10): target, isLocalTarget, options, params(), post(), chat(), capacity(), rateLimitFailover() (+2 more)

### Community 113 - "withTransaction"
Cohesion: 0.18
Nodes (12): http, readJson(), sendJson(), mockResponse(), isChatPath(), isModelsPath(), isPrimaryPath(), createMockUpstreamServer() (+4 more)

### Community 181 - "Community 181"
Cohesion: 0.22
Nodes (9): backend/package.json, name, version, main, overrides, body-parser, brace-expansion, postcss (+1 more)

### Community 138 - "dashboard-read-model/legacy-repository.js"
Cohesion: 0.15
Nodes (13): scripts, start, worker, dev, seed, create-initial-admin, backup:sqljs, migrate:postgres (+5 more)

### Community 106 - "echarts"
Cohesion: 0.12
Nodes (17): dependencies, axios, axios, bcryptjs, bcryptjs, cors, cors, dotenv (+9 more)

### Community 283 - "Community 283"
Cohesion: 1
Nodes (2): form-data, form-data

### Community 284 - "Community 284"
Cohesion: 1
Nodes (2): helmet, helmet

### Community 285 - "Community 285"
Cohesion: 1
Nodes (2): jsonwebtoken, jsonwebtoken

### Community 287 - "Community 287"
Cohesion: 1
Nodes (2): multer, multer

### Community 286 - "Community 286"
Cohesion: 1
Nodes (2): morgan, morgan

### Community 288 - "Community 288"
Cohesion: 1
Nodes (2): pg, pg

### Community 289 - "Community 289"
Cohesion: 1
Nodes (2): redis, redis

### Community 290 - "Community 290"
Cohesion: 1
Nodes (2): sql.js, sql.js

### Community 204 - "Community 204"
Cohesion: 0.29
Nodes (7): devDependencies, autocannon, autocannon, nodemon, nodemon, vitest, vitest

### Community 121 - "pricingPayload"
Cohesion: 0.21
Nodes (12): { randomUUID }, path, { createPostgresPool, withTransaction }, releaseOverridePlan(), sameJson(), readTarget(), assertVerified(), applyReleaseControlPlaneOverrides() (+4 more)

### Community 139 - ".key"
Cohesion: 0.23
Nodes (11): crypto, fs, path, timestamp(), parseArguments(), backupPlan(), createVerifiedBackup(), main() (+3 more)

### Community 89 - "payment.js"
Cohesion: 0.15
Nodes (17): sha256File(), fs, path, { createPostgresPool, withTransaction }, { createSecretBox }, { decrypt: decryptLegacySecret }, { sha256File }, {
  createPostgresControlPlaneSink,
  executeControlPlaneImport,
  loadSqlJsControlPlaneSnapshot,
} (+9 more)

### Community 2 - "user/Logs.vue"
Cohesion: 0.06
Nodes (45): bcrypt, { initDatabase, getDatabase, saveDatabase }, main(), initSqlJs, path, fs, os, logger (+37 more)

### Community 37 - "admin/Logs.vue"
Cohesion: 0.12
Nodes (24): crypto, fs, path, { spawnSync }, { resolveDatabaseUrl }, discoverMigrations(), sha256(), parseAppliedMigrations() (+16 more)

### Community 4 - "ApiKeys.vue"
Cohesion: 0.04
Nodes (47): src/index.js, express, cors, helmet, morgan, rateLimit, { initDatabase, getDatabase }, { createApplicationRuntime } (+39 more)

### Community 34 - "check-mobile-bundle.mjs"
Cohesion: 0.09
Nodes (26): start(), requireAdmin(), express, { authenticate: defaultAuthenticate, requireAdmin: defaultRequireAdmin }, { PostgresAdminCompatRepository, AdminCompatError }, { PostgresPricingSyncService }, VALID_STATUS, BOOLEAN_CONFIG_KEYS (+18 more)

### Community 16 - "src/views/admin/Keys.vue"
Cohesion: 0.09
Nodes (32): crypto, fs, path, resolvePg(), resolveDatabaseUrl(), createPostgresPool(), readPostgresMigrationManifest(), inspectPostgresSchema() (+24 more)

### Community 32 - "Register.vue"
Cohesion: 0.08
Nodes (24): ensureApiRequestLogPartitions(), createGatewayScheduler(), path, {
  assertPostgresSchemaCurrent,
  checkPostgres,
  checkPostgresSchema,
  createPostgresPool,
  ensureApiRequestLogPartitions,
  resolveDatabaseUrl,
}, { createRedisClient, checkRedis }, { createSecretBox }, { ControlPlane }, { LegacyControlPlaneRepository } (+16 more)

### Community 90 - "channel-capabilities.js"
Cohesion: 0.15
Nodes (13): withTransaction(), control-plane/postgres-repository.js, { randomUUID }, { withTransaction }, accountKey(), PostgresControlPlaneRepository, express, { withTransaction } (+5 more)

### Community 42 - "admin/Dashboard.vue"
Cohesion: 0.14
Nodes (27): fs, crypto, CONTROL_PLANE_USER_ROLES, EXCLUDED_USER_PLANE_TABLES, CUTOVER_DISABLED_CONFIG, jsonValue(), stableKey(), finiteNumber() (+19 more)

### Community 38 - "image-generations.test.js"
Cohesion: 0.11
Nodes (10): canonicalJson(), RedisSnapshotCache, usage-settlement/postgres-repository.js, { randomUUID }, { withTransaction }, WALLET_FIELDS, LOG_FIELDS, PostgresSettlementRepository (+2 more)

### Community 64 - "channel-multipliers.js"
Cohesion: 0.12
Nodes (15): crypto, SecretIntegrityError, fromBase64Url(), normalizeKey(), normalizeKeyring(), parseEnvelope(), createSecretBox(), require (+7 more)

### Community 14 - "src/index.js"
Cohesion: 0.06
Nodes (36): middleware/auth.js, jwt, bcrypt, { getDatabase }, findApiKey(), apiKeyFromRequest(), apiKeyAuthError(), authenticate() (+28 more)

### Community 205 - "Community 205"
Cohesion: 0.38
Nodes (1): WorkerHeartbeat

### Community 197 - "Community 197"
Cohesion: 0.32
Nodes (2): background-worker/index.js, BackgroundWorker

### Community 50 - "test.sh"
Cohesion: 0.13
Nodes (22): axios, { withTransaction }, { extendRedisCooldown }, { PostgresPricingSyncService }, { UsageSettlement }, { PostgresSettlementRepository }, { PostgresProxyBillingPolicy }, dateInBeijing() (+14 more)

### Community 35 - "admin-finance.test.js"
Cohesion: 0.1
Nodes (23): { randomUUID }, axios, { withTransaction }, { ACCOUNT_CAPABILITIES, ACCOUNT_PROTOCOLS }, { normalizeUpstreamModels, inferModelType }, { inferProvider }, { defaultImageDisplayPricing }, { buildBillingDetailFromSnapshot } (+15 more)

### Community 70 - "Sub2API balance-billing parity"
Cohesion: 0.2
Nodes (8): asObject(), asArray(), optionalNumber(), positiveInteger(), positiveWeight(), positiveMultiplier(), status(), publicRoutingGroup()

### Community 147 - "logger.js"
Cohesion: 0.23
Nodes (4): text(), normalizedUrl(), generatedKey(), publicPaymentProvider()

### Community 222 - "Community 222"
Cohesion: 0.4
Nodes (1): optionalTimestamp()

### Community 31 - "Login.vue"
Cohesion: 0.15
Nodes (3): publicChannel(), publicModel(), PostgresAdminCompatRepository

### Community 241 - "Community 241"
Cohesion: 0.7
Nodes (2): normalizeUpstreamModels(), inferModelType()

### Community 114 - "multiplier-policy.js"
Cohesion: 0.23
Nodes (11): control-plane/index.js, { randomUUID }, ACCOUNT_PROTOCOLS, ACCOUNT_CAPABILITIES, SECRET_FIELDS, controlPlaneError(), sanitize(), integerLimit() (+3 more)

### Community 207 - "Community 207"
Cohesion: 0.33
Nodes (4): control-plane/legacy-repository.js, { randomUUID }, parseCapabilities(), LegacyControlPlaneRepository

### Community 148 - "withTransaction"
Cohesion: 0.27
Nodes (5): dashboard-read-model/index.js, positiveInteger(), normalizeLogQuery(), cacheValue(), DashboardReadModel

### Community 29 - "src/components/logs/UsageCharts.vue"
Cohesion: 0.12
Nodes (29): dashboard-read-model/legacy-repository.js, { listModelsForApiKey, mergeAvailableModel }, isoDate(), legacyWhere(), LegacyDashboardRepository, listModels(), CHANNEL_CAPABILITIES_BY_PROTOCOL, DEFAULT_CHANNEL_CAPABILITIES (+21 more)

### Community 54 - "app.js"
Cohesion: 0.17
Nodes (15): dashboard-read-model/postgres-repository.js, { buildBillingDetailFromSnapshot }, numberValues(), publicLog(), pgLogFilters(), PostgresDashboardRepository, { calculatePricing }, number() (+7 more)

### Community 5 - "dependencies"
Cohesion: 0.06
Nodes (25): gateway-scheduler/index.js, { randomUUID }, { PostgresAccountRepository }, IMAGE_INPUT_CAPABILITIES, GatewaySchedulerError, asNumber(), asString(), normalizeRedisKeyPrefix() (+17 more)

### Community 66 - "Sub2API 自动生图与计费调研（2026-07-19）"
Cohesion: 0.14
Nodes (18): postgres-payment/index.js, crypto, { randomUUID }, { withTransaction }, PostgresPaymentError, asObject(), supportedPaymentMethods(), parseMoney() (+10 more)

### Community 10 - "user.js"
Cohesion: 0.07
Nodes (37): createPostgresPaymentService(), { randomUUID }, express, { withTransaction }, { createPostgresIdentity }, { createPostgresPaymentService }, { defaultImageDisplayPricing }, { generateDocs, generateImageDocs } (+29 more)

### Community 55 - "stores/auth.js"
Cohesion: 0.19
Nodes (9): {
  calculateImagePricing,
  calculatePricing,
  resolveImageUnitPrice,
}, {
  generatedImageOutputSizes,
  resolveImageBillingSize,
}, { resolveCachePrices }, jsonObject(), numeric(), price(), positive(), PostgresProxyRepository (+1 more)

### Community 67 - "生产数据库方案评估"
Cohesion: 0.18
Nodes (19): { StringDecoder }, SAFE_RESPONSE_HEADERS, UpstreamHttpError, UpstreamTransportError, timeoutError(), retryAfterMilliseconds(), upstreamUrl(), authorizationHeaders() (+11 more)

### Community 115 - "backend/package.json"
Cohesion: 0.16
Nodes (13): jsonFromSnapshot(), jsonEventsFromSnapshot(), writeSnapshot(), { randomUUID }, { extractUsage, mergeUsage }, { countGeneratedImages, generatedImageOutputSizes }, {
  ImageRequestExecutor,
  createImageUploadMiddleware,
  imageFilesFromRequest,
}, {
  UpstreamHttpError,
  executeJsonUpstream,
  executeMultipartUpstream,
  jsonEventsFromSnapshot,
  jsonFromSnapshot,
  writeSnapshot,
} (+5 more)

### Community 19 - "easypay-payment.test.js"
Cohesion: 0.09
Nodes (30): axios, { withTransaction }, { PROVIDER_PAGES, inferProvider, parseOfficialPrices }, configScalar(), PostgresPricingSyncService, winston, path, fs (+22 more)

### Community 92 - "billing-detail.js"
Cohesion: 0.27
Nodes (9): usage-settlement/index.js, quantizeAmount(), amount(), balances(), ledger(), requireRequestId(), reservationAmount(), assertReservation() (+1 more)

### Community 21 - "Proposed Changes"
Cohesion: 0.07
Nodes (35): express, axios, router, { getDatabase }, { authenticate, requireAdmin }, { normalizeUpstreamModels, inferModelType }, { syncOfficialPricing, syncUsdCnyRate, inferProvider }, { listModelsForApiKey, listRoutingGroupModels } (+27 more)

### Community 160 - "multiplierText"
Cohesion: 0.27
Nodes (9): routingGroupMultiplierPayload(), requestMultipliers(), positiveMultiplier(), multiplierFields, resolveEffectiveMultiplierPolicy(), activeRule(), multiplierPolicyContext(), resolveModelMultiplierPolicy() (+1 more)

### Community 20 - "user/Models.vue"
Cohesion: 0.08
Nodes (32): publicPaymentProvider(), paymentProviderPayload(), express, router, { getDatabase }, { authenticate }, { v4: uuidv4 }, bcrypt (+24 more)

### Community 183 - "Community 183"
Cohesion: 0.33
Nodes (6): express, asyncRoute(), createRuntimeBootstrapAuthenticate(), createBootstrapRouter(), servers, serve()

### Community 93 - "public.js"
Cohesion: 0.13
Nodes (13): express, CODEX_ROOT_POST_PATHS, createCodexCompatibilityRouter(), require, { createCodexCompatibilityRouter }, servers, serve(), require (+5 more)

### Community 71 - "Round 1: Schema Baseline"
Cohesion: 0.12
Nodes (17): express, router, { getDatabase }, { verifyEasyPayCallback }, { grantQuotaOrder }, fail(), easypayNotify(), quotaOrderError() (+9 more)

### Community 73 - "Sub2API 与 IonAiLabs 用户端性能体验对比报告"
Cohesion: 0.1
Nodes (5): express, servers, listen(), authenticateApiKey(), baseOptions()

### Community 72 - "schema-baseline-migration.test.js"
Cohesion: 0.19
Nodes (20): createResponseMetricsAccumulator(), hasBillableUsage(), extractAnthropicUsage(), mergeAnthropicStreamUsage(), number(), normalizeCurrency(), toCny(), hasNumericPrice() (+12 more)

### Community 57 - "database-isolation.test.js"
Cohesion: 0.16
Nodes (22): retryablePricingContext(), channelBillingForModel(), requestContainsImage(), availableWalletBalance(), upstreamErrorMessage(), handleImageBilledRequest(), handleMultipartImageRequest(), handleImageEditRequest() (+14 more)

### Community 171 - "middleware/auth.js"
Cohesion: 0.27
Nodes (7): express, configMap(), configBoolean(), createPostgresPublicRouter(), require, { createPostgresPublicRouter }, servers

### Community 9 - "pricing-engine.js"
Cohesion: 0.06
Nodes (41): express, router, { getDatabase }, { authenticateApiKey }, { v4: uuidv4 }, axios, { selectChannel, reportResult }, { apiKeyCanUseModel, listModelsForApiKey } (+33 more)

### Community 48 - "check-login-error-ui.mjs"
Cohesion: 0.18
Nodes (23): positiveOrOne(), getUsdCnyRate(), channelHasTokenPricing(), pricingModelForChannel(), buildPricing(), buildImagePricing(), buildChannelImagePricing(), buildRequestPricing() (+15 more)

### Community 103 - "基础设施健康契约"
Cohesion: 0.15
Nodes (16): SAFE_FAILOVER_STATUSES, postWithSafeFailover(), anthropicUpstreamHeaders(), CHANNEL_PROTOCOLS, SUPPORTED_CHANNEL_PROTOCOLS, isSupportedChannelProtocol(), upstreamRequestHeaders(), axios (+8 more)

### Community 130 - "dashboard-read-model/legacy-repository.js"
Cohesion: 0.14
Nodes (11): express, router, { getDatabase }, { listSystemModelCapabilities }, require, { initDatabase, getDatabase }, { generateToken }, adminRoutes (+3 more)

### Community 62 - "六、目前比较明显的问题和风险"
Cohesion: 0.21
Nodes (21): FormData, SUPPORTED_IMAGE_MIME_TYPES, OUTPUT_FORMATS, INPUT_FIDELITIES, JSON_IMAGE_EDIT_FIELDS, MULTIPART_FIELDS, requestError(), imageOperationForEndpoint() (+13 more)

### Community 198 - "Community 198"
Cohesion: 0.29
Nodes (7): multer, cappedMemoryStorage(), createImageUploadMiddleware(), require, {
  IMAGE_MAX_FILES,
  IMAGE_MAX_TOTAL_BYTES,
  ImageRequestExecutor,
  cappedMemoryStorage,
  imageFilesFromRequest,
}, imageBytes(), file()

### Community 224 - "Community 224"
Cohesion: 0.33
Nodes (4): appendFields(), appendFile(), createMultipartPayload(), ImageRequestExecutor

### Community 242 - "Community 242"
Cohesion: 0.6
Nodes (3): PROVIDER_OUTPUT_LIMITS, positiveInteger(), resolveChatOutputLimit()

### Community 172 - "request-limits.js"
Cohesion: 0.6
Nodes (8): numeric(), positiveAmount(), walletBalances(), insertTransaction(), reserveWalletBalance(), releaseWalletReservation(), settleWalletReservation(), deductWalletBalance()

### Community 199 - "Community 199"
Cohesion: 0.25
Nodes (6): require, { initDatabase, getDatabase }, { generateToken }, adminRoutes, proxyRoutes, userRoutes

### Community 200 - "Community 200"
Cohesion: 0.25
Nodes (4): require, { initDatabase, getDatabase }, { generateToken }, adminRoutes

### Community 294 - "Community 294"
Cohesion: 1
Nodes (1): repositoryRoot

### Community 271 - "Community 271"
Cohesion: 0.67
Nodes (2): testDbDirectory, testDbPath

### Community 299 - "Community 299"
Cohesion: 1
Nodes (1): check-nginx-tls-policy.sh script

### Community 300 - "Community 300"
Cohesion: 1
Nodes (1): deploy.sh script

### Community 247 - "Community 247"
Cohesion: 0.4
Nodes (5): frontend/package.json, name, version, private, type

### Community 120 - "k6-scenarios.js"
Cohesion: 0.13
Nodes (16): scripts, dev, build, preview, test:mobile-bundle, test:login-error-ui, test:login-bootstrap, test:user-actions (+8 more)

### Community 80 - "user-model-multipliers.test.js"
Cohesion: 0.1
Nodes (21): dependencies, @element-plus/icons-vue, @element-plus/icons-vue, @lucide/vue, @lucide/vue, axios, axios, chart.js (+13 more)

### Community 302 - "Community 302"
Cohesion: 1
Nodes (2): vue, vue

### Community 301 - "Community 301"
Cohesion: 1
Nodes (2): vue-chartjs, vue-chartjs

### Community 95 - "model-sync.js"
Cohesion: 0.11
Nodes (19): devDependencies, @playwright/test, @playwright/test, @vitejs/plugin-vue, @vitejs/plugin-vue, chrome-launcher, chrome-launcher, lighthouse (+11 more)

### Community 45 - "components.d.ts"
Cohesion: 0.15
Nodes (17): listRows, operationsPayload(), detailPayload(), installLogMocks(), scenarios, installLandingMock(), CORE_DATA_BUDGET_MS, localUsers (+9 more)

### Community 202 - "Community 202"
Cohesion: 0.29
Nodes (5): logs, desktopRanking, mobileRanking, mobileDetails, formatUsdDeduction()

### Community 26 - "Subscribe.vue"
Cohesion: 0.06
Nodes (33): userDashboard, adminDashboard, dashboardCharts, usageCharts, logs, app, main, index (+25 more)

### Community 111 - "src/components/charts/LazyDoughnutChart.vue"
Cohesion: 0.12
Nodes (14): currentDir, frontendRoot, api, channels, interceptorStart, canceledGuard, errorToast, openGroup (+6 more)

### Community 128 - "PostgresAccountRepository"
Cohesion: 0.13
Nodes (13): currentDir, frontendRoot, landing, landingCss, fadeContent, router, userLayout, login (+5 more)

### Community 88 - "channel-docs.js"
Cohesion: 0.1
Nodes (18): currentDir, frontendRoot, authStore, appStore, login, userLayout, dashboard, loginStoreStart (+10 more)

### Community 273 - "Community 273"
Cohesion: 0.67
Nodes (2): login, api

### Community 176 - "Community 176"
Cohesion: 0.2
Nodes (8): projectDir, distDir, html, scriptBytes, styleBytes, oversizedElementBundle, packageJson, staleChartDependency

### Community 235 - "Community 235"
Cohesion: 0.33
Nodes (4): apiKeys, wallet, router, userRoutes

### Community 135 - "uuid"
Cohesion: 0.21
Nodes (11): logs, allLogsDialog, billingDetailsDialog, latest, first, second, createLatestRequest(), parseStoredTime() (+3 more)

### Community 165 - "express-rate-limit"
Cohesion: 0.18
Nodes (5): target, loopbackHosts, isLoopback, thresholds, metricBudgets

### Community 249 - "Community 249"
Cohesion: 0.5
Nodes (3): router/index.js, routes, router

### Community 304 - "Community 304"
Cohesion: 1
Nodes (2): api/index.js, api

### Community 236 - "Community 236"
Cohesion: 0.33
Nodes (4): src/components/AdminTrendChart.vue, props, chartElement, chartStyle

### Community 18 - "src/views/admin/Settings.vue"
Cohesion: 0.05
Nodes (36): src/components/DashboardCharts.vue, LazyBarChart, props, isMobile, chartRoot, chartsVisible, showDesktopEmptyState, successCount (+28 more)

### Community 339 - "Community 339"
Cohesion: 1
Nodes (1): src/components/charts/LazyBarChart.vue

### Community 340 - "Community 340"
Cohesion: 1
Nodes (1): src/components/charts/LazyDoughnutChart.vue

### Community 59 - "auto-imports.d.ts"
Cohesion: 0.11
Nodes (18): src/components/logs/AllLogsDialog.vue, visible, props, emit, allLogs, logLoading, logPage, logTotal (+10 more)

### Community 105 - "dayjs"
Cohesion: 0.12
Nodes (14): src/components/logs/BillingDetailsDialog.vue, visible, props, selectedBilling, billingPrimaryDimension, billingUnitLabel, billingMultiplier, billingFxRate (+6 more)

### Community 274 - "Community 274"
Cohesion: 0.67
Nodes (2): props, fadeRef

### Community 265 - "Community 265"
Cohesion: 0.83
Nodes (2): useMobile(), useMobileDrawer()

### Community 79 - "loadAll"
Cohesion: 0.1
Nodes (19): route, router, authStore, { isMobile, drawerOpen, drawerRef, triggerRef, openDrawer, closeDrawer }, narrowScreen, isCompactDesktop, menuItems, titles (+11 more)

### Community 154 - "echarts"
Cohesion: 0.17
Nodes (9): route, router, authStore, appStore, { isMobile, drawerOpen, drawerRef, triggerRef, openDrawer, closeDrawer }, narrowScreen, isCompactDesktop, userInitial (+1 more)

### Community 307 - "Community 307"
Cohesion: 1
Nodes (1): useAppStore

### Community 309 - "Community 309"
Cohesion: 1
Nodes (2): stores/auth.js, useAuthStore

### Community 267 - "Community 267"
Cohesion: 0.5
Nodes (1): coldStartKeys

### Community 6 - "admin/Models.vue"
Cohesion: 0.05
Nodes (46): src/views/admin/Channels.vue, groups, channels, models, groupLoading, channelLoading, syncingId, groupDialog (+38 more)

### Community 137 - "ecosystem.config.js"
Cohesion: 0.15
Nodes (11): admin/Dashboard.vue, data, isMobile, dashboardLoading, dashboardError, trendRoot, trendVisible, AdminTrendChart (+3 more)

### Community 97 - "element-plus"
Cohesion: 0.12
Nodes (14): src/views/admin/Keys.vue, groups, loading, page, total, expandedUsers, permDialog, selModels (+6 more)

### Community 12 - "pricing-sync.js"
Cohesion: 0.04
Nodes (37): src/views/admin/Logs.vue, EMPTY_SUMMARY, presets, dimensions, isMobile, loading, detailLoading, singleLoading (+29 more)

### Community 178 - "Community 178"
Cohesion: 0.2
Nodes (10): beijingLocalValue(), ensureCustomDefaults(), fetchOperations(), setPreset(), applyCustomRange(), applySearch(), setDimension(), handleRankingSort() (+2 more)

### Community 177 - "Community 177"
Cohesion: 0.22
Nodes (10): beijingInputToIso(), currentRange(), validRange(), operationsParams(), baseParams(), applyAdvanced(), detailParams(), fetchDetails() (+2 more)

### Community 317 - "Community 317"
Cohesion: 1
Nodes (2): openLogDetail(), retryLogDetail()

### Community 316 - "Community 316"
Cohesion: 1
Nodes (2): formatInteger(), tokenValue()

### Community 315 - "Community 315"
Cohesion: 1
Nodes (2): billingModeName(), billingModeLabel()

### Community 276 - "Community 276"
Cohesion: 0.67
Nodes (3): multiplierText(), multiplierValue(), sourceLabel()

### Community 36 - "main.js"
Cohesion: 0.08
Nodes (29): src/views/admin/Models.vue, models, loading, dialogVisible, isEdit, saving, syncing, expandedSections (+21 more)

### Community 166 - "multer"
Cohesion: 0.22
Nodes (9): src/views/admin/Orders.vue, orders, loading, statusFilter, page, total, fetch(), confirmOrder() (+1 more)

### Community 144 - "axios"
Cohesion: 0.19
Nodes (12): src/views/admin/Pricing.vue, rules, loading, dialogVisible, isEdit, saving, empty(), form (+4 more)

### Community 98 - "migrate-postgres.js"
Cohesion: 0.13
Nodes (18): src/views/admin/Settings.vue, configs, providers, saving, providerSaving, providerDialog, tab, booleanConfigKeys (+10 more)

### Community 99 - "vue-chartjs"
Cohesion: 0.12
Nodes (17): src/views/admin/Users.vue, users, loading, search, page, limit, total, detailDialog (+9 more)

### Community 193 - "Community 193"
Cohesion: 0.22
Nodes (7): router, authStore, frm, loading, loginError, form, rules

### Community 194 - "Community 194"
Cohesion: 0.22
Nodes (7): router, authStore, frm, loading, result, form, rules

### Community 52 - "deploy.sh"
Cohesion: 0.1
Nodes (22): router, appStore, activeModelGroup, activeProtocol, copied, deferredReady, protocols, codeExamples (+14 more)

### Community 27 - "billing-detail.js"
Cohesion: 0.06
Nodes (32): keys, loading, createDialog, resultDialog, creating, newKeyName, newKeyRaw, channels (+24 more)

### Community 237 - "Community 237"
Cohesion: 0.33
Nodes (4): form, formRef, loading, rules

### Community 86 - "easypay-payment.test.js"
Cohesion: 0.1
Nodes (16): user/Dashboard.vue, appStore, authStore, stats, models, hasApiKeys, bootstrapWallet, chartLoading (+8 more)

### Community 13 - "middleware/auth.js"
Cohesion: 0.05
Nodes (34): user/Logs.vue, AllLogsDialog, BillingDetailsDialog, stats, modelList, dailyData, recentLogs, loading (+26 more)

### Community 179 - "Community 179"
Cohesion: 0.2
Nodes (6): user/Models.vue, router, groups, loading, hasApiKeys, modelCount

### Community 155 - "echarts"
Cohesion: 0.18
Nodes (8): form, submitting, orders, ordersLoading, page, total, submit(), fetchOrders()

### Community 28 - "src/views/admin/Orders.vue"
Cohesion: 0.07
Nodes (30): wallet, availableBalance, activeTab, transactions, orders, ltx, lo, txPage (+22 more)

### Community 278 - "Community 278"
Cohesion: 1
Nodes (2): test.sh script, check()

### Community 63 - "11AiLabs — AI API 中转平台"
Cohesion: 0.09
Nodes (22): IonAiLabs — AI API 中转平台, 技术栈, 项目结构, 快速开始 (本地开发), 1. 后端, 2. 前端, 3. 访问, 生产环境部署 (+14 more)

### Community 216 - "Community 216"
Cohesion: 0.29
Nodes (6): 生产数据库方案评估, 当前方案：SQL.js, 推荐方案, 首选：PostgreSQL + Prisma / Knex, 备选：better-sqlite3 (原生 SQLite 驱动), 建议

### Community 261 - "Community 261"
Cohesion: 0.5
Nodes (3): 基础设施健康契约, Readiness, 运行边界

### Community 231 - "Community 231"
Cohesion: 0.33
Nodes (5): 性能与压测验证, 本地执行顺序, 浏览器基线配置, 安全边界, 验收指标

### Community 190 - "Community 190"
Cohesion: 0.22
Nodes (8): PostgreSQL/Redis 隔离演练与发布准备记录, 隔离运行环境, 迁移核对, SQL.js 备份与控制面导入, 渠道、图片与计费证据, 测试与性能, 演练中修复的问题, 上线前门禁与回滚

### Community 153 - "logger.js"
Cohesion: 0.17
Nodes (11): Sub2API 渠道与分组管理调研（2026-07-15）, 调研边界, 已确认的 Sub2API 设计, 1. “渠道”不是单个上游 URL，而是面向分组的计费、模型映射与可见模型策略, 2. 分组是调度边界；账号可多归属，渠道与分组是一对一归属, 3. 模型权限、展示与实际转发分层处理, 4. 调度、优先级与故障回退均在“账号池”层完成, 5. 健康监控独立于请求调度 (+3 more)

### Community 243 - "Community 243"
Cohesion: 0.4
Nodes (4): Sub2API Codex 图片桥接复核（2026-07-23）, 结论, 直接证据, 术语澄清

### Community 244 - "Community 244"
Cohesion: 0.4
Nodes (4): Sub2API 图片自动生图：用户调用记录显示的模型, 结论, 证据链, 对 11AiLabs 的含义

### Community 174 - "check-nginx-tls-policy.sh"
Cohesion: 0.2
Nodes (9): Sub2API 自动生图与计费调研（2026-07-19）, 调研边界, 已确认的实现, 1. 同时支持专用生图端点和 Responses 原生工具, 2. 仅 Codex/OpenAI 路径有可选的自动工具桥接, 3. 实际生图模型和张数由 Responses 处理链带入最终结果, 4. 生图可按图/尺寸计费并记录明细，但一次 Responses 调用只形成一条用量流水, 对 11AiLabs 方案的可借鉴点与边界 (+1 more)

### Community 245 - "Community 245"
Cohesion: 0.4
Nodes (4): Round 1: Schema Baseline, Goal, Requirements, Verification

### Community 246 - "Community 246"
Cohesion: 0.4
Nodes (4): Sub2API balance-billing parity, Goal, Required behavior, Public test seams

### Community 47 - "setup.js"
Cohesion: 0.07
Nodes (26): 一、项目目标, 二、技术架构, 三、目前已经完成的功能, 1. 用户和权限体系, 2. API Key 管理, 3. 模型代理, 4. 上游渠道池, 5. 额度及计费系统 (+18 more)

## Knowledge Gaps
- **2200 isolated node(s):** `{ requestHeaders }`, `SCENARIOS`, `target`, `isLocalTarget`, `options` (+2195 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 282`** (1 nodes): `schema_migrations`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 230`** (2 nodes): `asArray()`, `publicChannel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `model-capabilities.test.js`** (1 nodes): `PostgresAdminCompatRepository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 206`** (2 nodes): `{ randomUUID }`, `LegacyControlPlaneRepository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 319`** (2 nodes): `nullableChannelPrice()`, `channelModelPayload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 320`** (2 nodes): `pricingPolicyModelCodes()`, `enforcePricingPolicyConsistency()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 269`** (2 nodes): `normalizeUpstreamModels()`, `inferModelType()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 291`** (1 nodes): `detail`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 292`** (1 nodes): `result`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 293`** (1 nodes): `prices`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 295`** (1 nodes): `payload`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 296`** (1 nodes): `migration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 258`** (2 nodes): `pool`, `repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 297`** (1 nodes): `migration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 298`** (1 nodes): `html`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 270`** (2 nodes): `testDbDirectory`, `testDbPath`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (2 nodes): `listRows`, `drawer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 263`** (2 nodes): `maxLongTaskMs`, `mismatches`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 303`** (1 nodes): `serverErrors`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 272`** (2 nodes): `login`, `api`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 306`** (1 nodes): `useAppStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 308`** (1 nodes): `useAuthStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 266`** (1 nodes): `coldStartKeys`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 318`** (1 nodes): `env`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 281`** (1 nodes): `backup.sh script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 283`** (2 nodes): `form-data`, `form-data`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 284`** (2 nodes): `helmet`, `helmet`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 285`** (2 nodes): `jsonwebtoken`, `jsonwebtoken`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 287`** (2 nodes): `multer`, `multer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 286`** (2 nodes): `morgan`, `morgan`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 288`** (2 nodes): `pg`, `pg`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 289`** (2 nodes): `redis`, `redis`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 290`** (2 nodes): `sql.js`, `sql.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 205`** (1 nodes): `WorkerHeartbeat`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 197`** (2 nodes): `background-worker/index.js`, `BackgroundWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (1 nodes): `optionalTimestamp()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (2 nodes): `normalizeUpstreamModels()`, `inferModelType()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 294`** (1 nodes): `repositoryRoot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 271`** (2 nodes): `testDbDirectory`, `testDbPath`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 299`** (1 nodes): `check-nginx-tls-policy.sh script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 300`** (1 nodes): `deploy.sh script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 302`** (2 nodes): `vue`, `vue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 301`** (2 nodes): `vue-chartjs`, `vue-chartjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 273`** (2 nodes): `login`, `api`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 304`** (2 nodes): `api/index.js`, `api`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 339`** (1 nodes): `src/components/charts/LazyBarChart.vue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 340`** (1 nodes): `src/components/charts/LazyDoughnutChart.vue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 274`** (2 nodes): `props`, `fadeRef`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 265`** (2 nodes): `useMobile()`, `useMobileDrawer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 307`** (1 nodes): `useAppStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 309`** (2 nodes): `stores/auth.js`, `useAuthStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 267`** (1 nodes): `coldStartKeys`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 317`** (2 nodes): `openLogDetail()`, `retryLogDetail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 316`** (2 nodes): `formatInteger()`, `tokenValue()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 315`** (2 nodes): `billingModeName()`, `billingModeLabel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 278`** (2 nodes): `test.sh script`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `src/index.js` connect `ApiKeys.vue` to `user/Logs.vue`, `check-mobile-bundle.mjs`, `src/index.js`, `Sub2API 自动生图与计费调研（2026-07-19）`, `user.js`, `Proposed Changes`, `Community 183`, `public.js`, `Round 1: Schema Baseline`, `channel-capabilities.js`, `backend/package.json`, `middleware/auth.js`, `pricing-engine.js`, `dashboard-read-model/legacy-repository.js`, `user/Models.vue`, `Register.vue`, `easypay-payment.test.js`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `getDatabase()` connect `UserLayout.vue` to `Wallet.vue`, `Docs.vue`, `proxy.js`, `easypay.js`, `worker-runtime.test.js`, `dependencies`, `billing-detail.js`, `src/views/admin/Channels.vue`, `channel-selector.js`, `useMobile`, `usage-settlement/index.js`, `init.js`, `helmet`, `billing.test.js`, `backup.sh`, `Community 213`, `logger.js`, `axios`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `buildChannelProtocolDocs()` connect `user.js` to `migrate-postgres.js`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `{ requestHeaders }`, `SCENARIOS`, `target` to the rest of the system?**
  _2200 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `src/views/admin/Pricing.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `UserLayout.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `routing-group-models.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._