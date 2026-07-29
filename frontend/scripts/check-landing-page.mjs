import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(currentDir, '..')
const read = relativePath => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')

const landing = read('src/views/public/Landing.vue')
const landingCss = read('src/styles/landing.css')
const fadeContent = read('src/components/public/FadeContent.vue')
const router = read('src/router/index.js')
const userLayout = read('src/layouts/UserLayout.vue')
const login = read('src/views/auth/Login.vue')
const register = read('src/views/auth/Register.vue')
const publicRoute = read('../backend/src/routes/public.js')
const modelGroups = JSON.parse(read('src/data/landing-models.json'))

const allModels = modelGroups.flatMap(group => group.models)
const uniqueModels = new Set(allModels)

assert.equal(modelGroups.length, 3, 'Landing page should expose three concise model groups')
assert.equal(allModels.length, 29, 'The supplied model document should produce 29 deduplicated models')
assert.equal(uniqueModels.size, allModels.length, 'Landing model catalog must not contain duplicates')
assert.ok(uniqueModels.has('gpt-image-2'), 'The image model shared by source groups must remain visible once')
assert.ok(uniqueModels.has('claude-fable-5'), 'Claude-exclusive models from the source document must remain visible')
assert.ok(uniqueModels.has('codex-auto-review'), 'Codex models from the source document must remain visible')

assert.match(router, /name:'Landing'.+views\/public\/Landing\.vue.+public:true/, 'Root route must be the public landing page')
assert.match(router, /path:'\/console'.+UserLayout\.vue/, 'Authenticated dashboard must move to /console')
assert.match(router, /next\(isAdmin\?'\/admin':'\/console'\)/, 'Authenticated users leaving guest pages must enter the correct console')
assert.match(userLayout, /\{path:'\/console',label:'控制台'/, 'The first user navigation item must link to /console')
assert.match(login, /authStore\.isAdmin \? '\/admin' : '\/console'/, 'Login must route users to /console')
assert.match(register, /router\.replace\('\/console'\)/, 'Registration completion must route users to /console')

assert.equal((landing.match(/class="landing-console-button"/g) || []).length, 1, 'Landing page must contain one primary console button')
assert.doesNotMatch(landing, /立即注册|免费注册|开始使用/, 'Landing page must not introduce a registration CTA')
assert.match(landing, /联系客服 \/ 加入社群/, 'Customer service and community must be merged into one entry')
assert.match(landing, /role="tablist"/, 'Model and protocol switchers must expose tab semantics')
assert.match(landing, /aria-live="polite"/, 'Copy feedback must be announced to assistive technology')
assert.match(landing, /跳到主要内容/, 'Landing page must include a skip link')
assert.doesNotMatch(`${landing}\n${landingCss}`, /—|–/, 'Visible landing assets must not contain em dashes')
assert.doesNotMatch(landingCss, /linear-gradient|radial-gradient/, 'Landing page must not rely on decorative gradients')
assert.match(landingCss, /min-height:\s*44px/, 'Primary interactions must meet the 44px touch target')
assert.match(landingCss, /@media \(max-width: 360px\)/, 'Landing page must include an explicit small-phone layout')
assert.match(landingCss, /prefers-reduced-motion: reduce/, 'Landing page must honor reduced-motion preferences')
assert.match(fadeContent, /prefers-reduced-motion: reduce/, 'Vue Bits motion wrapper must honor reduced motion')

assert.match(publicRoute, /customer_service_text/, 'Public platform info must expose configurable contact text')
assert.match(publicRoute, /customer_service_url/, 'Public platform info must expose a configurable contact URL')

console.log(`Landing page checks passed: ${uniqueModels.size} unique models, public root route, responsive and accessible interactions.`)
