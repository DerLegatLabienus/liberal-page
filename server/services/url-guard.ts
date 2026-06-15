import { lookup } from 'dns/promises'
import ipaddr from 'ipaddr.js'

/**
 * SSRF guard for server-side document fetches. The PRIMARY control is the host allowlist
 * (default-deny: only Knesset document hosts are reachable). The IP classification is
 * defense-in-depth against an allowlisted name resolving to an internal address
 * (DNS-rebinding) — and it's library-backed (ipaddr.js, tracks the IANA special-use
 * registry) rather than a hand-rolled private-range list, which would inevitably miss
 * ranges (CGNAT, benchmark, IPv6 ULA/link-local, IPv4-mapped, NAT64, …).
 */

// Host must equal a suffix or end with "." + suffix. Extend if a legitimate Knesset
// document host outside knesset.gov.il appears (verify against prod document_url hosts).
export const ALLOWED_DOC_HOST_SUFFIXES = ['knesset.gov.il']

export class UrlNotAllowedError extends Error {
  constructor(public reason: string) {
    super(`URL not allowed: ${reason}`)
    this.name = 'UrlNotAllowedError'
  }
}

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '') // strip a trailing dot
  return ALLOWED_DOC_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))
}

/** True only for a globally-routable unicast address (after unwrapping IPv4-mapped IPv6). */
function isGlobalUnicast(addr: string): boolean {
  let ip
  try {
    ip = ipaddr.parse(addr)
  } catch {
    return false // unparseable → treat as unsafe
  }
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address()
  }
  return ip.range() === 'unicast'
}

/**
 * Validate a caller/document URL before the server fetches it. Returns the parsed URL on
 * success; throws UrlNotAllowedError otherwise. Steps: scheme → host allowlist → DNS resolve
 * → reject if ANY resolved address is not global unicast.
 */
export async function assertAllowedDocumentUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UrlNotAllowedError('malformed URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlNotAllowedError(`scheme ${url.protocol}`)
  }
  if (!hostAllowed(url.hostname)) {
    throw new UrlNotAllowedError(`host ${url.hostname}`)
  }

  let resolved: { address: string }[]
  try {
    resolved = await lookup(url.hostname, { all: true })
  } catch {
    throw new UrlNotAllowedError(`DNS resolution failed for ${url.hostname}`)
  }
  if (resolved.length === 0) throw new UrlNotAllowedError(`no DNS records for ${url.hostname}`)

  for (const { address } of resolved) {
    if (!isGlobalUnicast(address)) {
      throw new UrlNotAllowedError(`host ${url.hostname} resolves to non-public address ${address}`)
    }
  }
  return url
}

export class DocumentFetchError extends Error {
  constructor(public reason: string) {
    super(`Document fetch failed: ${reason}`)
    this.name = 'DocumentFetchError'
  }
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 15 * 1024 * 1024 // 15 MB
const MAX_REDIRECTS = 3

/**
 * Fetch a document with full SSRF protection: every hop (including redirects) is re-validated
 * through assertAllowedDocumentUrl, with a timeout and a size cap. Throws UrlNotAllowedError for
 * policy violations and DocumentFetchError for network/status/size failures.
 */
export async function fetchAllowedDocument(raw: string): Promise<Buffer> {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertAllowedDocumentUrl(current) // re-validate each hop (defeats redirect-to-internal)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(current, { redirect: 'manual', signal: controller.signal })
    } catch (err) {
      throw new DocumentFetchError(controller.signal.aborted ? 'timeout' : `network error (${String(err)})`)
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new DocumentFetchError(`redirect with no Location (status ${res.status})`)
      current = new URL(location, current).toString()
      continue
    }
    if (!res.ok) throw new DocumentFetchError(`status ${res.status}`)

    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new DocumentFetchError(`content-length ${declared} exceeds ${MAX_BYTES}`)
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength > MAX_BYTES) {
      throw new DocumentFetchError(`body ${buffer.byteLength} exceeds ${MAX_BYTES}`)
    }
    return buffer
  }
  throw new DocumentFetchError(`too many redirects (>${MAX_REDIRECTS})`)
}
