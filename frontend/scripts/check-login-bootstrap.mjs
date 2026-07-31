import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(currentDir, '..')
const read = relativePath => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')

const authStore = read('src/stores/auth.js')
const appStore = read('src/stores/app.js')
const login = read('src/views/auth/Login.vue')
const dashboard = read('src/views/user/Dashboard.vue')

const loginStoreStart = authStore.indexOf('async function login(')
const loginStoreEnd = authStore.indexOf('async function register(', loginStoreStart)
assert.ok(loginStoreStart >= 0 && loginStoreEnd > loginStoreStart, 'Auth store must expose login and register actions')
const loginStoreBody = authStore.slice(loginStoreStart, loginStoreEnd)
assert.doesNotMatch(loginStoreBody, /checkAuth/, 'Login action must not wait for /api/auth/me before navigation')

const routePushIndex = login.indexOf('await router.push(')
const backgroundAuthIndex = login.indexOf('void authStore.checkAuth()')
assert.ok(routePushIndex >= 0, 'Successful login must await the route change')
assert.ok(backgroundAuthIndex > routePushIndex, 'Background /me validation must start after the console route is visible')

assert.match(authStore, /response\?\.status\s*===\s*401/, 'Only an explicit 401 from /me may clear the authenticated session')
assert.match(authStore, /authError=ref\(''\)/, 'Auth store must expose background account loading failures')
assert.match(appStore, /platformInfoRequest/, 'Platform info requests must share one in-flight promise')
assert.match(appStore, /platformInfoLoaded/, 'Loaded platform info must be reused during the current app session')

assert.match(dashboard, /useAuthStore/, 'Dashboard wallet must come from the authenticated user store')
assert.match(dashboard, /authStore\.wallet/, 'Dashboard must render the wallet returned by /api/auth/me')
assert.match(dashboard, /authStore\.authError/, 'Dashboard must show a recoverable account loading failure')
assert.match(dashboard, /walletAmount\(/, 'Wallet cards must use a loading-safe amount formatter')
assert.doesNotMatch(dashboard, /wallet\?\.[^}]+\|\|'0\.00'/, 'Wallet cards must not paint false zero balances before /me returns')
assert.doesNotMatch(dashboard, /\/api\/user\/wallet/, 'Dashboard must not duplicate the wallet request')
assert.doesNotMatch(dashboard, /appStore\.fetchPlatformInfo/, 'Dashboard must leave platform info loading to UserLayout')
assert.match(dashboard, /\/api\/user\/dashboard\/bootstrap/, 'Dashboard must use the aggregate bootstrap endpoint')
assert.match(dashboard, /async function fetchStats/, 'Dashboard must expose a refreshable bootstrap loader')

const fetchStatsStart = dashboard.indexOf('async function fetchStats(')
const fetchStatsEnd = dashboard.indexOf('function walletAmount(', fetchStatsStart)
assert.ok(fetchStatsStart >= 0 && fetchStatsEnd > fetchStatsStart, 'Dashboard must expose the complete bootstrap loader')
const fetchStats = dashboard.slice(fetchStatsStart, fetchStatsEnd)
const fallbackStart = fetchStats.indexOf('catch(')
const finallyStart = fetchStats.indexOf('finally', fallbackStart)
assert.ok(fallbackStart > 0 && finallyStart > fallbackStart, 'Dashboard must isolate its legacy fallback in catch')
const aggregatePhase = fetchStats.slice(0, fallbackStart)
const fallbackPhase = fetchStats.slice(fallbackStart, finallyStart)
assert.match(aggregatePhase, /\/api\/user\/dashboard\/bootstrap/, 'Dashboard must try the aggregate bootstrap first')
assert.doesNotMatch(aggregatePhase, /\/api\/user\/(?:stats|models)/, 'Legacy reads must not compete with the aggregate first request')
assert.match(fallbackPhase, /Promise\.allSettled/, 'Legacy fallback requests must settle independently')
assert.doesNotMatch(fallbackPhase, /Promise\.all\(/, 'Legacy fallback must not fail as an all-or-nothing batch')
assert.match(fallbackPhase, /\/api\/user\/stats/, 'Bootstrap failure must retain the legacy stats fallback')
assert.match(fallbackPhase, /\/api\/user\/models/, 'Bootstrap failure must retain the legacy models fallback')

console.log('登录与控制台初始化防回归检查通过')
