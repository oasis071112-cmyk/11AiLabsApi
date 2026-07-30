import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
const apiKeys = read('../src/views/user/ApiKeys.vue')
const wallet = read('../src/views/user/Wallet.vue')
const router = read('../src/router/index.js')
const userRoutes = read('../../backend/src/routes/user.js')

assert.match(apiKeys, /@click="copyStoredKey\(row\)"/)
assert.match(apiKeys, /api\.post\('\/api\/user\/keys\/'\+row\.id\+'\/export'\)/)
assert.doesNotMatch(apiKeys, /openExport|exportPwd|key-auth-dialog|key-export-result-dialog/)
assert.equal((apiKeys.match(/copiedKeyId===row\.id\s*\?\s*'已复制 ✓'\s*:\s*'复制'/g) || []).length, 2)
assert.match(apiKeys, /async function copyStoredKey\(row\)\{[\s\S]*?await copyText\(r\.data\.key_raw\);copiedKeyId\.value=row\.id;ElMessage\.success\('复制成功'\)/)

const exportRoute = userRoutes.match(/router\.post\('\/keys\/:id\/export'[\s\S]*?\n\}\);/)?.[0] || ''
assert.match(exportRoute, /WHERE id=\? AND user_id=\?/)
assert.match(exportRoute, /res\.json\(\{ key_raw: raw \}\)/)
assert.doesNotMatch(exportRoute, /password|password_hash|compareSync/)

assert.match(router, /\{path:'\/subscribe',name:'Subscribe',component:\(\)=>import\('@\/views\/user\/Wallet\.vue'\)\}/)
assert.match(wallet, /watch\(\(\)=>route\.path,path=>\{if\(path==='\/subscribe'\)rechargeDialog\.value=true\},\{immediate:true\}\)/)
assert.match(wallet, /@closed="onRechargeClosed"/)

console.log('用户端关键操作防回归检查通过')
