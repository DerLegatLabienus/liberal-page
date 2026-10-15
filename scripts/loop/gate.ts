// CLI for the unattended loop: run the gate (the four checks every push needs) and print the
// result as one evidence block, so a PR carries gate results produced by a script.
// Usage: npm run -s loop:gate
//
// All four checks run even when one fails: `npm test`, `npx tsc --noEmit`, `npm run lint`,
// `npm run build`. stdout carries only the block (see evidence.ts); progress and the last lines
// of each failing check go to stderr.
//
// Exit codes: 0 = all four checks passed; 1 = at least one check failed;
//             2 = the gate could not run (e.g. git could not report the commit).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatEvidenceBlock, treeState, type Verdict } from './evidence.js'

export type CheckName = 'test' | 'tsc' | 'lint' | 'build'

export interface GateCheck {
  name: CheckName
  command: string
  args: string[]
  /** The command as a person would type it, shown in the block. */
  display: string
}

export const GATE_CHECKS: readonly GateCheck[] = [
  { name: 'test', command: 'npm', args: ['test'], display: 'npm test' },
  { name: 'tsc', command: 'npx', args: ['tsc', '--noEmit'], display: 'npx tsc --noEmit' },
  { name: 'lint', command: 'npm', args: ['run', 'lint'], display: 'npm run lint' },
  { name: 'build', command: 'npm', args: ['run', 'build'], display: 'npm run build' },
]

/** How many lines of a failing check's output go to stderr. */
export const TAIL_LINES = 20
/** Upper bound on a telling line, so one check cannot flood the block. */
export const MAX_LINE_CHARS = 200

export interface CheckResult {
  name: CheckName
  display: string
  /** The process exit status; null when it could not start or was killed. */
  exitCode: number | null
  /** stdout and stderr together. */
  output: string
  /** Set when the process could not be started (e.g. ENOENT). */
  error?: string
  /** Set when the process was killed by a signal. */
  signal?: string
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
      return summary.length > 0 ? summary[summary.length - 1] : lastOf(lines, 'no output')
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
      return lines.find((l) => /error/i.test(l)) ?? lastOf(lines, 'no output')
    }
  }
}

/** The check's line in the block, e.g. ``- lint (`npm run lint`): FAIL (exit 1) — ✖ 1 problem``. */
export function checkLine(result: CheckResult): string {
  const label = `- ${result.name} (\`${result.display}\`)`
  if (result.error) return `${label}: FAIL — ${flattenLine(`could not run: ${result.error}`)}`
  if (result.signal) return `${label}: FAIL — killed by ${result.signal}`
  const status = result.exitCode === 0
    ? 'pass'
    : result.exitCode === null ? 'FAIL' : `FAIL (exit ${result.exitCode})`
  return `${label}: ${status} — ${tellingLine(result.name, result.output, result.exitCode)}`
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

/** The last `n` lines of a check's output, for stderr. */
export function failureTail(output: string, n: number = TAIL_LINES): string {
  const lines = stripAnsi(output).replace(/\r/g, '').split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.slice(-n).join('\n')
}

/** Large enough that a noisy test run is never cut off (the default ~1 MiB kills the child). */
const MAX_BUFFER = 64 * 1024 * 1024
/** A check that runs longer than this is killed and reported as failed. */
const CHECK_TIMEOUT_MS = 20 * 60 * 1000

function runCheck(check: GateCheck): CheckResult {
  const res = spawnSync(check.command, check.args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: CHECK_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  return {
    name: check.name,
    display: check.display,
    exitCode: res.status,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    ...(res.error ? { error: res.error.message } : {}),
    ...(res.signal ? { signal: res.signal } : {}),
  }
}

function main(): number {
  // Taken before the checks run, so the block describes the tree the gate ran on.
  let tree: { commit: string; dirty: boolean }
  try {
    tree = treeState()
  } catch {
    console.error('error: loop:gate could not read the commit and tree state from git')
    return 2
  }

  const results: CheckResult[] = []
  for (const check of GATE_CHECKS) {
    console.error(`loop:gate: running ${check.display} ...`)
    const result = runCheck(check)
    results.push(result)
    if (result.exitCode !== 0) {
      const why = result.error ?? (result.signal ? `killed by ${result.signal}` : `exit ${result.exitCode}`)
      console.error(`--- ${check.name} failed (${why}): last ${TAIL_LINES} lines ---`)
      const tail = failureTail(result.output)
      if (tail !== '') console.error(tail)
      console.error(`--- end of ${check.name} ---`)
    }
  }

  process.stdout.write(`${buildGateBlock(results, tree)}\n`)
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
