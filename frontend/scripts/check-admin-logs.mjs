import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatUsdDeduction } from '../src/utils/billing.js'

const logs = fs.readFileSync(new URL('../src/views/admin/Logs.vue', import.meta.url), 'utf8')

assert.equal(formatUsdDeduction(2), '$2.000000')
assert.equal(formatUsdDeduction('0.5'), '$0.500000')
assert.equal(formatUsdDeduction(0), '$0.000000')
assert.equal(formatUsdDeduction(null), '—')
assert.equal(formatUsdDeduction(undefined), '—')

assert.match(logs, /用户实际扣费（USD）/, '管理端调用日志明细必须保留用户实际扣费美元值')
assert.match(
  logs,
  /formatUsdDeduction\(row\.user_deduction_usd\)/,
  '美元明细必须格式化后端返回的 user_deduction_usd 字段',
)
assert.match(logs, /class="ops-kpi-grid"/, '调用日志首屏必须提供运营 KPI')
assert.match(logs, /class="desktop-ranking-table"/, '桌面端必须提供可排序的聚合榜单')
assert.match(logs, /class="mobile-ranking-list"/, '手机端必须使用聚合卡片而不是压缩桌面表格')
assert.match(logs, /class="mobile-log-list"/, '手机端原始调用明细必须使用卡片列表')
assert.match(logs, /AdminTrendChart/, '调用日志必须复用现有管理端趋势图组件')
assert.match(logs, /dimension:dimension\.value/, '模型、渠道和用户标签必须驱动同表聚合维度')
assert.match(logs, /start_at:range\.start_at,end_at:range\.end_at/, '所有运营区块必须使用同一时间范围')
assert.match(logs, /@media\(max-width:768px\)/, '调用日志必须遵循管理端 768px 手机断点')
assert.match(logs, /\.desktop-ranking-table\{display:none\}/, '手机端必须隐藏桌面聚合表格')
assert.match(logs, /overflow-x:hidden/, '调用日志页面必须阻止页面级横向溢出')
assert.match(logs, /include_summary:false/, '逐条明细分页必须使用 list-only 查询，避免重复运营聚合')
assert.match(logs, /operationsRequestId/, '运营汇总必须忽略已经过期的并发响应')
assert.match(logs, /appliedQueryParams/, '榜单下钻必须复用生成该榜单时的精确时间边界')
assert.match(logs, /sortable="custom"/, '榜单列必须通过后端执行全量排序')
assert.doesNotMatch(logs, /class="status-card"/, '首屏不得扩展确认范围之外的状态构成卡')
assert.match(logs, /min-height:44px/, '手机端交互控件必须达到 44px 触达高度')

console.log('Admin logs checks passed.')
