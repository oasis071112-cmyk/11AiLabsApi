export const CORE_DATA_BUDGET_MS = readPositiveNumber('PERF_CORE_DATA_BUDGET_MS', 1_000)

const localUsers = {
  user: {
    user: { id: 'perf-user', username: 'perf-user', role: 'user', status: 'active' },
    wallet: { quota_balance: 80, gift_quota: 5, frozen_balance: 0, total_spent: 20 },
  },
  admin: {
    user: { id: 'perf-admin', username: 'perf-admin', role: 'admin', status: 'active' },
    wallet: null,
  },
}

export function readPositiveNumber(name, fallback) {
  const parsed = Number(process.env[name] || fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

export async function installSessionMocks(page, role = 'user') {
  if (!localUsers[role]) throw new Error(`Unsupported local performance role: ${role}`)
  await page.addInitScript(({ sessionRole }) => {
    localStorage.setItem('token', 'playwright-local-session')
    localStorage.setItem('userRole', sessionRole)
  }, { sessionRole: role })

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => json(route, localUsers[role]))
  await page.route(/\/api\/public\/info(?:\?.*)?$/, route => json(route, {
    platform_name: 'IonAiLabs local performance run',
    announcement: '',
    customer_service_text: '',
    customer_service_url: '',
  }))
}

export async function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  })
}

export async function delayedJson(route, body, delayMs) {
  if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
  try {
    await json(route, body)
  } catch (error) {
    // The application intentionally aborts stale filters. An already-cancelled
    // route is the expected result, not a test harness failure.
    if (!route.request().failure() && !/closed|aborted|canceled|cancelled/i.test(String(error?.message || error))) throw error
  }
}

export function userOverview(marker, modelCode = 'perf-model') {
  return {
    stats: {
      today_calls: 12,
      today_consumption: 1.25,
      total_consumption: 18.5,
      input_tokens: 1200,
      output_tokens: 600,
      today_status: [{ status: 'success', count: 12 }],
      model_usage: [],
    },
    daily: [],
    data: [{
      id: marker,
      request_id: marker,
      model_code: modelCode,
      billing_mode: 'token',
      input_tokens: 100,
      output_tokens: 50,
      total_cost: 0.25,
      status: 'success',
      error_message: marker,
      created_at: '2026-08-01T00:00:00.000Z',
    }],
  }
}

export async function browserElapsedMs(page) {
  return page.evaluate(() => performance.now())
}
