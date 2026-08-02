import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatUsdDeduction } from '../src/utils/billing.js'

const logs = fs.readFileSync(new URL('../src/views/admin/Logs.vue', import.meta.url), 'utf8')

assert.equal(formatUsdDeduction(2), '$2.000000')
assert.equal(formatUsdDeduction('0.5'), '$0.500000')
assert.equal(formatUsdDeduction(0), '$0.000000')
assert.equal(formatUsdDeduction(null), '—')
assert.equal(formatUsdDeduction(undefined), '—')

assert.match(logs, /label="用户实际扣费（USD）"/, '管理端调用日志必须展示用户实际扣费美元列')
assert.match(
  logs,
  /formatUsdDeduction\(row\.user_deduction_usd\)/,
  '美元列必须格式化后端返回的 user_deduction_usd 字段',
)

console.log('Admin logs checks passed.')
