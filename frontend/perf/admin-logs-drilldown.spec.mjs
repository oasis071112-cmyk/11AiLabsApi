import { expect, test } from '@playwright/test'
import { installSessionMocks, json } from './mock-api.mjs'

const createdAt = '2026-08-13T06:37:03.000Z'
const listRows = [
  {
    id: 901, request_id: 'duplicate-request', created_at: createdAt, model_code: 'claude-opus-4-6',
    username: 'lz11', user_id: 2, status: 'failed', upstream_channel_name: 'Claude Primary',
    user_deduction_usd: 0.1, exact_detail_supported: true,
  },
  {
    id: 902, request_id: 'duplicate-request', created_at: '2026-08-13T06:38:03.000Z',
    model_code: 'claude-opus-4-6', username: 'lz11', user_id: 2, status: 'success',
    upstream_channel_name: 'Claude Backup', user_deduction_usd: 0.2, exact_detail_supported: true,
  },
]

function operationsPayload() {
  return {
    data: listRows,
    pagination: { page: 1, limit: 50, total: 2 },
    summary: { total_calls: 2, user_deduction_usd: 0.3, success_calls: 1, failed_calls: 1, blocked_calls: 0, success_rate: 50 },
    trend: [],
    ranking: [{ key: 'claude-opus-4-6', label: 'claude-opus-4-6', calls: 2, share: 100, user_deduction_usd: 0.3, success_rate: 50, failed_or_blocked_calls: 1 }],
  }
}

function detailPayload() {
  return {
    data: {
      ...listRows[0], key_name: 'agent-key', billing_model: 'claude-opus-4-6', billing_mode: 'token',
      uncached_input_tokens: 100, cached_input_tokens: 20, cache_creation_tokens: 10, output_tokens: 30,
      input_price: 5, output_price: 25, billing_multiplier_input: 1.2, billing_multiplier_output: 1.3,
      billing_multiplier_source_input: 'request_snapshot', billing_multiplier_source_output: 'request_snapshot',
      usd_cny_rate: 7, auto_settlement: { outcome: 'partial_settled' },
      error_type: 'upstream_state_unknown', error_message: 'stream ended', billing_snapshot_missing: false,
    },
  }
}

async function installLogMocks(page, { failFirstDetail = false } = {}) {
  await installSessionMocks(page, 'admin')
  let detailAttempts = 0
  let detailRequestUrl = ''
  await page.route(/\/api\/admin\/logs\/901(?:\?.*)?$/, route => {
    detailAttempts += 1
    detailRequestUrl = route.request().url()
    if (failFirstDetail && detailAttempts === 1) return json(route, { error: '详情暂时不可用' }, 503)
    return json(route, detailPayload())
  })
  await page.route(/\/api\/admin\/logs(?:\?.*)?$/, route => {
    const url = new URL(route.request().url())
    return json(route, url.searchParams.get('include_summary') === 'false'
      ? { data: listRows, pagination: { page: 1, limit: 50, total: 2 } }
      : operationsPayload())
  })
  return {
    detailAttempts: () => detailAttempts,
    detailRequestUrl: () => detailRequestUrl,
  }
}

test('desktop ranking drills into duplicate request IDs and opens an exact complete record in the same drawer', async ({ page }) => {
  const observed = await installLogMocks(page)
  await page.goto('/admin/logs', { waitUntil: 'domcontentloaded' })

  await page.locator('.desktop-ranking-table .el-table__row').first().click()
  const drawer = page.locator('.log-detail-drawer')
  await expect(drawer.locator('.log-record')).toHaveCount(2)
  await expect(drawer.getByText('duplicate-request', { exact: true })).toHaveCount(0)
  await drawer.locator('.log-record').first().click()

  await expect(drawer.getByText('完整调用详情')).toBeVisible()
  await expect(drawer.getByText('缓存读取 Token')).toBeVisible()
  await expect(drawer.getByText('部分用量已结算')).toBeVisible()
  expect(new URL(observed.detailRequestUrl()).searchParams.get('created_at')).toBe(createdAt)
  await drawer.getByRole('button', { name: '返回调用明细列表' }).click()
  await expect(drawer.locator('.log-record')).toHaveCount(2)
})

test('mobile drilldown shows inline failure and retries the same exact record without rendering an empty list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const observed = await installLogMocks(page, { failFirstDetail: true })
  await page.goto('/admin/logs', { waitUntil: 'domcontentloaded' })

  await page.locator('.mobile-ranking-card').first().click()
  const drawer = page.locator('.log-detail-drawer')
  await drawer.locator('.log-record').first().click()
  await expect(drawer.getByText('详情暂时不可用')).toBeVisible()
  await expect(drawer.getByText('暂无调用明细')).toHaveCount(0)
  await drawer.getByRole('button', { name: '重试' }).click()

  await expect(drawer.getByText('用户实际扣费（USD）')).toBeVisible()
  await expect.poll(observed.detailAttempts).toBe(2)
})
