export function createRequestCoordinator() {
  let active = null
  const inFlight = new Map()

  function clearInFlight(request) {
    if (inFlight.get(request.key) === request) inFlight.delete(request.key)
  }

  function run(key, load) {
    const existing = inFlight.get(key)
    if (existing) return existing

    if (active && active.key !== key) {
      active.controller.abort()
      if (inFlight.get(active.key) === active) inFlight.delete(active.key)
    }

    const controller = new AbortController()
    const request = { key, controller, signal: controller.signal, promise: null }
    active = request
    inFlight.set(key, request)
    let result
    try {
      result = load(controller.signal, request)
    } catch (error) {
      result = Promise.reject(error)
    }
    request.promise = Promise.resolve(result)
      .finally(() => clearInFlight(request))
    return request
  }

  return {
    run,
    isCurrent(request) {
      return active === request && !request.signal.aborted
    },
    cancel() {
      if (active) {
        active.controller.abort()
        if (inFlight.get(active.key) === active) inFlight.delete(active.key)
      }
      active = null
    },
  }
}
