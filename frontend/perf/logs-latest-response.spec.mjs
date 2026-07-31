import { expect, test } from '@playwright/test'
import { delayedJson, installSessionMocks, json, userOverview } from './mock-api.mjs'

test('A to B filtering keeps the latest B response when A completes last', async ({ page }) => {
  let aRequests = 0
  await installSessionMocks(page, 'user')
  await page.route(/\/api\/user\/models(?:\?.*)?$/, route => json(route, {
    data: [
      { model_code: 'model-A' },
      { model_code: 'model-B' },
    ],
    has_api_keys: true,
  }))
  await page.route(/\/api\/user\/logs\/overview(?:\?.*)?$/, route => {
    const model = new URL(route.request().url()).searchParams.get('model')
    if (model === 'model-A') {
      aRequests += 1
      return delayedJson(route, userOverview('RESULT_A_STALE', model), 450)
    }
    if (model === 'model-B') return delayedJson(route, userOverview('RESULT_B_WINS', model), 40)
    return delayedJson(route, userOverview('RESULT_BASELINE'), 20)
  })

  await page.goto('/logs', { waitUntil: 'domcontentloaded' })
  const recentTable = page.locator('.desktop-log-table')
  await expect(recentTable.getByText('RESULT_BASELINE', { exact: true })).toBeVisible()

  const modelSelect = page.locator('.filter-left .el-select')
  await modelSelect.click()
  await page.getByRole('option', { name: 'model-A', exact: true }).click()
  await expect.poll(() => aRequests).toBe(1)

  await modelSelect.click()
  await page.getByRole('option', { name: 'model-B', exact: true }).click()
  await expect(recentTable.getByText('RESULT_B_WINS', { exact: true })).toBeVisible()
  await page.waitForTimeout(500)

  await expect(recentTable.getByText('RESULT_B_WINS', { exact: true })).toBeVisible()
  await expect(recentTable.getByText('RESULT_A_STALE', { exact: true })).toHaveCount(0)
})
