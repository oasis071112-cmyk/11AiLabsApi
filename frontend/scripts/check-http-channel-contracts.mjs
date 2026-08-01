import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(currentDir, '..')
const read = relativePath => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `Missing contract marker: ${startMarker}`)
  assert.ok(end > start, `Missing contract boundary: ${endMarker}`)
  return source.slice(start, end)
}

const api = read('src/api/index.js')
const channels = read('src/views/admin/Channels.vue')

assert.match(channels, /label="最大并发"/, '渠道表单必须向管理员显示最大并发')
assert.match(
  channels,
  /const emptyChannel=\(\)=>\(\{[^\n]*max_concurrency:5/,
  '新建渠道表单必须默认最大并发为 5',
)

const interceptorStart = api.indexOf('api.interceptors.response.use')
const canceledGuard = api.indexOf("axios.isCancel(e)||e?.code==='ERR_CANCELED'", interceptorStart)
const errorToast = api.indexOf('ElMessage.error(', interceptorStart)
assert.ok(interceptorStart >= 0, 'API client must install a response interceptor')
assert.ok(canceledGuard > interceptorStart, 'Response interceptor must recognize Axios cancellations and ERR_CANCELED')
assert.ok(errorToast > canceledGuard, 'Cancellation must return before the global error toast is reached')
assert.match(
  api.slice(canceledGuard, errorToast),
  /return Promise\.reject\(e\)/,
  'A canceled request must reject silently so callers can finish their own cleanup',
)

const openGroup = sliceBetween(channels, 'function openGroup(', 'async function saveGroup(')
assert.match(
  openGroup,
  /item\.account_id\s*\?\?\s*item\.channel_id/,
  'Routing-group editing must accept both PostgreSQL account_id and legacy channel_id memberships',
)
assert.match(openGroup, /model_rules:\(row\?\.model_rules\|\|\[\]\)/, 'Routing-group editing must retain imported per-model rules')

const saveGroup = sliceBetween(channels, 'async function saveGroup(', 'async function toggleGroup(')
assert.match(saveGroup, /existingRules=new Map/, 'Routing-group writes must index the existing per-model rules')
assert.match(saveGroup, /const model_rules=/, 'Routing-group writes must explicitly return per-model multipliers')
assert.match(saveGroup, /model_rules,channels:/, 'Routing-group payload must include the preserved rules')

const billingFieldsStart = channels.indexOf('const billingFields=')
const openMappingsStart = channels.indexOf('async function openMappings(', billingFieldsStart)
assert.ok(billingFieldsStart >= 0 && openMappingsStart > billingFieldsStart, 'Channels must declare its billing mapping contract')
const billingFields = channels.slice(billingFieldsStart, openMappingsStart)
for (const field of [
  'billing_mode',
  'billing_model_source',
  'input_price',
  'output_price',
  'cache_write_price',
  'cache_read_price',
  'image_input_price',
  'image_output_price',
  'per_request_price',
  'image_price_1k',
  'image_price_2k',
  'image_price_4k',
]) {
  assert.match(billingFields, new RegExp(`['"]${field}['"]`), `Billing contract must retain ${field}`)
}

const openMappings = sliceBetween(channels, 'async function openMappings(', 'async function saveMappings(')
assert.match(
  openMappings,
  /payload\.mappings\s*\|\|\s*payload\.data\s*\|\|\s*\[\]/,
  'Mapping reads must accept both the new mappings field and the legacy data field',
)
assert.match(
  openMappings,
  /payload\.mappings\s*\?\s*payload\.data\s*:\s*catalog/,
  'New responses may supply their model catalog while legacy responses must reuse the separately loaded catalog',
)
assert.match(
  openMappings,
  /\.\.\.\(item\.configuration\s*\|\|\s*\{\}\)/,
  'Nested PostgreSQL billing configuration must be flattened for the existing editor',
)

const saveMappings = sliceBetween(channels, 'async function saveMappings(', 'function healthType(')
assert.match(
  saveMappings,
  /Object\.fromEntries\(billingFields\.map\(field=>\[field,item\[field\]\]\)\)/,
  'Every editable billing field must be collected before saving',
)
assert.match(
  saveMappings,
  /\.\.\.configuration\s*,\s*configuration/,
  'Mapping writes must send billing fields both top-level for compatibility and nested for PostgreSQL',
)

console.log('HTTP 取消与渠道兼容契约检查通过')
