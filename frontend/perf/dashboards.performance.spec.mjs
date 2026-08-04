import { expect, test } from '@playwright/test'
import {
  browserElapsedMs,
  CORE_DATA_BUDGET_MS,
  delayedJson,
  installSessionMocks,
  json,
} from './mock-api.mjs'

test('user dashboard shows an actionable skeleton and core bootstrap data within budget', async ({ page }) => {
  let bootstrapRequests = 0
  await installSessionMocks(page, 'user')
  await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => {
    bootstrapRequests += 1
    return delayedJson(route, {
      stats: {
        today_calls: 42,
        today_consumption: 1.5,
        total_consumption: 21,
        today_status: [{ status: 'success', count: 42 }],
        model_usage: [],
      },
      models: [{
        model_code: 'PERF_USER_MODEL',
        model_name: 'Performance User Model',
        protocol_types: ['openai'],
        model_type: 'text',
      }],
      has_api_keys: true,
      wallet: { quota_balance: 80, gift_quota: 5, frozen_balance: 0, total_spent: 20 },
    }, 300)
  })

  await page.goto('/console', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { name: 'API Key', exact: true })).toBeVisible()
  await expect(page.locator('[aria-label="正在加载调用数据"]')).toBeVisible()
  const skeletonElapsed = await browserElapsedMs(page)
  expect(skeletonElapsed, `user actionable skeleton took ${skeletonElapsed.toFixed(0)}ms`).toBeLessThanOrEqual(CORE_DATA_BUDGET_MS)
  await expect(page.getByText('PERF_USER_MODEL', { exact: true })).toBeVisible({ timeout: CORE_DATA_BUDGET_MS })

  const elapsed = await browserElapsedMs(page)
  expect(elapsed, `user core data took ${elapsed.toFixed(0)}ms`).toBeLessThanOrEqual(CORE_DATA_BUDGET_MS)
  expect(bootstrapRequests).toBe(1)
})

test('authenticated dashboard starts core data loading before a slow profile check returns', async ({ page }) => {
  let profileStarted = false
  let profilePending = true
  let bootstrapStartedWhileProfilePending = false
  await installSessionMocks(page, 'user')
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async route => {
    profileStarted = true
    await new Promise(resolve => setTimeout(resolve, 600))
    profilePending = false
    return json(route, {
      user: { id: 'perf-user', username: 'perf-user', role: 'user', status: 'active' },
      wallet: { quota_balance: 80, gift_quota: 5, frozen_balance: 0, total_spent: 20 },
    })
  })
  await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => {
    bootstrapStartedWhileProfilePending = profileStarted && profilePending
    return json(route, {
      stats: { today_calls: 0, model_usage: [], today_status: [] },
      models: [],
      has_api_keys: false,
      wallet: { quota_balance: 80, gift_quota: 5, frozen_balance: 0, total_spent: 20 },
    })
  })

  await page.goto('/console', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { name: 'API Key', exact: true })).toBeVisible()
  await expect.poll(() => bootstrapStartedWhileProfilePending).toBe(true)
})

test('admin dashboard shows an actionable skeleton and core bootstrap data within budget', async ({ page }) => {
  let bootstrapRequests = 0
  await installSessionMocks(page, 'admin')
  await page.route(/\/api\/admin\/dashboard\/bootstrap(?:\?.*)?$/, route => {
    bootstrapRequests += 1
    return delayedJson(route, {
      today_recharge: 99,
      today_consumption: 8,
      new_users_today: 3,
      today_calls: 73,
      failed_calls: 1,
      active_channels: 4,
      total_revenue: 999,
      total_users: 25,
      daily_trend: [],
      model_ranking: [{ model_code: 'PERF_ADMIN_MODEL', calls: 73, cost: 8 }],
    }, 300)
  })

  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('menuitem', { name: '用户管理' })).toBeVisible()
  await expect(page.locator('[aria-label="正在加载管理概览"]')).toBeVisible()
  const skeletonElapsed = await browserElapsedMs(page)
  expect(skeletonElapsed, `admin actionable skeleton took ${skeletonElapsed.toFixed(0)}ms`).toBeLessThanOrEqual(CORE_DATA_BUDGET_MS)
  await expect(page.getByText('PERF_ADMIN_MODEL', { exact: true })).toBeVisible({ timeout: CORE_DATA_BUDGET_MS })

  const elapsed = await browserElapsedMs(page)
  expect(elapsed, `admin core data took ${elapsed.toFixed(0)}ms`).toBeLessThanOrEqual(CORE_DATA_BUDGET_MS)
  expect(bootstrapRequests).toBe(1)
})

test('admin dashboard ends the skeleton and exposes retry when bootstrap fails', async ({ page }) => {
  let fallbackRequests = 0
  await installSessionMocks(page, 'admin')
  await page.route(/\/api\/admin\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, {
    error: 'dashboard query failed',
  }, 500))
  await page.route(/\/api\/admin\/dashboard(?:\?.*)?$/, route => {
    fallbackRequests += 1
    return json(route, { error: 'legacy dashboard should not mask server failures' }, 500)
  })

  await page.goto('/admin', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('[aria-label="正在加载管理概览"]')).toBeHidden()
  await expect(page.getByRole('alert', { name: '管理概览加载失败' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  expect(fallbackRequests).toBe(0)
})

test('admin dashboard accepts a two-second bootstrap without showing a timeout error', async ({ page }) => {
  await installSessionMocks(page, 'admin')
  await page.route(/\/api\/admin\/dashboard\/bootstrap(?:\?.*)?$/, route => delayedJson(route, {
    today_calls: 73,
    active_channels: 4,
    daily_trend: [],
    model_ranking: [{ model_code: 'SLOW_ADMIN_MODEL', calls: 73, cost: 8 }],
  }, 2_000))

  await page.goto('/admin', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('SLOW_ADMIN_MODEL', { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('alert', { name: '管理概览加载失败' })).toHaveCount(0)
})
