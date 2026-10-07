// CLI for the unattended loop: run ONE read query against its read-only database window.
// Usage: npm run -s loop:sql -- "select count(*) from loop_read.bills"
//
// The loop's cloud environment cannot open a normal Postgres connection (its outbound proxy
// carries web traffic only), so this talks to Neon's SQL-over-HTTPS endpoint instead. The
// connection string comes from LOOP_DATABASE_URL and is never printed, in any path.
//
// Exit codes: 0 = rows printed as JSON on stdout; 1 = the database or the network refused;
//             2 = the statement was refused here before being sent; 3 = no database access in
//             this run (LOOP_DATABASE_URL is not set), which is normal.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The loop looks at the shape and size of data; it does not dump tables. */
export const MAX_ROWS = 200
/** Upper bound on what one call prints, so a wide result cannot flood the loop's context. */
export const MAX_OUTPUT_CHARS = 100_000
/** How much of an error body is shown. */
export const MAX_ERROR_CHARS = 300
const TIMEOUT_MS = 30_000

/**
 * Neon's HTTPS query endpoint for a connection string: the same host with its first label
 * (the endpoint id, pooled or not) replaced by `api`. Carries no credentials.
 *
 * The connection string is sent to this host as a request header, so the host is checked
 * first: only a Postgres URL on `*.neon.tech` is accepted. A typo or a foreign value in the
 * variable must not send the secret to some unrelated `api.<domain>`. Error messages are
 * fixed text and never echo the value, which may hold a password.
 */
export function apiUrlFor(connectionString: string): string {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('LOOP_DATABASE_URL is not a valid connection string')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('LOOP_DATABASE_URL must be a postgres:// connection string')
  }
  const host = url.hostname.toLowerCase()
  const labels = host.split('.')
  if (!host.endsWith('.neon.tech') || labels.length < 4 || labels.some((l) => l === '')) {
    throw new Error('LOOP_DATABASE_URL must point at a Neon endpoint host (*.neon.tech)')
  }
  return `https://api.${labels.slice(1).join('.')}/sql`
}

export interface SqlRequest {
  url: string
  init: { method: 'POST'; redirect: 'error'; headers: Record<string, string>; body: string }
}

export function buildRequest(connectionString: string, statement: string): SqlRequest {
  return {
    url: apiUrlFor(connectionString),
    init: {
      method: 'POST',
      // Never follow a redirect: fetch would forward the connection-string header to the new host.
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': connectionString },
      body: JSON.stringify({ query: statement, params: [] }),
    },
  }
}

export type StatementCheck = { ok: true; statement: string } | { ok: false; reason: string }

// A leading parenthesis is allowed for `(select …) union (select …)`.
const READ_KEYWORD = /^\(*\s*(select|with|explain|show|values|table)\b/i

/**
 * A courtesy check, NOT a security boundary. What protects the data is the `loop_reader`
 * database role, which can read the `loop_read` views and nothing else and cannot write.
 * This only catches an obviously wrong call early, with a clearer message than the database
 * would give: it wants exactly one statement, starting with a read keyword.
 *
 * Known limits, all harmless because the role refuses them anyway: a read keyword can wrap a
 * write (`explain analyze insert …`, `with x as (delete …) select …`); backslash escapes in
 * `E'…'` strings are not understood, so `E'\'; …'` is scanned as if the string ended early;
 * and a comment placed between an opening parenthesis and the keyword is not skipped.
 */
export function checkStatement(sql: string): StatementCheck {
  const n = sql.length
  let i = 0
  let start = -1 // first significant character
  let end = -1 // the first top-level semicolon
  let extra = false // anything significant after that semicolon

  while (i < n) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? n : nl + 1
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 }
        else i++
      }
      continue
    }
    if (/\s/.test(c)) { i++; continue }

    // Stray semicolons after the first one (`select 1;;`) are not a second statement.
    if (end !== -1) {
      if (c === ';') { i++; continue }
      extra = true
      break
    }
    if (start === -1) start = i

    if (c === ';') { end = i; i++; continue }
    if (c === "'" || c === '"') {
      // Quoted string or identifier; a doubled quote is an escaped quote.
      i++
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) { i += 2; continue }
          i++
          break
        }
        i++
      }
      continue
    }
    // `$tag$` opens a dollar-quoted string, but not in the middle of an identifier (`a$b$c`).
    if (c === '$' && !(i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1]))) {
      const tag = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        i = close === -1 ? n : close + tag[0].length
        continue
      }
    }
    i++
  }

  const statement = start === -1 ? '' : sql.slice(start, end === -1 ? n : end).trim()
  if (statement === '') return { ok: false, reason: 'The statement is empty.' }
  if (extra) {
    return { ok: false, reason: 'Send one statement at a time: found more after the first semicolon.' }
  }
  if (!READ_KEYWORD.test(statement)) {
    return {
      ok: false,
      reason: 'Only read statements are sent (select, with, table, explain, show, values). This connection is read-only.',
    }
  }
  return { ok: true, statement }
}

export function capRows<T>(rows: T[], limit = MAX_ROWS): { rows: T[]; omitted: number } {
  if (rows.length <= limit) return { rows, omitted: 0 }
  return { rows: rows.slice(0, limit), omitted: rows.length - limit }
}

