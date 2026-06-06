const entries = new Map()

export function cachedQuery(key, loader, ttlMs = 120000) {
  const current = entries.get(key)
  if (current?.value && current.expiresAt > Date.now()) return Promise.resolve(current.value)
  if (current?.promise) return current.promise

  const promise = Promise.resolve(loader()).then((value) => {
    entries.set(key, { value, expiresAt: Date.now() + ttlMs })
    return value
  }).catch((error) => {
    entries.delete(key)
    throw error
  })
  entries.set(key, { promise, expiresAt: 0 })
  return promise
}

export function invalidateQueryCache(prefix = "") {
  for (const key of entries.keys()) {
    if (!prefix || key.startsWith(prefix)) entries.delete(key)
  }
}
