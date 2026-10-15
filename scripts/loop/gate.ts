// CLI for the unattended loop: run the gate (the four checks every push needs) and print the
// result as one evidence block, so a PR carries gate results produced by a script.
// Usage: npm run -s loop:gate
//
// All four checks run even when one fails: `npm test`, `npx tsc --noEmit`, `npm run lint`,
// `npm run build`. stdout carries only the block (see evidence.ts); progress and the last lines
// of each failing check go to stderr. Each check runs through `sh -c '<command> 2>&1'`, so its
// stdout and stderr arrive as one stream in the order they were written.
//
// Exit codes: 0 = all four checks passed; 1 = at least one check failed;
//             2 = the gate could not run (e.g. git could not report the commit).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatEvidenceBlock, treeState, type Verdict } from './evidence.js'

export type CheckName = 'test' | 'tsc' | 'lint' | 'build'

export interface GateCheck {
  name: CheckName
  /** The command, run as given by `sh` and shown in the block. Fixed text, never user input. */
  display: string
}

export const GATE_CHECKS: readonly GateCheck[] = [
  { name: 'test', display: 'npm test' },
  { name: 'tsc', display: 'npx tsc --noEmit' },
  { name: 'lint', display: 'npm run lint' },
  { name: 'build', display: 'npm run build' },
]

/** How many lines of a failing check's output go to stderr. */
export const TAIL_LINES = 20
/** Upper bound on a telling line, so one check cannot flood the block. */
export const MAX_LINE_CHARS = 200
/** A check that runs longer than this is killed and reported as timed out. */
export const CHECK_TIMEOUT_MS = 20 * 60 * 1000
/**
 * Added to tsc's line while the root tsconfig.json has `"files": []` and no `include` (#20):
 * `npx tsc --noEmit` then checks nothing, and a bare "no errors" would mislead.
 */
export const TSC_NO_FILES_NOTE = 'root tsconfig checks no files — #20'

export interface CheckResult {
  name: CheckName
  display: string
  /** The process exit status; null when it could not start or was killed. */
  exitCode: number | null
  /** stdout and stderr together, in the order written. */
  output: string
  /** Set when the process could not be started (e.g. ENOENT). */
  error?: string
  /** Set when the process was killed by a signal. */
  signal?: string
  /** Set when the process was killed for running past CHECK_TIMEOUT_MS. */
  timedOut?: boolean
  /** Context appended to the telling line in brackets (e.g. TSC_NO_FILES_NOTE). */
  note?: string
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/**
 * One line, safe to put in the block: no ANSI codes, no line breaks (a blank line would end the
 * block for `findEvidenceBlock`), whitespace collapsed, length capped.
 */
export function flattenLine(text: string): string {
  const flat = stripAnsi(text).replace(/\s+/g, ' ').trim()
  return flat.length <= MAX_LINE_CHARS ? flat : `${flat.slice(0, MAX_LINE_CHARS - 1)}…`
}

/** npm's own lines (the `> script` header, the `npm error` trailer) never tell anything. */
function isNpmNoise(line: string): boolean {
  return /^> /.test(line) || /^npm (error|ERR!|warn|WARN|notice)(\s|$)/.test(line)
}

function meaningfulLines(output: string): string[] {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !isNpmNoise(l))
}

function lastOf(lines: string[], fallback: string): string {
  return lines.length > 0 ? lines[lines.length - 1] : fallback
}

const TS_ERROR = /\berror TS\d+/

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The one line of a check's output that says how it went: vitest's `Tests` summary, tsc's error
 * count, eslint's problem count, the build's `built in` line or its first error. Display only:
 * whether a check passed is decided by its exit code, never by this line.
 */
export function tellingLine(name: CheckName, output: string, exitCode: number | null): string {
  return flattenLine(pickTellingLine(name, output, exitCode))
}

function pickTellingLine(name: CheckName, output: string, exitCode: number | null): string {
  const lines = meaningfulLines(output)
  const passed = exitCode === 0
  switch (name) {
    case 'test': {
      // Matches `Tests  12 passed (12)`, not `Test Files ...` or `Failed Tests ...`.
      const summary = lines.filter((l) => /^Tests\s+/.test(l))
      if (summary.length === 0) return lastOf(lines, 'no output')
      // vitest exits 1 on unhandled errors even when every test passed; its `Errors` line says so.
      const errors = lines.filter((l) => /^Errors\s+\d+ errors?\b/.test(l))
      const tests = summary[summary.length - 1]
      return errors.length > 0 ? `${tests}; ${errors[errors.length - 1]}` : tests
    }
    case 'tsc': {
      // Counted from the lines, since piped tsc output may have no `Found N errors` summary.
      const errors = lines.filter((l) => TS_ERROR.test(l)).length
      if (errors > 0) return plural(errors, 'error')
      return passed ? 'no errors' : lastOf(lines, 'no output')
    }
    case 'lint': {
      const summary = lines.find((l) => /^✖ \d+ problems?\b/.test(l))
      if (summary) return summary
      return passed ? 'no problems' : lastOf(lines, 'no output')
    }
    case 'build': {
      if (passed) return lines.find((l) => /\bbuilt in\b/.test(l)) ?? lastOf(lines, 'no output')
      const tsErrors = lines.filter((l) => TS_ERROR.test(l))
      if (tsErrors.length > 0) return `${plural(tsErrors.length, 'error')}; first: ${tsErrors[0]}`
      // vite prints `error during build:`, then the cause, then a stack trace.
      const marker = lines.findIndex((l) => /^error during build:?$/.test(l))
      if (marker !== -1 && marker + 1 < lines.length) return lines[marker + 1]
      // Only a line that starts like an error: rollup warnings ("... cause errors when bundled")
      // and chunk names (`ErrorBoundary-abc.js`) merely contain the word.
      return lines.find((l) => /^(error|Error|\[vite\])/.test(l)) ?? lastOf(lines, 'no output')
    }
  }
}

