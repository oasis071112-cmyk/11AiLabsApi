import { expect, test } from '@playwright/test'
import { json } from './mock-api.mjs'

const scenarios = [
  {
    name: 'dashboard',
    path: '/console',
    endpoints: [{
      name: 'dashboard',
      url: /\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/,
      body: { stats: { today_calls: 0, model_usage: [], today_status: [] }, models: [], has_api_keys: false, wallet: {} },
    }],
  },
  {
    name: 'API keys',
    path: '/keys',
    endpoints: [{ name: 'keys', url: /\/api\/user\/keys(?:\?.*)?$/, body: { data: [] } }],
  },
  {
    name: 'models',
    path: '/models',
    endpoints: [{ name: 'models', url: /\/api\/user\/models(?:\?.*)?$/, body: { groups: [], has_api_keys: false } }],
  },
  {
    name: 'logs',
    path: '/logs',
    endpoints: [
      { name: 'models', url: /\/api\/user\/models(?:\?.*)?$/, body: { data: [] } },
      { name: 'overview', url: /\/api\/user\/logs\/overview(?:\?.*)?$/, body: { stats: {}, daily: [], data: [] } },
    ],
  },
]

for (const scenario of scenarios) {
  test(`${scenario.name} data starts before Vue and the component reuses it`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('token', 'playwright-cold-start-session')
      localStorage.setItem('userRole', 'user')
    })

    let vueBundleReleased = false
    await page.route(/\/assets\/vendor-vue-[^/]+\.js$/, async route => {
      const response = await route.fetch()
      await new Promise(resolve => setTimeout(resolve, 350))
      vueBundleReleased = true
      await route.fulfill({ response })
    })
    await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, {
      user: { id: 7, username: 'cold-start-user', role: 'user', status: 'active' },
      wallet: { quota_balance: 10, gift_quota: 0, frozen_balance: 0 },
    }))
    await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
      platform_name: 'IonAiLabs cold-start test', announcement: '', customer_service_text: '', customer_service_url: '',
    }))

    const requests = new Map(scenario.endpoints.map(endpoint => [endpoint.name, []]))
    for (const endpoint of scenario.endpoints) {
      await page.route(endpoint.url, route => {
        requests.get(endpoint.name).push({ beforeVue: !vueBundleReleased })
        return json(route, endpoint.body)
      })
    }

    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' })
    await expect.poll(() => [...requests.values()].every(entries => entries.length > 0)).toBe(true)
    await page.waitForLoadState('networkidle')

    const startTimes = await page.evaluate(() => Object.fromEntries(
      performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/api/'))
        .map(entry => [new URL(entry.name).pathname, entry.startTime]),
    ))
    expect(startTimes['/api/auth/me'], `${scenario.name} auth/me started too late`).toBeLessThan(400)

    for (const [name, entries] of requests) {
      expect(entries[0].beforeVue, `${scenario.name} ${name} waited for Vue`).toBe(true)
      expect(entries, `${scenario.name} ${name} was requested more than once`).toHaveLength(1)
    }
    for (const endpoint of scenario.endpoints) {
      const matchingStart = Object.entries(startTimes).find(([path]) => endpoint.url.test(path))?.[1]
      expect(matchingStart, `${scenario.name} ${endpoint.name} started too late`).toBeLessThan(500)
    }
  })
}

test('an expired prefetched session still redirects to login', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'expired-cold-start-session')
    localStorage.setItem('userRole', 'user')
  })
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, { error: '登录已过期' }, 401))
  await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, { error: '登录已过期' }, 401))

  await page.goto('/console', { waitUntil: 'domcontentloaded' })

  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull()
})

for (const roleCase of [
  { name: 'promotion on an admin route', storedRole: 'user', serverRole: 'admin', requestedPath: '/admin', expectedPath: '/admin' },
  { name: 'promotion on a user route', storedRole: 'user', serverRole: 'admin', requestedPath: '/console', expectedPath: '/admin' },
  { name: 'demotion', storedRole: 'admin', serverRole: 'user', requestedPath: '/admin', expectedPath: '/console' },
]) {
  test(`the route guard applies a server-side role ${roleCase.name} before choosing a shell`, async ({ page }) => {
    await page.addInitScript(role => {
      localStorage.setItem('token', 'role-refresh-session')
      localStorage.setItem('userRole', role)
    }, roleCase.storedRole)
    await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, {
      user: { id: 7, username: 'role-refresh-user', role: roleCase.serverRole, status: 'active' },
      wallet: { quota_balance: 10, gift_quota: 0, frozen_balance: 0 },
    }))
    await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
      platform_name: 'IonAiLabs role refresh test', announcement: '', customer_service_text: '', customer_service_url: '',
    }))
    await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, {
      stats: { today_calls: 0, model_usage: [], today_status: [] }, models: [], has_api_keys: false, wallet: {},
    }))
    await page.route(/\/api\/admin\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, { data: {} }))

    await page.goto(roleCase.requestedPath, { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(new RegExp(`${roleCase.expectedPath.replace('/', '\\/')}$`))
    expect(await page.evaluate(() => localStorage.getItem('userRole'))).toBe(roleCase.serverRole)
  })
}

