import { expect, test } from '@playwright/test'
import { json } from './mock-api.mjs'

test('log dialogs load only when the user opens them', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'playwright-log-dialog-session')
    localStorage.setItem('userRole', 'user')
  })
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, {
    user: { id: 7, username: 'logs-user', role: 'user', status: 'active' },
    wallet: { quota_balance: 10, gift_quota: 0, frozen_balance: 0 },
  }))
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs logs test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await page.route(/\/api\/user\/models(?:\?.*)?$/, route => json(route, { data: [{ model_code: 'gpt-test' }] }))
  await page.route(/\/api\/user\/logs\/overview(?:\?.*)?$/, route => json(route, {
    stats: { today_calls: 1, today_status: [{ status: 'success', count: 1 }] },
    daily: [],
    data: [{
      id: 1,
      request_id: 'lazy-dialog-log',
      model_code: 'gpt-test',
      billing_mode: 'token',
      input_tokens: 100,
      output_tokens: 50,
      total_cost: 0.25,
      status: 'success',
      error_message: 'lazy-dialog-log',
      created_at: '2026-08-05T00:00:00.000Z',
      billing_detail: {
        mode: 'snapshot', currency: 'USD', calculatedTotal: 0.25,
        dimensions: [{ label: '输入', usage: 100, unitTokens: 1_000_000, unitPrice: 2.5, multiplier: 1, fxRate: 1, amount: 0.25 }],
      },
    }],
  }))
  await page.route(/\/api\/user\/logs(?:\?.*)?$/, route => json(route, {
    data: [], pagination: { page: 1, limit: 20, total: 0 },
  }))

  await page.goto('/logs', { waitUntil: 'networkidle' })
  await expect(page.getByText('lazy-dialog-log')).toBeVisible()

  const initialResources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))
  expect(initialResources.some(url => /(?:AllLogs|BillingDetails)Dialog/.test(url))).toBe(false)
  expect(initialResources.length + 1, `logs cold start loaded ${initialResources.length + 1} document/resources`).toBeLessThan(30)

  await page.getByText('查看全部 →', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: '全部调用记录' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some(entry => /AllLogsDialog/.test(entry.name)))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '全部调用记录' })).toBeHidden()

  await page.getByRole('button', { name: '查看计算过程' }).first().click()
  await expect(page.getByRole('dialog', { name: '计费明细' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some(entry => /BillingDetailsDialog/.test(entry.name)))).toBe(true)
})
