import { expect, test } from '@playwright/test'
import { installSessionMocks, json } from './mock-api.mjs'

test('admin can explicitly restore the payment switch and provider after migration', async ({ page }) => {
  const configWrites = []
  const providerWrites = []
  await installSessionMocks(page, 'admin')
  await page.route(/\/api\/admin\/config(?:\?.*)?$/, route => json(route, { data: [
    { config_key: 'payment_enabled', config_value: 'false', description: '在线支付' },
  ] }))
  await page.route(/\/api\/admin\/payment\/providers(?:\?.*)?$/, route => json(route, { data: [{
    id: 7, provider_code: 'easypay:main', provider_name: '易支付', provider_type: 'easypay',
    api_base_url: 'https://pay.example.test', merchant_id: '10001', enabled_methods: ['alipay'],
    alipay_type: 'alipay', wechat_type: '', status: 'disabled', secret_configured: true,
  }] }))
  await page.route(/\/api\/admin\/config\/payment_enabled$/, async route => {
    configWrites.push(route.request().postDataJSON())
    return json(route, { message: 'ok', data: { config_key: 'payment_enabled', config_value: true } })
  })
  await page.route(/\/api\/admin\/payment\/providers\/7$/, async route => {
    providerWrites.push(route.request().postDataJSON())
    return json(route, { message: 'ok', data: { id: 7, status: 'active' } })
  })

  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '支付设置' }).click()
  const paymentSwitch = page.locator('.el-form-item').filter({ hasText: '在线支付' }).locator('.el-switch')
  await paymentSwitch.click()
  await page.getByRole('button', { name: '保存支付基础设置' }).click()
  await expect.poll(() => configWrites.length).toBe(1)
  expect(configWrites[0]).toEqual({ enable: true })

  await page.getByRole('button', { name: '编辑' }).click()
  const dialog = page.getByRole('dialog', { name: '编辑易支付' })
  await dialog.locator('.el-form-item').filter({ hasText: '状态' }).locator('.el-switch').click()
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect.poll(() => providerWrites.length).toBe(1)
  expect(providerWrites[0]).toMatchObject({ status: 'active', enable: true })
})
