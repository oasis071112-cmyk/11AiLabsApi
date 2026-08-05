import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequestCoordinator } from '../src/utils/request-coordinator.js'

const logs = fs.readFileSync(new URL('../src/views/user/Logs.vue', import.meta.url), 'utf8')
const allLogsDialog = fs.readFileSync(new URL('../src/components/logs/AllLogsDialog.vue', import.meta.url), 'utf8')
const userDashboard = fs.readFileSync(new URL('../src/views/user/Dashboard.vue', import.meta.url), 'utf8')
const adminDashboard = fs.readFileSync(new URL('../src/views/admin/Dashboard.vue', import.meta.url), 'utf8')
const dashboardCharts = fs.readFileSync(new URL('../src/components/DashboardCharts.vue', import.meta.url), 'utf8')
const usageCharts = fs.readFileSync(new URL('../src/components/logs/UsageCharts.vue', import.meta.url), 'utf8')
const channels = fs.readFileSync(new URL('../src/views/admin/Channels.vue', import.meta.url), 'utf8')

const coordinator = createRequestCoordinator()
let firstSignal
let firstResolve
let runCount = 0
const first = coordinator.run('logs:page=1', signal => {
  runCount += 1
  firstSignal = signal
  return new Promise(resolve => { firstResolve = resolve })
})
const duplicate = coordinator.run('logs:page=1', () => {
  runCount += 1
  return Promise.resolve('duplicate')
})
assert.equal(duplicate, first, '相同查询必须复用正在进行的请求')
assert.equal(runCount, 1, '复用请求不能重复发起加载器')

const second = coordinator.run('logs:page=2', () => Promise.resolve('newest'))
assert.equal(firstSignal.aborted, true, '新查询必须取消旧查询')
assert.equal(coordinator.isCurrent(first), false, '被取消的旧查询不能再更新页面')
assert.equal(coordinator.isCurrent(second), true, '最新查询必须保持可采纳状态')
firstResolve('stale')
assert.equal(await first.promise, 'stale')
assert.equal(await second.promise, 'newest')
assert.equal(coordinator.isCurrent(second), true, '最新请求完成后仍须保持可采纳状态，直到下一次 run 或 cancel')

const cancelCoordinator = createRequestCoordinator()
let cancelledSignal
const cancelled = cancelCoordinator.run('analytics:7d', signal => {
  cancelledSignal = signal
  return Promise.resolve('cancelled')
})
cancelCoordinator.cancel()
const restarted = cancelCoordinator.run('analytics:7d', () => Promise.resolve('restarted'))
assert.equal(cancelledSignal.aborted, true, '取消操作必须终止当前请求')
assert.notEqual(restarted, cancelled, '取消后的同一查询必须能够重新发起')
assert.equal(await restarted.promise, 'restarted')

const alternating = createRequestCoordinator()
let oldAResolve
const oldA = alternating.run('A', () => new Promise(resolve => { oldAResolve = resolve }))
alternating.run('B', () => Promise.resolve('B'))
const freshA = alternating.run('A', () => Promise.resolve('fresh A'))
assert.notEqual(freshA, oldA, 'A→B→A must not reuse the aborted first A request')
assert.equal(freshA.signal.aborted, false, 'The restarted A request must be live')
oldAResolve('stale A')
await oldA.promise
assert.equal(await freshA.promise, 'fresh A')
assert.equal(alternating.isCurrent(freshA), true, 'A→B→A 的最终请求完成后仍须保持当前身份')

assert.match(allLogsDialog, /createRequestCoordinator/, '全部日志弹窗必须使用可取消且去重的请求协调器')
assert.match(allLogsDialog, /signal:\s*request\.signal/, '全部日志请求必须把取消信号传给 API 客户端')
assert.match(allLogsDialog, /logsRequest\.isCurrent\(request\)/, '全部日志弹窗必须忽略过期响应')

assert.match(userDashboard, /dashboard-skeleton/, '用户控制台必须在核心数据加载时呈现骨架')
assert.match(adminDashboard, /dashboard-skeleton/, '管理员控制台必须在核心数据加载时呈现骨架')
assert.match(dashboardCharts, /IntersectionObserver/, '用户图表必须等待可见后再装载')
assert.match(usageCharts, /IntersectionObserver/, '调用分析图表必须等待可见后再装载')
assert.match(dashboardCharts, /defineAsyncComponent/, '用户图表运行时必须异步加载')
assert.match(usageCharts, /defineAsyncComponent/, '调用分析图表运行时必须异步加载')

const channelsMount = channels.slice(channels.indexOf('onMounted('), channels.indexOf('async function loadAll'))
assert.match(channelsMount, /loadGroups\(\)/, '渠道页首屏必须加载分组列表')
assert.match(channelsMount, /loadChannels\(\)/, '渠道页首屏必须加载渠道列表')
assert.doesNotMatch(channelsMount, /loadModels\(\)/, '渠道页首屏不能加载仅弹窗需要的模型明细')
assert.match(channels, /async function ensureModels\(/, '渠道弹窗必须按需加载模型明细')

console.log('前端性能垂直切片检查通过')
