import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLatestRequest } from '../src/utils/latest-request.js'
import { formatBeijingDate } from '../src/utils/time.js'

const logs = fs.readFileSync(new URL('../src/views/user/Logs.vue', import.meta.url), 'utf8')

assert.equal(formatBeijingDate(new Date('2026-07-27T16:30:00.000Z')), '2026-07-28')
const latest = createLatestRequest()
const first = latest.begin()
const second = latest.begin()
assert.equal(latest.isLatest(first), false)
assert.equal(latest.isLatest(second), true)
latest.invalidate()
assert.equal(latest.isLatest(second), false)
assert.match(logs, /v-if="!isMobile" :data="allLogs"/)
assert.match(logs, /class="all-logs-mobile-list"/)
assert.match(logs, /:deep\(\.billing-dialog-modal\)\{width:calc\(100% - 16px\)!important/)

console.log('用户调用记录防回归检查通过')
