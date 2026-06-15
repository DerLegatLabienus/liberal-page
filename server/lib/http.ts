/**
 * fetch wrapper with a per-request timeout and a small retry for transient failures.
 *
 * Without a deadline, a hung upstream (e.g. a Knesset endpoint that accepts the connection but
 * never responds) blocks the caller indefinitely — and since the poll loop awaits each external
 * call sequentially, one stuck request stalls the whole cycle. The timeout bounds that; the retry
 * smooths over transient network blips / 5xx. Only used for idempotent GETs (OData, oknesset,
 * the MK-activity scraper) — not for POSTs or the AI path.
 */
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 1

export interface FetchOpts extends RequestInit {
  timeoutMs?: number
  retries?: number
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchWithTimeout(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, ...init } = opts
  let lastErr: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Respect a caller-supplied signal; otherwise bound the request with a timeout.
      const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
      // Retry transient 5xx if attempts remain; return otherwise (4xx/2xx handled by the caller).
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`status ${res.status}`)
        await delay(300 * (attempt + 1))
        continue
      }
      return res
    } catch (err) {
      // AbortError (timeout) or network error.
      lastErr = err
      if (attempt < retries) {
        await delay(300 * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastErr
}
