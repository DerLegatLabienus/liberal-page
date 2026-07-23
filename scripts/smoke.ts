import { spawn } from 'child_process'
import path from 'path'

const PORT = 3001
const BASE = `http://localhost:${PORT}`
const BOOT_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 300

// Shape-only checks — the DB may be freshly migrated and unseeded (as in CI), so we
// assert status + response shape, never non-empty data/row counts. Only routes that
// read from Postgres (never external network) belong here, so this stays fast and
// deterministic in both CI and local dev.
const CHECKS: { path: string; assert: (body: unknown) => string | null }[] = [
  {
    path: '/api/health',
    assert: (b) => (typeof b === 'object' && b !== null && (b as { status?: unknown }).status === 'ok' ? null : 'expected { status: "ok" }'),
  },
  {
    path: '/api/feature-flags',
    assert: (b) => (typeof b === 'object' && b !== null && !Array.isArray(b) ? null : 'expected an object keyed by flag name'),
  },
  {
    path: '/api/parliament/bill',
    assert: (b) => (Array.isArray(b) ? null : 'expected an array'),
  },
]

async function waitForBoot(): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch {
      // server not accepting connections yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Server did not become healthy within ${BOOT_TIMEOUT_MS}ms`)
}

async function runChecks(): Promise<string[]> {
  const failures: string[] = []
  for (const check of CHECKS) {
    try {
      const res = await fetch(`${BASE}${check.path}`)
      if (!res.ok) {
        failures.push(`${check.path}: HTTP ${res.status}`)
        continue
      }
      const body = await res.json()
      const err = check.assert(body)
      if (err) failures.push(`${check.path}: ${err}`)
      else console.log(`  ok  ${check.path}`)
    } catch (e) {
      failures.push(`${check.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return failures
}

// Spawn the local tsx binary directly rather than via `npx` — npx can leave the
// actual tsx/node process running as an ungoverned grandchild, so SIGTERM to the
// npx wrapper doesn't reliably stop the server (confirmed: the port and process
// stayed alive after `server.kill()` when routed through npx).
const TSX_BIN = path.resolve(process.cwd(), 'node_modules/.bin/tsx')

async function main() {
  console.log('Booting server for smoke test...')
  const server = spawn(TSX_BIN, ['server/index.ts'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let serverOutput = ''
  server.stdout.on('data', (d) => { serverOutput += d.toString() })
  server.stderr.on('data', (d) => { serverOutput += d.toString() })

  const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))

  const cleanup = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    server.kill('SIGTERM')
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3_000))
    await Promise.race([exited, timeout])
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL')
    await exited
  }

  try {
    await waitForBoot()
    console.log('Server healthy, running checks:')
    const failures = await runChecks()
    if (failures.length > 0) {
      console.error('\nSmoke test FAILED:')
      for (const f of failures) console.error(`  - ${f}`)
      process.exitCode = 1
    } else {
      console.log('\nSmoke test passed.')
    }
  } catch (e) {
    console.error('\nSmoke test FAILED:', e instanceof Error ? e.message : e)
    console.error('--- server output ---')
    console.error(serverOutput)
    process.exitCode = 1
  } finally {
    await cleanup()
  }
}

main()
