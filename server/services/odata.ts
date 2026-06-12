/**
 * Single access point for the Knesset OData API (knesset.gov.il).
 *
 * Owns the base URL, default headers, error handling, and response parsing so that no
 * other module references the base URL or repeats the fetch boilerplate. Callers pass
 * only the entity + query (e.g. `KNS_Bill?$filter=...`).
 */

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

export interface OdataOptions {
  /** Merged over the default `{ Accept: 'application/json' }`. */
  headers?: Record<string, string>
  /** Prefixes the thrown error message, e.g. 'Knesset OData'. */
  errorContext?: string
  /** Forwarded to `fetch` for timeout / cancellation. */
  signal?: AbortSignal
}

async function fetchPage<T>(
  pathAndQuery: string,
  opts: OdataOptions | undefined,
): Promise<{ rows: T[]; nextLink: string | null }> {
  const url = `${ODATA_BASE}/${pathAndQuery}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...opts?.headers },
    signal: opts?.signal,
  })
  console.info(`[api] GET ${url} → ${res.status}`)
  if (!res.ok) {
    const prefix = opts?.errorContext ? `${opts.errorContext} ` : ''
    throw new Error(`${prefix}error ${res.status}: ${pathAndQuery}`)
  }
  const data = (await res.json()) as { value?: T[]; 'odata.nextLink'?: string } | T[]
  const rows = (data as { value?: T[] }).value ?? (Array.isArray(data) ? data : [data as T])
  const nextLink = Array.isArray(data) ? null : (data['odata.nextLink'] ?? null)
  return { rows, nextLink }
}

/** Single page. Throws on non-OK; returns the result array (lenient parsing). */
export async function odataGet<T>(pathAndQuery: string, opts?: OdataOptions): Promise<T[]> {
  const { rows } = await fetchPage<T>(pathAndQuery, opts)
  return rows
}

/** Follows the `odata.nextLink` key until exhausted, concatenating all pages. */
export async function odataGetAllPages<T>(pathAndQuery: string, opts?: OdataOptions): Promise<T[]> {
  const results: T[] = []
  let next: string | null = pathAndQuery
  while (next) {
    const { rows, nextLink }: { rows: T[]; nextLink: string | null } = await fetchPage<T>(next, opts)
    results.push(...rows)
    next = nextLink
  }
  return results
}