/** Every spelling of a percent-escaped value: as given, decoded, re-encoded, and both hex cases. */
function spellings(value: string): string[] {
  const out = new Set<string>([value])
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // not valid percent-encoding: keep the raw form only
  }
  for (const v of [decoded, encodeURIComponent(decoded)]) {
    out.add(v)
    out.add(v.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase()))
    out.add(v.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toLowerCase()))
  }
  out.add(value.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase()))
  out.add(value.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toLowerCase()))
  return [...out].filter((v) => v.length > 0)
}

/** Remove the connection string and its password from text that is about to be shown. */
export function scrubSecret(text: string, connectionString: string): string {
  const secrets = new Set<string>()
  const whole = connectionString.trim()
  if (connectionString) secrets.add(connectionString)
  if (whole) secrets.add(whole)
  // The password exactly as written, which URL parsing may have normalised away
  // (for example a raw `@` inside it): everything between `user:` and the last `@`.
  const written = /^[a-z][a-z0-9+.-]*:\/\/[^:/?#]*:([^/?#]*)@/i.exec(whole)
  if (written?.[1]) for (const v of spellings(written[1])) secrets.add(v)
  // A password given as a query parameter, exactly as written.
  const asParam = /[?&]password=([^&#\s]*)/i.exec(whole)
  if (asParam?.[1]) for (const v of spellings(asParam[1])) secrets.add(v)
  try {
    const url = new URL(whole)
    if (url.password) for (const v of spellings(url.password)) secrets.add(v)
    const param = url.searchParams.get('password')
    if (param) for (const v of spellings(param)) secrets.add(v)
  } catch {
    // not a URL: only the forms above can be recognised
  }
  let out = text
  // Longest first, so the whole connection string goes before the password inside it.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('***')
  }
  return out
}

/**
 * The message for a failed query. The body is scrubbed in full BEFORE it is shortened: cutting
 * first could slice through the connection string and leave a fragment the scrub no longer
 * recognises.
 */
export function formatFailure(status: number, text: string, connectionString: string): string {
  let message: string | null = null
  try {
    const body = JSON.parse(text) as { message?: unknown }
    if (body && typeof body.message === 'string') message = body.message
  } catch {
    message = null
  }
  const shown = scrubSecret(message ?? text, connectionString)
  const clipped = shown.length > MAX_ERROR_CHARS ? `${shown.slice(0, MAX_ERROR_CHARS)}…` : shown
  return message === null ? `HTTP ${status}: ${clipped}` : clipped
}

/** Why a request never got an answer, in fixed words: fetch's own messages can quote headers. */
export function describeFetchError(err: unknown): string {
  const e = err as { name?: unknown; cause?: { code?: unknown } } | null
  if (e?.name === 'TimeoutError') return `no answer within ${TIMEOUT_MS / 1000} seconds`
  const code = e?.cause?.code
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code)) return code
  return 'the request could not be sent'
}

// The only function that touches the network.
async function send(req: SqlRequest): Promise<{ status: number; text: string }> {
  const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  return { status: res.status, text: await res.text() }
}

async function main(): Promise<number> {
  const sql = process.argv.slice(2).join(' ')
  if (sql.trim() === '') {
    console.error('usage: npm run -s loop:sql -- "<one select statement>"')
    return 2
  }

  const connectionString = (process.env.LOOP_DATABASE_URL ?? '').trim()
  if (connectionString === '') {
    console.error('no database access in this run (LOOP_DATABASE_URL is not set). That is normal: carry on without it.')
    return 3
  }

  const check = checkStatement(sql)
  if (!check.ok) {
    console.error(`refused: ${check.reason}`)
    return 2
  }

  let req: SqlRequest
  try {
    req = buildRequest(connectionString, check.statement)
  } catch (err) {
    // apiUrlFor throws fixed text only.
    console.error(`error: ${err instanceof Error ? err.message : 'LOOP_DATABASE_URL could not be used'}`)
    return 1
  }

  let status: number
  let text: string
  try {
    ({ status, text } = await send(req))
  } catch (err) {
    console.error(`error: could not reach the database endpoint (${new URL(req.url).hostname}): ${describeFetchError(err)}`)
    return 1
  }

  let rowsIn: unknown[] | null = null
  try {
    const body = JSON.parse(text) as { rows?: unknown }
    if (status === 200 && body && Array.isArray(body.rows)) rowsIn = body.rows
  } catch {
    rowsIn = null
  }
  if (rowsIn === null) {
    console.error(`error: ${formatFailure(status, text, connectionString)}`)
    return 1
  }

  const { rows, omitted } = capRows(rowsIn)
  const json = JSON.stringify(rows)
  if (json.length > MAX_OUTPUT_CHARS) {
    console.error(
      `error: the result is too large to print (${json.length} characters, limit ${MAX_OUTPUT_CHARS}). ` +
      'Select fewer or shorter columns, or aggregate (count, group by, min/max, length()).',
    )
    return 1
  }
  process.stdout.write(`${json}\n`)
  console.error(`${rows.length} row(s)`)
  if (omitted > 0) {
    console.error(
      `${omitted} more row(s) not shown (limit ${MAX_ROWS}). Aggregate instead (count, group by, min/max): ` +
      'this command is for the shape and size of data, not for copying it.',
    )
  }
  return 0
}

// Run only as a script, so the tests can import the functions above without side effects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Set the exit code and let the process end by itself: process.exit() would cut off
  // output still queued on a pipe, leaving the caller with truncated JSON and a 0 status.
  main().then(
    (code) => { process.exitCode = code },
    () => {
      console.error('error: loop:sql failed unexpectedly')
      process.exitCode = 1
    },
  )
}
