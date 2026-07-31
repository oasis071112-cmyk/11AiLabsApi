import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequestCoordinator } from '../src/utils/request-coordinator.js'

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function occurrences(text, value) {
  return text.split(value).length - 1
}

const userDashboard = source('../src/views/user/Dashboard.vue')
const adminDashboard = source('../src/views/admin/Dashboard.vue')
const dashboardCharts = source('../src/components/DashboardCharts.vue')
const usageCharts = source('../src/components/logs/UsageCharts.vue')
const logs = source('../src/views/user/Logs.vue')

assert.equal(occurrences(userDashboard, '/api/user/dashboard/bootstrap'), 1, '用户首屏只能有一个 dashboard bootstrap 请求')
assert.equal(occurrences(adminDashboard, '/api/admin/dashboard/bootstrap'), 1, '管理首屏只能有一个 dashboard bootstrap 请求')
assert.match(userDashboard, /dashboard-skeleton/, '用户首屏必须保留骨架')
assert.match(adminDashboard, /dashboard-skeleton/, '管理首屏必须保留骨架')
assert.match(adminDashboard, /defineAsyncComponent/, '管理趋势图必须异步分块')
assert.match(adminDashboard, /IntersectionObserver/, '管理趋势图必须在可见后加载')
assert.match(adminDashboard, /hasTrendData&&trendVisible/, '管理无数据时不能渲染趋势图')

for (const charts of [dashboardCharts, usageCharts]) {
  assert.match(charts, /defineAsyncComponent/, '图表必须异步分块')
  assert.match(charts, /IntersectionObserver/, '图表必须在可见后加载')
  assert.match(charts, /v-if="chartsVisible"/, '不可见图表不能触发动态 chunk')
}
assert.match(dashboardCharts, /showDesktopEmptyState/, '无数据时用户仪表盘必须直接显示空状态')
assert.match(usageCharts, /v-else class="empty"/, '无数据时调用分析不能渲染图表')

const coordinator = createRequestCoordinator()
let firstResolve
let firstSignal
const first = coordinator.run('logs:today', signal => {
  firstSignal = signal
  return new Promise(resolve => { firstResolve = resolve })
})
const latest = coordinator.run('logs:last-7-days', () => Promise.resolve('latest'))
assert.equal(firstSignal.aborted, true, '筛选更新必须取消旧请求')
assert.equal(coordinator.isCurrent(first), false, '旧响应不能覆盖最新筛选结果')
assert.equal(coordinator.isCurrent(latest), true, '最新筛选请求必须可采纳')
firstResolve('stale')
assert.equal(await first.promise, 'stale')
assert.equal(await latest.promise, 'latest')
assert.match(logs, /createRequestCoordinator/, '日志筛选必须使用请求协调器')
assert.match(logs, /isCurrent\(request\)/, '日志筛选必须忽略过期响应')

console.log('首屏性能预算静态检查通过')
