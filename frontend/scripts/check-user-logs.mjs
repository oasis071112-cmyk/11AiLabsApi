import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLatestRequest } from '../src/utils/latest-request.js'
import { formatBeijingDate } from '../src/utils/time.js'

const logs = fs.readFileSync(new URL('../src/views/user/Logs.vue', import.meta.url), 'utf8')
const allLogsDialog = fs.readFileSync(new URL('../src/components/logs/AllLogsDialog.vue', import.meta.url), 'utf8')
const billingDetailsDialog = fs.readFileSync(new URL('../src/components/logs/BillingDetailsDialog.vue', import.meta.url), 'utf8')
const logSources = `${logs}\n${allLogsDialog}\n${billingDetailsDialog}`

assert.equal(formatBeijingDate(new Date('2026-07-27T16:30:00.000Z')), '2026-07-28')
const latest = createLatestRequest()
const first = latest.begin()
const second = latest.begin()
assert.equal(latest.isLatest(first), false)
assert.equal(latest.isLatest(second), true)
latest.invalidate()
assert.equal(latest.isLatest(second), false)
assert.match(allLogsDialog, /v-if="!isMobile" :data="allLogs"/)
assert.match(allLogsDialog, /class="all-logs-mobile-list"/)
assert.match(billingDetailsDialog, /:deep\(\.billing-dialog-modal\)\{width:calc\(100% - 16px\)!important/)
assert.equal((logSources.match(/class="mobile-date-input" type="date"/g) || []).length, 4)
assert.match(logSources, /\.mobile-date-range\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/)
assert.doesNotMatch(logSources, /mobile-safe-date-popper/)

console.log('用户调用记录防回归检查通过')
