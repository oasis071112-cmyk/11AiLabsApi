import process from 'node:process'
import { launch } from 'chrome-launcher'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import { preview } from 'vite'

const target = new URL(process.env.LIGHTHOUSE_TARGET || 'http://127.0.0.1:4173/')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const isLoopback = loopbackHosts.has(target.hostname)

if (!['http:', 'https:'].includes(target.protocol)) throw new Error('LIGHTHOUSE_TARGET must use http or https')
if (isLoopback && target.protocol !== 'http:') throw new Error('Local Lighthouse runs use the HTTP Vite preview server')
if (target.username || target.password) throw new Error('LIGHTHOUSE_TARGET must not contain credentials')
if (!isLoopback && process.env.ALLOW_EXTERNAL_LIGHTHOUSE_TARGET !== 'true') {
  throw new Error('Refusing a non-local Lighthouse target. Set ALLOW_EXTERNAL_LIGHTHOUSE_TARGET=true only after explicit approval.')
}

const thresholds = {
  performance: readRatio('LIGHTHOUSE_MIN_PERFORMANCE', 0.70),
  accessibility: readRatio('LIGHTHOUSE_MIN_ACCESSIBILITY', 0.85),
  'best-practices': readRatio('LIGHTHOUSE_MIN_BEST_PRACTICES', 0.80),
  seo: readRatio('LIGHTHOUSE_MIN_SEO', 0.80),
}
const metricBudgets = {
  'first-contentful-paint': readPositive('LIGHTHOUSE_MAX_FCP_MS', 1_800),
  'largest-contentful-paint': readPositive('LIGHTHOUSE_MAX_LCP_MS', 3_000),
  'cumulative-layout-shift': readPositive('LIGHTHOUSE_MAX_CLS', 0.10),
}

let previewServer
let chrome
try {
  if (isLoopback) previewServer = await startLocalPreview(target)
  chrome = await launch({
    chromePath: process.env.LIGHTHOUSE_CHROME_PATH || process.env.CHROME_PATH || undefined,
    chromeFlags: ['--headless=new', '--no-first-run', '--disable-extensions'],
  })

  const result = await lighthouse(target.href, {
    port: chrome.port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: Object.keys(thresholds),
    formFactor: 'desktop',
    screenEmulation: {
      mobile: false,
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      disabled: false,
    },
  }, desktopConfig)
  if (!result?.lhr) throw new Error('Lighthouse did not return a report')

  const failures = []
  const scores = Object.fromEntries(Object.entries(thresholds).map(([category, minimum]) => {
    const score = result.lhr.categories[category]?.score ?? 0
    if (score < minimum) failures.push(`${category} ${(score * 100).toFixed(0)} < ${(minimum * 100).toFixed(0)}`)
    return [category, score]
  }))
  const metrics = Object.fromEntries(Object.entries(metricBudgets).map(([audit, maximum]) => {
    const value = result.lhr.audits[audit]?.numericValue ?? Number.POSITIVE_INFINITY
    if (value > maximum) failures.push(`${audit} ${formatMetric(audit, value)} > ${formatMetric(audit, maximum)}`)
    return [audit, value]
  }))

  console.log(`Lighthouse target: ${target.origin}${target.pathname}`)
  for (const [name, score] of Object.entries(scores)) console.log(`${name}: ${(score * 100).toFixed(0)}`)
  for (const [name, value] of Object.entries(metrics)) console.log(`${name}: ${formatMetric(name, value)}`)
  if (failures.length) throw new Error(`Lighthouse budgets failed: ${failures.join('; ')}`)
  console.log('Lighthouse budgets passed')
} finally {
  await Promise.resolve(chrome?.kill()).catch(() => {})
  await closePreview(previewServer)
}

async function startLocalPreview(url) {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LIGHTHOUSE_TARGET must contain a valid TCP port')
  return preview({
    logLevel: 'error',
    preview: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{
      name: 'local-lighthouse-public-info',
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
          if (pathname !== '/api/public/info') return next()
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({
            platform_name: 'IonAiLabs local Lighthouse run',
            announcement: '',
            customer_service_text: '',
            customer_service_url: '',
          }))
        })
      },
    }],
  })
}

function closePreview(server) {
  if (!server?.httpServer?.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}

function readRatio(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`)
  return value
}

function readPositive(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

function formatMetric(name, value) {
  return name === 'cumulative-layout-shift' ? Number(value).toFixed(3) : `${Number(value).toFixed(0)}ms`
}
