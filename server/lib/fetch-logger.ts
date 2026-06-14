const _fetch = globalThis.fetch

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const res = await _fetch(input, init)
  const msg = `[api] ${method} ${url} → ${res.status}`
  if (res.status >= 500) console.error(msg)
  else if (res.status >= 400) console.warn(msg)
  else console.info(msg)
  return res
}