test('a stalled profile request cannot hold protected navigation behind the fetch timeout', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'stalled-role-session')
    localStorage.setItem('userRole', 'admin')
  })
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, () => new Promise(() => {}))
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs stalled auth test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await page.route(/\/api\/admin\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, { data: {} }))

  const startedAt = Date.now()
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/admin$/, { timeout: 1500 })
  await expect(page.locator('#app')).not.toBeEmpty()

  expect(Date.now() - startedAt).toBeLessThan(1500)
})

test('a stalled profile request cannot leave the landing CTA unresponsive', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'stalled-landing-session')
    localStorage.setItem('userRole', 'user')
  })
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, () => new Promise(() => {}))
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs stalled CTA test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, {
    stats: { today_calls: 0, model_usage: [], today_status: [] }, models: [], has_api_keys: false, wallet: {},
  }))

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const startedAt = Date.now()
  await page.getByRole('button', { name: '进入控制台' }).click()
  await expect(page).toHaveURL(/\/console$/, { timeout: 1500 })

  expect(Date.now() - startedAt).toBeLessThan(1500)
})

test('a stale prefetched 401 cannot erase a newer session token', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'old-cold-start-session')
    localStorage.setItem('userRole', 'user')
  })
  let releaseProfile
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async route => {
    await new Promise(resolve => { releaseProfile = resolve })
    return json(route, { error: '旧登录已过期' }, 401)
  })
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs stale session test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, {
    stats: { today_calls: 0, model_usage: [], today_status: [] }, models: [], has_api_keys: false, wallet: {},
  }))

  await page.goto('/console', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => typeof releaseProfile).toBe('function')
  await page.evaluate(() => localStorage.setItem('token', 'new-cold-start-session'))
  releaseProfile()
  await page.waitForTimeout(250)

  expect(new URL(page.url()).pathname).toBe('/console')
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('new-cold-start-session')
})

test('a stale Axios 401 cannot erase a newer session token', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'old-axios-session')
    localStorage.setItem('userRole', 'user')
  })
  let overviewReads = 0
  let releaseRefresh
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, {
    user: { id: 7, username: 'axios-race-user', role: 'user', status: 'active' },
    wallet: { quota_balance: 10, gift_quota: 0, frozen_balance: 0 },
  }))
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs Axios race test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await page.route(/\/api\/user\/models(?:\?.*)?$/, route => json(route, { data: [] }))
  await page.route(/\/api\/user\/logs\/overview(?:\?.*)?$/, async route => {
    overviewReads += 1
    if (overviewReads === 1) return json(route, { stats: {}, daily: [], data: [] })
    await new Promise(resolve => { releaseRefresh = resolve })
    return json(route, { error: '旧登录已过期' }, 401)
  })

  await page.goto('/logs', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect.poll(() => typeof releaseRefresh).toBe('function')
  await page.evaluate(() => localStorage.setItem('token', 'new-axios-session'))
  releaseRefresh()
  await page.waitForTimeout(250)

  expect(new URL(page.url()).pathname).toBe('/logs')
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('new-axios-session')
})

test('login starts exactly one background profile request from the user layout', async ({ page }) => {
  let profileReads = 0
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs login test', announcement: '', customer_service_text: '', customer_service_url: '',
  }))
  await page.route(/\/api\/auth\/login(?:\?.*)?$/, route => json(route, {
    token: 'fresh-login-session', user: { id: 7, username: 'login-user', role: 'user', status: 'active' },
  }))
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => {
    profileReads += 1
    return json(route, {
      user: { id: 7, username: 'login-user', role: 'user', status: 'active' },
      wallet: { quota_balance: 10, gift_quota: 0, frozen_balance: 0 },
    })
  })
  await page.route(/\/api\/user\/dashboard\/bootstrap(?:\?.*)?$/, route => json(route, {
    stats: { today_calls: 0, model_usage: [], today_status: [] }, models: [], has_api_keys: false, wallet: {},
  }))

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('用户名').fill('login-user')
  await page.getByPlaceholder('密码').fill('test-password')
  await page.getByRole('button', { name: '登 录' }).click()

  await expect(page).toHaveURL(/\/console$/)
  await expect.poll(() => profileReads).toBe(1)
})
