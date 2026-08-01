import { expect, test } from '@playwright/test'

const liveEnabled = process.env.LIVE_ADMIN_E2E === 'true'
const username = process.env.LIVE_ADMIN_USERNAME || ''
const password = process.env.LIVE_ADMIN_PASSWORD || ''

test.skip(!liveEnabled, 'Set LIVE_ADMIN_E2E=true with explicit local admin credentials')

test('live admin login and every management page settle without server errors', async ({ page }) => {
  test.setTimeout(45_000)
  expect(username).not.toBe('')
  expect(password).not.toBe('')

  const serverErrors = []
  page.on('response', response => {
    if (response.url().includes('/api/admin/') && response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`)
    }
  })

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('用户名').fill(username)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByRole('button', { name: '登 录' }).click()
  // Authentication includes password hashing and a public network round trip.
  // The two-second UI SLA begins after navigation reaches the dashboard.
  await expect(page).toHaveURL(/\/admin(?:\/|$)/, { timeout: 10_000 })

  await expect(page.locator('[aria-label="正在加载管理概览"]')).toBeHidden({ timeout: 2_000 })
  await expect(page.locator('[aria-label="管理概览加载失败"]')).toBeHidden()
  await expect(page.locator('.admin-metrics:not(.dashboard-skeleton)')).toBeVisible()

  for (const route of [
    '/admin/users', '/admin/orders', '/admin/channels', '/admin/models',
    '/admin/pricing', '/admin/keys', '/admin/logs', '/admin/settings',
  ]) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[aria-busy="true"]')).toBeHidden({ timeout: 2_000 })
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0, { timeout: 2_000 })
  }

  expect(serverErrors).toEqual([])
})
