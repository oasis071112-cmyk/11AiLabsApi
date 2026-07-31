import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = new URL(process.env.PERF_BASE_URL || 'http://127.0.0.1:4173')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const isLoopback = loopbackHosts.has(target.hostname)

if (!['http:', 'https:'].includes(target.protocol)) {
  throw new Error('PERF_BASE_URL must use http or https')
}
if (isLoopback && target.protocol !== 'http:') {
  throw new Error('Local Playwright runs use the HTTP Vite preview server')
}
if ((target.username || target.password)) {
  throw new Error('PERF_BASE_URL must not contain credentials')
}
if (!isLoopback && process.env.ALLOW_EXTERNAL_BROWSER_TARGET !== 'true') {
  throw new Error('Refusing a non-local Playwright target. Set ALLOW_EXTERNAL_BROWSER_TARGET=true only after explicit approval.')
}

const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PERF_BASE_URL must contain a valid TCP port')
}

const executablePath = process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH || process.env.CHROME_PATH
const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const localChrome = executablePath
  ? { executablePath }
  : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }

export default defineConfig({
  testDir: './perf',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 2_000 },
  reporter: [['list']],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || join(tmpdir(), 'ionailabs-playwright-performance'),
  use: {
    baseURL: target.origin,
    headless: true,
    ...localChrome,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: isLoopback ? {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: frontendRoot,
    url: target.origin,
    timeout: 30_000,
    reuseExistingServer: process.env.PERF_REUSE_PREVIEW === 'true',
  } : undefined,
})
