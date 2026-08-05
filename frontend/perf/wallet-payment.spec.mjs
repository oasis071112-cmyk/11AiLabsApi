import { expect, test } from '@playwright/test'
import { installSessionMocks } from './mock-api.mjs'

async function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) })
}

async function installWalletMocks(context, state) {
  await context.addInitScript(() => {
    localStorage.setItem('token', 'playwright-wallet-session')
    localStorage.setItem('userRole', 'user')
  })
  await context.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, {
    user: { id: 7, username: 'wallet-user', role: 'user', status: 'active' },
    wallet: { quota_balance: 0, gift_quota: 0, frozen_balance: 0 },
  }))
  await context.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs wallet test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await context.route(/\/api\/user\/payment-options(?:\?.*)?$/, route => json(route, {
    enabled: true, methods: ['alipay'], minimum: 1, maximum: 10000,
  }))
  await context.route(/\/api\/user\/wallet(?:\?.*)?$/, route => {
    state.walletReads += 1
    return json(route, { quota_balance: state.status === 'granted' ? 10 : 0, gift_quota: 0, frozen_balance: 0 })
  })
  await context.route(/\/api\/user\/transactions(?:\?.*)?$/, route => {
    state.transactionReads += 1
    return json(route, { data: [], pagination: { page: 1, limit: 20, total: 0 } })
  })
  await context.route(/\/api\/user\/recharge-orders(?:\?.*)?$/, route => {
    state.orderReads += 1
    return json(route, { data: [], pagination: { page: 1, limit: 20, total: 0 } })
  })
  await context.route(/\/api\/user\/payment-orders\/EPTEST(?:\?.*)?$/, route => {
    state.statusReads += 1
    return json(route, { data: { order_no: 'EPTEST', status: state.status } })
  })
  await context.route(/\/api\/user\/payment-orders(?:\?.*)?$/, route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.orderCreates += 1
    const action = new URL('/fake-pay', route.request().url()).href
    return json(route, {
      order_no: 'EPTEST',
      payment_request: { method: 'POST', action, fields: { out_trade_no: 'EPTEST' } },
    }, 201)
  })
  await context.route(/\/fake-pay$/, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Mock Pay</title><h1>Mock payment page</h1>',
  }))
}

test('wallet cold start launches payment, balance, transaction, and order reads together', async ({ page }) => {
  await installSessionMocks(page, 'user')
  const startedAt = new Map()
  const startedBeforeVue = new Map()
  let vueBundleReleased = false
  let authStartedBeforeVue = false
  await page.route(/\/assets\/vendor-vue-[^/]+\.js$/, async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 350))
    vueBundleReleased = true
    await route.fulfill({ response })
  })
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => {
    authStartedBeforeVue = !vueBundleReleased
    return json(route, {
      user: { id: 7, username: 'wallet-user', role: 'user', status: 'active' },
      wallet: { quota_balance: 10, gift_quota: 0, frozen_balance: 0 },
    })
  })
  const record = (name, route, body, delayMs = 0) => {
    startedAt.set(name, performance.now())
    startedBeforeVue.set(name, !vueBundleReleased)
    return new Promise(resolve => setTimeout(resolve, delayMs)).then(() => json(route, body))
  }

  await page.route(/\/api\/user\/payment-options(?:\?.*)?$/, route => record('payment-options', route, {
    enabled: true, methods: ['alipay'], minimum: 1, maximum: 10000,
  }, 350))
  await page.route(/\/api\/user\/wallet(?:\?.*)?$/, route => record('wallet', route, {
    quota_balance: 10, gift_quota: 0, frozen_balance: 0,
  }))
  await page.route(/\/api\/user\/transactions(?:\?.*)?$/, route => record('transactions', route, {
    data: [], pagination: { page: 1, limit: 20, total: 0 },
  }))
  await page.route(/\/api\/user\/recharge-orders(?:\?.*)?$/, route => record('recharge-orders', route, {
    data: [], pagination: { page: 1, limit: 20, total: 0 },
  }))

  await page.goto('/wallet', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => startedAt.size).toBe(4)

  const starts = [...startedAt.values()]
  const spreadMs = Math.max(...starts) - Math.min(...starts)
  expect(spreadMs, `wallet startup request spread was ${spreadMs.toFixed(0)}ms`).toBeLessThan(30)
  expect(authStartedBeforeVue, 'profile request waited for the Vue bundle').toBe(true)
  expect([...startedBeforeVue.values()].every(Boolean), 'wallet data waited for the Vue bundle').toBe(true)

  await page.waitForLoadState('networkidle')
  const resourceCount = await page.evaluate(() => performance.getEntriesByType('resource').length + 1)
  expect(resourceCount, `wallet cold start loaded ${resourceCount} document/resources`).toBeLessThan(30)
})

test('online payment stays on the wallet, refreshes from the signed order state, and closes the return tab', async ({ context, page }) => {
  const state = { status: 'pending', orderCreates: 0, statusReads: 0, walletReads: 0, transactionReads: 0, orderReads: 0 }
  await installWalletMocks(context, state)
  await page.goto('/wallet', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '购买额度包' }).click()

  const popupPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: '提交购买订单' }).click()
  const paymentPage = await popupPromise
  await paymentPage.waitForURL(/\/fake-pay$/)

  expect(state.orderCreates).toBe(1)
  expect(new URL(page.url()).pathname).toBe('/wallet')

  const baseline = { wallet: state.walletReads, transactions: state.transactionReads, orders: state.orderReads }
  await page.evaluate(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay >= 1000 ? 10 : delay, ...args)
  })
  const statusReadsBeforeReturn = state.statusReads
  await paymentPage.goto('/wallet?payment_order=EPTEST', { waitUntil: 'domcontentloaded' })

  await expect.poll(() => paymentPage.isClosed()).toBe(true)
  await expect.poll(() => state.statusReads - statusReadsBeforeReturn).toBeGreaterThan(20)
  state.status = 'granted'
  await expect(page.locator('.kpi-card').filter({ hasText: '额度点数' }).getByText('10.00 点', { exact: true })).toBeVisible()
  expect(state.walletReads).toBeGreaterThan(baseline.wallet)
  expect(state.transactionReads).toBeGreaterThan(baseline.transactions)
  expect(state.orderReads).toBeGreaterThan(baseline.orders)
  expect(state.statusReads).toBeGreaterThan(0)
})

test('a blocked payment popup prevents order creation', async ({ context, page }) => {
  const state = { status: 'pending', orderCreates: 0, statusReads: 0, walletReads: 0, transactionReads: 0, orderReads: 0 }
  await context.addInitScript(() => { window.open = () => null })
  await installWalletMocks(context, state)
  await page.goto('/wallet', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '购买额度包' }).click()
  await page.getByRole('button', { name: '提交购买订单' }).click()

  await expect(page.getByText('支付页面被浏览器拦截，请允许弹出窗口后重试')).toBeVisible()
  expect(state.orderCreates).toBe(0)
  expect(new URL(page.url()).pathname).toBe('/wallet')
})
