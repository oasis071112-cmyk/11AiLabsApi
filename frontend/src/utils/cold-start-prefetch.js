export const coldStartKeys = Object.freeze({
  auth: 'auth:me',
  dashboard: 'user:dashboard',
  walletPaymentOptions: 'wallet:payment-options',
  walletBalance: 'wallet:balance',
  walletTransactions: 'wallet:transactions',
  walletOrders: 'wallet:orders',
  apiKeys: 'user:keys',
  models: 'user:models',
  logsModels: 'logs:models',
  logsOverview: 'logs:overview',
})

export function takeColdStartRequest(key, fallback) {
  const requests = globalThis.window?.__IONAILABS_COLD_START__?.requests
  const entry = requests?.get(key)
  if (!entry) return fallback()
  requests.delete(key)
  if (entry.token !== globalThis.window?.localStorage.getItem('token')) return fallback()
  return entry.promise
}

export async function syncStoredRoleFromColdStart(timeoutMs = 0) {
  const entry = globalThis.window?.__IONAILABS_COLD_START__?.requests?.get(coldStartKeys.auth)
  const currentToken = globalThis.window?.localStorage.getItem('token')
  if (!entry || entry.token !== currentToken) return null
  entry.roleSyncPromise ||= entry.promise.then(response => {
    if (entry.token !== globalThis.window?.localStorage.getItem('token')) return null
    const role = response?.data?.user?.role
    if (role) globalThis.window.localStorage.setItem('userRole', role)
    return role || null
  }).catch(() => null)
  if (!(timeoutMs > 0)) return entry.roleSyncPromise
  entry.boundedRoleSyncPromise ||= Promise.race([
    entry.roleSyncPromise,
    new Promise(resolve => globalThis.window.setTimeout(() => resolve(null), timeoutMs)),
  ])
  return entry.boundedRoleSyncPromise
}
