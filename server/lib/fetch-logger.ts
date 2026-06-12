const _fetch = globalThis.fetch

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const res = await _fetch(input, init)
  console.info(`[api] ${method} ${url} → ${res.status}`)
  return res
}
