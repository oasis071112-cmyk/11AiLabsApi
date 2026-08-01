import { expect, test } from '@playwright/test'
import { installSessionMocks, json } from './mock-api.mjs'

const userRow = {
  id: '2', username: 'lz11', email: 'lz11@local.invalid', role: 'user', status: 'active',
  quota_balance: '0.000000', gift_quota: '0.997899', total_spent: '0.002101',
  register_time: '2026-08-01T11:26:00.427Z',
}

async function mockAdminUsers(page) {
  await installSessionMocks(page, 'admin')
  await page.route(/\/api\/admin\/users(?:\?.*)?$/, route => json(route, {
    data: [userRow], pagination: { page: 1, limit: 20, total: 1 },
  }))
}

test('desktop user management renders all PostgreSQL numeric columns and fills its table', async ({ page }) => {
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await mockAdminUsers(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })

  const table = page.locator('.desktop-users-table')
  await expect(table.getByText('0 点', { exact: true }).first()).toBeVisible()
  await expect(table.getByText('1 点', { exact: true })).toBeVisible()
  await expect(table.getByRole('button', { name: '详情' })).toBeVisible()
  const widths = await page.locator('.desktop-users-table').evaluate(table => {
    const wrapper = table.getBoundingClientRect().width
    const header = table.querySelector('.el-table__header')?.getBoundingClientRect().width || 0
    const body = table.querySelector('.el-table__body')?.getBoundingClientRect().width || 0
    return { wrapper, header, body }
  })
  expect(widths.wrapper).toBeGreaterThan(900)
  expect(Math.abs(widths.header - widths.body)).toBeLessThanOrEqual(1)
  expect(consoleErrors).toEqual([])
})

for (const viewport of [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
]) {
  test(`user management uses touch-safe cards without horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await mockAdminUsers(page)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.mobile-user-list')).toBeVisible()
    await expect(page.locator('.desktop-users-table')).toBeHidden()
    await expect(page.getByRole('button', { name: '详情' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('user can open a PostgreSQL billing calculation without render errors', async ({ page }) => {
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await installSessionMocks(page, 'user')
  await page.route(/\/api\/user\/models(?:\?.*)?$/, route => json(route, { data: [] }))
  await page.route(/\/api\/user\/logs\/overview(?:\?.*)?$/, route => json(route, {
    stats: { today_calls: 1, today_consumption: '0.002101', total_consumption: '0.002101', today_status: [{ status: 'success', count: 1 }] },
    daily: [],
    data: [{
      request_id: 'req-pg', model_code: 'claude-opus-4-8', billing_mode: 'token',
      input_tokens: '0', output_tokens: '83', total_cost: '0.002101', status: 'success',
      created_at: '2026-08-01T11:49:56.370Z',
      billing_detail: {
        mode: 'snapshot', currency: 'USD', calculatedTotal: 0.002101,
        dimensions: [{ label: '输出 Token', usage: 83, unitTokens: 1_000_000, unitPrice: 25, multiplier: 0.15, fxRate: 6.7502, amount: 0.002101 }],
        notice: '价格、倍率和汇率均使用本次调用发生时保存的快照。',
      },
    }],
  }))
  await page.goto('/logs', { waitUntil: 'domcontentloaded' })

  const button = page.getByRole('button', { name: '查看计算过程' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.getByRole('dialog', { name: '计费明细' })).toBeVisible()
  await expect(page.getByText('调用记录实际扣除 0.002101 点')).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test('boolean gift switch reflects PostgreSQL state and saves a boolean', async ({ page }) => {
  const writes = []
  const warnings = []
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()) })
  await installSessionMocks(page, 'admin')
  await page.route(/\/api\/admin\/config(?:\?.*)?$/, route => json(route, { data: [
    { config_key: 'new_user_gift_enabled', config_value: true, description: '是否开启新用户赠送' },
    { config_key: 'new_user_gift_amount', config_value: 1, description: '新用户赠送金额' },
  ] }))
  await page.route(/\/api\/admin\/payment\/providers(?:\?.*)?$/, route => json(route, { data: [] }))
  await page.route(/\/api\/admin\/config\/new_user_gift_enabled$/, async route => {
    writes.push(route.request().postDataJSON())
    return json(route, { data: { config_key: 'new_user_gift_enabled', config_value: false } })
  })
  await page.route(/\/api\/admin\/config\/new_user_gift_amount$/, route => json(route, { data: {} }))
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' })

  const giftSwitch = page.getByRole('switch', { name: '是否开启新用户赠送' })
  await expect(giftSwitch).toHaveAttribute('aria-checked', 'true')
  await page.locator('.el-form-item').filter({ hasText: '是否开启新用户赠送' }).locator('.el-switch').click()
  await page.getByRole('button', { name: '保存基础设置' }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toEqual({ config_value: false })
  expect(warnings.filter(message => message.includes('[ElSwitch]'))).toEqual([])
})