/** The check's line in the block, e.g. ``- lint (`npm run lint`): FAIL (exit 1) — ✖ 1 problem``. */
export function checkLine(result: CheckResult): string {
  const label = `- ${result.name} (\`${result.display}\`)`
  if (result.timedOut) return `${label}: FAIL — timed out after ${CHECK_TIMEOUT_MS / 60_000} min`
  if (result.error) return `${label}: FAIL — ${flattenLine(`could not run: ${result.error}`)}`
  if (result.signal) return `${label}: FAIL — killed by ${result.signal}`
  const status = result.exitCode === 0
    ? 'pass'
    : result.exitCode === null ? 'FAIL' : `FAIL (exit ${result.exitCode})`
  const telling = tellingLine(result.name, result.output, result.exitCode)
  return `${label}: ${status} — ${result.note ? `${telling} (${flattenLine(result.note)})` : telling}`
}

/** Pass only when there were checks and every one exited 0. */
export function gateVerdict(results: CheckResult[]): Verdict {
  return results.length > 0 && results.every((r) => r.exitCode === 0) ? 'pass' : 'fail'
}

export function buildGateBlock(results: CheckResult[], tree: { commit: string; dirty: boolean }): string {
  return formatEvidenceBlock({
    command: 'gate',
    verdict: gateVerdict(results),
    commit: tree.commit,
    dirty: tree.dirty,
    lines: results.map(checkLine),
  })
}

/** The last `n` lines of a check's output, for stderr, without npm's own lines. */
export function failureTail(output: string, n: number = TAIL_LINES): string {
  const lines = stripAnsi(output).replace(/\r/g, '').split('\n').filter((l) => !isNpmNoise(l.trim()))
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.slice(-n).join('\n')
}

/**
 * TSC_NO_FILES_NOTE when the root tsconfig.json (its text, or null if unreadable) has
 * `"files": []` and no `include`, so `npx tsc --noEmit` checks nothing; otherwise undefined.
 */
export function tscNote(tsconfigText: string | null): string | undefined {
  if (tsconfigText === null) return undefined
  let config: unknown
  try {
    config = JSON.parse(tsconfigText)
  } catch {
    return undefined
  }
  if (typeof config !== 'object' || config === null) return undefined
  const { files, include } = config as { files?: unknown; include?: unknown }
  return Array.isArray(files) && files.length === 0 && include === undefined ? TSC_NO_FILES_NOTE : undefined
}

/** Large enough that a noisy test run is never cut off (the default ~1 MiB kills the child). */
const MAX_BUFFER = 64 * 1024 * 1024

function runCheck(check: GateCheck): CheckResult {
  // One merged pipe keeps stdout and stderr in order. `exec` makes the command the shell's own
  // process, so the timeout's SIGTERM reaches it rather than only the shell.
  const res = spawnSync('/bin/sh', ['-c', `exec ${check.display} 2>&1`], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: CHECK_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  return {
    name: check.name,
    display: check.display,
    exitCode: res.status,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    ...(res.error ? { error: res.error.message } : {}),
    ...(res.signal ? { signal: res.signal } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  }
}

function readRootTsconfig(): string | null {
  try {
    return fs.readFileSync('tsconfig.json', 'utf8')
  } catch {
    return null
  }
}

export interface GateDeps {
  run: (check: GateCheck) => CheckResult
  tree: () => { commit: string; dirty: boolean }
  /** The root tsconfig.json's text, or null; read at run time for the tsc note. */
  readTsconfig: () => string | null
  stderr: (text: string) => void
  stdout: (text: string) => void
}

const defaultDeps: GateDeps = {
  run: runCheck,
  tree: () => treeState(),
  readTsconfig: readRootTsconfig,
  stderr: (text) => console.error(text),
  stdout: (text) => { process.stdout.write(text) },
}

export function main(deps: GateDeps = defaultDeps): number {
  const { run, tree, readTsconfig, stderr, stdout } = deps
  // Taken before the checks run, so the block describes the tree the gate ran on.
  let state: { commit: string; dirty: boolean }
  try {
    state = tree()
  } catch {
    stderr('error: loop:gate could not read the commit and tree state from git')
    return 2
  }

  const results: CheckResult[] = []
  for (const check of GATE_CHECKS) {
    stderr(`loop:gate: running ${check.display} ...`)
    const result = run(check)
    if (check.name === 'tsc') {
      const note = tscNote(readTsconfig())
      if (note) result.note = note
    }
    results.push(result)
    if (result.exitCode !== 0) {
      const why = result.timedOut
        ? `timed out after ${CHECK_TIMEOUT_MS / 60_000} min`
        : result.error ?? (result.signal ? `killed by ${result.signal}` : `exit ${result.exitCode}`)
      stderr(`--- ${check.name} failed (${why}): last ${TAIL_LINES} lines ---`)
      const tail = failureTail(result.output)
      if (tail !== '') stderr(tail)
      stderr(`--- end of ${check.name} ---`)
    }
  }

  stdout(`${buildGateBlock(results, state)}\n`)
  return gateVerdict(results) === 'pass' ? 0 : 1
}

// Run only as a script, so the tests can import the functions above without side effects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Set the exit code and let the process end by itself: process.exit() could cut off output
  // still queued on a pipe.
  try {
    process.exitCode = main()
  } catch {
    console.error('error: loop:gate failed unexpectedly')
    process.exitCode = 2
  }
}
