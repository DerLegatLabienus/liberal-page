// CLI for the unattended loop: show that the branch's tests mean something.
// Usage: npm run -s loop:proof [-- --base <ref>] [-- --refactor]
//
// Compares HEAD with its base (the merge base with origin/master or master; `--base` overrides).
// - Docs-only branch (every changed path is *.md or under docs/): exempt, passes.
// - Fix or feature: the test files the branch adds or changes are run on master's source and on
//   the branch. At least one must fail on master's source and all must pass on the branch.
// - Refactor (branch name starts with `refactor/`, or `--refactor`): changed test files may
//   differ only in import statements and mock paths, and the full suite must be green on master's
//   source and on the branch.
// - Any other branch that adds or changes no test file: "no tests", fails.
//
// Strict rules (each fails closed):
// - A test file passes only when vitest marks the file itself passed (a throwing beforeAll or
//   afterAll fails the file though every test in it passed) with no failed and at least one
//   passed test. A file counts as failing on master's source when vitest marks it failed.
// - A test file that cannot load on master's source counts as failing there only when the file is
//   new on the branch (its module does not exist yet). An existing test file that cannot load on
//   master proves nothing.
// - vitest must exit 0 on the branch, and on both sides of a refactor, so an unhandled error
//   outside any test fails the proof.
// - Refactor: new tests added to an existing test file count as changed logic (only a brand-new
//   test file is allowed), so a refactor cannot slip in tests never run against master's source.
//   Imported names are compared too, as a set: each name with its kind (named, default,
//   namespace, type-only) and local alias, plus side-effect imports, so moving a name to another
//   import statement is no change but renaming, aliasing or adding one is. Only quoted module
//   paths (import, export-from, import(), vi.mock, vi.doMock, vi.importActual and friends) and
//   how names are grouped into import statements are ignored. Any change to test infrastructure fails: non-test files under tests/,
//   vitest.config.ts, src/test-setup.ts, src/__mocks__/** and any *.snap.
// - An explicit `--base` is reduced to its merge base with HEAD (see resolveBase), so the checkout,
//   the file reads and the diff all use the branch point.
//
// Both sides run in temporary `git worktree` checkouts outside the repo: master's source (the
// base commit, with the branch's committed tests/ files copied over) and the branch (HEAD as
// committed). So uncommitted or gitignored files in the live tree (.env, local caches) cannot
// affect the verdict, and the live working tree is never written to. Each checkout has
// node_modules linked in and is removed afterwards, also on SIGINT and SIGTERM. Each vitest run
// gets its own TMPDIR, so the suite's pglite snapshot (written to os.tmpdir()) cannot clash with
// another test run, CI=1, so missing snapshots fail instead of being written, and --no-cache, so
// vitest's results cache is not written into the live node_modules through the symlink.
//
// Prints one `<!-- loop:proof -->` evidence block.
// Exit codes: 0 = proved or exempt; 1 = not proved, no tests, or the proof could not run.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedPaths, formatEvidenceBlock, resolveBase, treeState } from './evidence.js'

// ---------------------------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------------------------

export type ProofKind = 'docs-only' | 'empty' | 'no-tests' | 'fix' | 'refactor'

export function isDocsPath(p: string): boolean {
  return p.endsWith('.md') || p.startsWith('docs/')
}

export function isTestFile(p: string): boolean {
  return /^tests\/.+\.test\.tsx?$/.test(p)
}

/** The branch's committed tests/ files (tests and support files) to copy into master's source. */
export function overlayPaths(paths: string[], deleted: string[]): string[] {
  const gone = new Set(deleted)
  return paths.filter((p) => p.startsWith('tests/') && !gone.has(p))
}

/** Test infrastructure a refactor may not change, among the branch's changed paths. */
export function refactorGuardedChanges(paths: string[]): string[] {
  return paths.filter((p) =>
    (p.startsWith('tests/') && !isTestFile(p)) ||
    p === 'vitest.config.ts' ||
    p === 'src/test-setup.ts' ||
    p.startsWith('src/__mocks__/') ||
    p.endsWith('.snap'))
}

export interface ClassifyInput {
  /** Every path the branch changed since its base. */
  paths: string[]
  /** Those of `paths` that no longer exist at HEAD. */
  deleted: string[]
  branch: string
  refactor: boolean
}

export function classifyBranch(input: ClassifyInput): { kind: ProofKind; testFiles: string[] } {
  const { paths, branch, refactor } = input
  if (paths.length === 0) return { kind: 'empty', testFiles: [] }
  if (paths.every(isDocsPath)) return { kind: 'docs-only', testFiles: [] }
  const gone = new Set(input.deleted)
  const testFiles = paths.filter((p) => isTestFile(p) && !gone.has(p))
  if (refactor || branch.startsWith('refactor/')) return { kind: 'refactor', testFiles }
  if (testFiles.length === 0) return { kind: 'no-tests', testFiles }
  return { kind: 'fix', testFiles }
}

export interface Args {
  base?: string
  refactor: boolean
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { refactor: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--refactor') args.refactor = true
    else if (a.startsWith('--base=')) args.base = a.slice('--base='.length)
    else if (a === '--base') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error('--base needs a ref')
      args.base = v
    } else throw new Error(`unknown argument: ${a}`)
  }
  if (args.base === '') throw new Error('--base needs a ref')
  return args
}

/** New path → old path, from `git diff --name-status -M` output. */
export function parseRenames(nameStatus: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of nameStatus.split('\n')) {
    const [status, from, to] = line.split('\t')
    if (status?.startsWith('R') && from && to) map.set(to, from)
  }
  return map
}

/** The subset of vitest's JSON reporter output this script reads. */
export interface VitestJson {
  success: boolean
  testResults: { name: string; status: string; message: string; assertionResults: { status: string }[] }[]
}

export type FileResult =
  /** `status` is vitest's verdict on the file itself; `message` is its error's first line. */
  | { state: 'ran'; status: string; passed: number; failed: number; skipped: number; message?: string }
  | { state: 'load-error'; message: string }
  | { state: 'missing' }

function countAssertions(results: { status: string }[]) {
  let passed = 0, failed = 0, skipped = 0
  for (const r of results) {
    if (r.status === 'passed') passed++
    else if (r.status === 'failed') failed++
    else skipped++
  }
  return { passed, failed, skipped }
}

/** One result per file, keyed by repo-relative path. `root` is the directory vitest ran in. */
export function summariseRun(json: VitestJson | null, root: string, files: string[]): Record<string, FileResult> {
  const byPath = new Map<string, VitestJson['testResults'][number]>()
  for (const r of json?.testResults ?? []) byPath.set(path.relative(root, r.name).split(path.sep).join('/'), r)
  const out: Record<string, FileResult> = {}
  for (const f of files) {
    const r = byPath.get(f)
    if (!r) out[f] = { state: 'missing' }
    else if (r.status === 'failed' && r.assertionResults.length === 0) {
      out[f] = { state: 'load-error', message: (r.message || 'no message').split('\n')[0].trim() }
    } else {
      const message = r.status === 'failed' && r.message ? r.message.split('\n')[0].trim() : undefined
      out[f] = { state: 'ran', status: r.status, ...countAssertions(r.assertionResults), ...(message ? { message } : {}) }
    }
  }
  return out
}

function formatCounts(c: { passed: number; failed: number; skipped: number }): string {
  const parts = [
    c.failed && `${c.failed} failed`,
    c.passed && `${c.passed} passed`,
    c.skipped && `${c.skipped} skipped`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'no tests ran'
}

export function formatFileResult(r: FileResult): string {
  if (r.state === 'missing') return 'not run'
  if (r.state === 'load-error') return `failed to load (${r.message})`
  if (r.status === 'failed' && r.failed === 0) return `${formatCounts(r)}, file failed (${r.message ?? 'no message'})`
  return formatCounts(r)
}

export interface ProofVerdict {
  pass: boolean
  reason: string
}

const passesCleanly = (r: FileResult) => r.state === 'ran' && r.status === 'passed' && r.failed === 0 && r.passed > 0

export interface FixRunFacts {
  /** Test files that do not exist at the base commit. */
  newFiles: string[]
  /** vitest's exit code on the branch; null when it was killed or never started. */
  branchExitCode: number | null
}

export function fixVerdict(
  files: string[], master: Record<string, FileResult>, branch: Record<string, FileResult>, facts: FixRunFacts,
): ProofVerdict {
  const missing: FileResult = { state: 'missing' }
  for (const f of files) {
    const b = branch[f] ?? missing
    if (!passesCleanly(b)) {
      return { pass: false, reason: `not proved: \`${f}\` does not pass on the branch (${formatFileResult(b)})` }
    }
  }
  if (facts.branchExitCode !== 0) {
    return {
      pass: false,
      reason: `not proved: vitest exited with code ${facts.branchExitCode ?? 'none'} on the branch (unhandled errors?)`,
    }
  }
  const isNew = new Set(facts.newFiles)
  const failsOn = (f: string, r: FileResult) =>
    (r.state === 'ran' && (r.status === 'failed' || r.failed > 0)) || (r.state === 'load-error' && isNew.has(f))
  for (const f of files) {
    if ((master[f] ?? missing).state === 'missing') {
      return { pass: false, reason: `not proved: \`${f}\` did not run on master's source` }
    }
  }
  const failing = files.filter((f) => failsOn(f, master[f]))
  if (failing.length === 0) {
    return {
      pass: false,
      reason: "not proved: every test passes on master's source too, so the tests do not show the change",
    }
  }
  return {
    pass: true,
    reason: `proved: ${failing.length} of ${files.length} test files fail on master's source; all pass on the branch`,
  }
}

/** An import/export clause on one line with fixed spacing: `{\n  a,\n  b,\n}` becomes `{ a, b }`. */
function tidyClause(clause: string): string {
  return clause.replace(/\s+/g, ' ').replace(/,\s*\}/g, ' }').replace(/\{\s*/g, '{ ').replace(/\s*\}/g, ' }').trim()
}

/**
 * A test file's logic with module paths taken out. Every quoted module path (import and
 * export-from statements, side-effect imports, `import('...')`, `vi.mock` / `vi.doMock` /
 * `vi.importActual` and friends) becomes a placeholder; import and export clauses are joined
 * onto one line with fixed spacing; blank lines are dropped. Imported names and mock factory
 * bodies are kept: they are test logic.
 */
export function normaliseTestText(text: string): string {
  return text
    .replace(
      /^[ \t]*(import|export)(\s[^;'"]*?\bfrom)\s*(['"])[^'"\n]*\3[ \t]*;?/gm,
      (_m, kw: string, clause: string) => `${kw} ${tidyClause(clause)} <path>`,
    )
    .replace(/^[ \t]*import\s*(['"])[^'"\n]*\1[ \t]*;?/gm, 'import <path>')
    // vi.* first: its optional type argument may itself hold an `import('...')`.
    .replace(
      /\b(vi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock))\s*(<[^>]*>)?\s*\(\s*(['"`])[^'"`\n]*\3/g,
      '$1$2(<path>',
    )
    .replace(/\bimport\(\s*(['"`])[^'"`\n]*\1\s*\)/g, 'import(<path>)')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n')
}

export interface RefactorTestEntry {
  /** Path at HEAD (or the deleted path). */
  path: string
  /** Path at base when the file was renamed. */
  oldPath?: string
  /** Text at base, null when the file is new on the branch. */
  baseText: string | null
  /** Text at HEAD, null when the branch deleted the file. */
  headText: string | null
}

function clip(s: string, max = 80): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const SIDE_EFFECT = 'side-effect import'

/**
 * Splits normalised test text into its import bindings and the rest. Each binding is one name
 * as the test sees it (`a`, `b as a`, `default as a`, `* as a`, `type a`, `export d`), so a name
 * that moves to another import statement is the same binding; the bindings come back sorted.
 */
function splitImports(norm: string): { bindings: string[]; body: string[] } {
  const bindings: string[] = []
  const body: string[] = []
  for (const line of norm.split('\n')) {
    if (line === 'import <path>') { bindings.push(SIDE_EFFECT); continue }
    const m = /^(import|export) (.*) from <path>$/.exec(line)
    if (!m) { body.push(line); continue }
    const prefix = m[1] === 'export' ? 'export ' : ''
    let clause = m[2]
    let allType = false
    if (clause.startsWith('type ')) { allType = true; clause = clause.slice(5) }
    const braced = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
    const named = braced.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const type = allType || s.startsWith('type ')
      const [imported, local] = s.replace(/^type /, '').split(/\s+as\s+/)
      return `${type ? 'type ' : ''}${imported}${local && local !== imported ? ` as ${local}` : ''}`
    })
    const other = clause.replace(/\{[^}]*\}/, '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const t = allType ? 'type ' : ''
      if (s.startsWith('* as ')) return `${t}* as ${s.slice(5).trim()}`
      return s === '*' ? '*' : `${t}default as ${s}`
    })
    for (const b of [...other, ...named]) bindings.push(prefix + b)
  }
  return { bindings: bindings.sort(), body }
}

/** `a` minus `b`, counting repeats: a binding imported twice must be dropped twice. */
function minus(a: string[], b: string[]): string[] {
  const left = [...b]
  return a.filter((x) => {
    const i = left.indexOf(x)
    if (i === -1) return true
    left.splice(i, 1)
    return false
  })
}

/** One problem line per test file whose logic changed or that was deleted; empty = fine. */
export function compareRefactorTests(entries: RefactorTestEntry[]): string[] {
  const problems: string[] = []
  for (const e of entries) {
    if (e.baseText === null) continue // a new test file: adding tests changes no existing logic
    if (e.headText === null) {
      problems.push(`\`${e.path}\`: test file deleted`)
      continue
    }
    const base = splitImports(normaliseTestText(e.baseText))
    const head = splitImports(normaliseTestText(e.headText))
    const removed = minus(base.bindings, head.bindings)
    const added = minus(head.bindings, base.bindings)
    if (removed.length || added.length) {
      const show = (b: string) => (b === SIDE_EFFECT ? b : `\`${b}\``)
      const parts = [
        ...(removed.length ? [`removed ${removed.map(show).join(', ')}`] : []),
        ...(added.length ? [`added ${added.map(show).join(', ')}`] : []),
      ]
      problems.push(`\`${e.path}\`: imported names changed: ${parts.join(', ')}`)
      continue
    }
    const a = base.body
    const b = head.body
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        const was = a[i] === undefined ? '(nothing)' : `\`${clip(a[i])}\``
        const now = b[i] === undefined ? '(nothing)' : `\`${clip(b[i])}\``
        problems.push(`\`${e.path}\`: test logic changed: ${was} became ${now}`)
        break
      }
    }
  }
  return problems
}

export type SuiteResult =
  | { state: 'ran'; passed: number; failed: number; skipped: number; failedFiles: number; exitCode: number | null }
  | { state: 'missing' }

export function summariseSuite(json: VitestJson | null, exitCode: number | null): SuiteResult {
  if (!json) return { state: 'missing' }
  const all = countAssertions(json.testResults.flatMap((r) => r.assertionResults))
  return { state: 'ran', ...all, failedFiles: json.testResults.filter((r) => r.status === 'failed').length, exitCode }
}

function formatSuite(s: SuiteResult): string {
  if (s.state === 'missing') return 'not run'
  let out = formatCounts(s)
  if (s.failedFiles > 0) out += ` (${s.failedFiles} file(s) failed)`
  if (s.exitCode !== 0) out += ` (vitest exit ${s.exitCode ?? 'none'})`
  return out
}

const isGreen = (s: SuiteResult | null) =>
  !!s && s.state === 'ran' && s.failed === 0 && s.failedFiles === 0 && s.passed > 0 && s.exitCode === 0

export function refactorVerdict(
  problems: string[], master: SuiteResult | null, branch: SuiteResult | null,
): ProofVerdict {
  if (problems.length > 0) {
    const n = problems.length
    return { pass: false, reason: `not proved: ${n} test change${n === 1 ? '' : 's'} a refactor may not make` }
  }
  if (!isGreen(master)) return { pass: false, reason: "not proved: the suite is not green on master's source" }
  if (!isGreen(branch)) return { pass: false, reason: 'not proved: the suite is not green on the branch' }
  return { pass: true, reason: "proved: test logic unchanged; the suite is green on master's source and on the branch" }
}

export interface ProofReport {
  kind: ProofKind
  /** Short SHA of the base commit. */
  base: string
  files: { path: string; master?: FileResult; branch?: FileResult; note?: string }[]
  problems?: string[]
  suites?: { master: SuiteResult; branch: SuiteResult }
  reason: string
}

/** The command's own lines of the evidence block. */
export function proofLines(r: ProofReport): string[] {
  const lines = [`- kind: ${r.kind}`, `- base: \`${r.base}\``]
  for (const f of r.files) {
    const runs: string[] = []
    if (f.master) runs.push(`master: ${formatFileResult(f.master)}`)
    if (f.branch) runs.push(`branch: ${formatFileResult(f.branch)}`)
    if (f.note) runs.push(f.note)
    lines.push(runs.length ? `- \`${f.path}\`: ${runs.join('; ')}` : `- \`${f.path}\``)
  }
  for (const p of r.problems ?? []) lines.push(`- ${p}`)
  if (r.suites) lines.push(`- suite: master: ${formatSuite(r.suites.master)}; branch: ${formatSuite(r.suites.branch)}`)
  lines.push(`- verdict: ${r.reason}`)
  return lines
}

// ---------------------------------------------------------------------------------------------
// Git and process work
// ---------------------------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A file's committed content at `ref`, or null when it does not exist there. */
function showAt(ref: string, file: string, cwd: string): Buffer | null {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 })
  } catch {
    return null
  }
}

export interface VitestRun {
  json: VitestJson | null
  /** null when vitest was killed by a signal or never started. */
  exitCode: number | null
  stderr: string
}

/** Everything the run creates lives under one temp directory, removed by `cleanup`. */
export class Scratch {
  readonly dir: string
  private readonly worktrees: string[] = []
  private child: ChildProcess | null = null
  private cleaned = false

  constructor(private readonly repo: string) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-proof-'))
  }

  /**
   * A clean detached checkout of `ref` outside the repo, with the repo's node_modules linked in.
   * `overlay` files are then written in from their committed content at `overlay.ref`.
   * Returns the checkout's real path (vitest reports real paths).
   */
  checkout(ref: string, label: string, overlay?: { ref: string; paths: string[] }): string {
    const dir = path.join(this.dir, label)
    this.worktrees.push(dir)
    git(['worktree', 'add', '--detach', dir, ref], this.repo)
    fs.symlinkSync(path.join(this.repo, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
    for (const p of overlay?.paths ?? []) {
      const content = showAt(overlay!.ref, p, this.repo)
      if (content === null) continue
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
      fs.writeFileSync(path.join(dir, p), content)
    }
    return fs.realpathSync(dir)
  }

  /** Runs vitest with the JSON reporter in `cwd`; resolves to the parsed report or null. */
  vitest(cwd: string, label: string, files: string[]): Promise<VitestRun> {
    const tmp = fs.mkdtempSync(path.join(this.dir, `tmp-${label}-`))
    const out = path.join(this.dir, `${label}.json`)
    const bin = path.join(cwd, 'node_modules', '.bin', 'vitest')
    return new Promise((resolve) => {
      let stderr = ''
      const child = spawn(bin, ['run', '--no-cache', '--reporter=json', `--outputFile=${out}`, ...files], {
        cwd, env: { ...process.env, TMPDIR: tmp, CI: process.env.CI ?? '1' }, stdio: ['ignore', 'ignore', 'pipe'],
      })
      this.child = child
      child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000) })
      let settled = false
      const done = (exitCode: number | null) => {
        if (settled) return
        settled = true
        this.child = null
        let json: VitestJson | null = null
        try {
          json = JSON.parse(fs.readFileSync(out, 'utf8')) as VitestJson
        } catch {
          json = null
        }
        resolve({ json, exitCode, stderr })
      }
      child.on('error', (e) => { stderr += String(e); done(null) })
      child.on('close', (code) => done(code))
    })
  }

  /** Idempotent: safe from `finally` and from a signal handler. */
  cleanup(): void {
    if (this.cleaned) return
    this.cleaned = true
    this.child?.kill('SIGTERM')
    for (const wt of this.worktrees) {
      // Drop the link first, so nothing below can ever walk into the real node_modules.
      try { fs.unlinkSync(path.join(wt, 'node_modules')) } catch { /* not there */ }
      try { git(['worktree', 'remove', '--force', wt], this.repo) } catch { /* removed below */ }
    }
    if (this.worktrees.length > 0) {
      try { git(['worktree', 'prune'], this.repo) } catch { /* best effort */ }
    }
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

/** The SIGINT/SIGTERM handler: the same cleanup as the `finally`, then exit 130 or 143. */
export function makeSignalHandler(
  scratch: { cleanup(): void }, exit: (code: number) => void, log: (message: string) => void,
): (signal: NodeJS.Signals) => void {
  return (signal) => {
    scratch.cleanup()
    log(`loop:proof interrupted by ${signal}; temporary worktrees removed`)
    exit(signal === 'SIGINT' ? 130 : 143)
  }
}

function lastLines(text: string, n = 5): string[] {
  return text.trim().split('\n').slice(-n).map((l) => `  > ${clip(l, 160)}`)
}

async function prove(repo: string, args: Args, scratch: Scratch): Promise<{ verdict: ProofVerdict; lines: string[] }> {
  const base = resolveBase(args.base, repo)
  const baseShort = git(['rev-parse', '--short', base], repo)
  const paths = changedPaths(base, repo)
  // Pinned once, so both checkouts and every `git show` see the same commit.
  const head = git(['rev-parse', 'HEAD'], repo)
  const deleted = paths.filter((p) => showAt(head, p, repo) === null)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)
  const { kind, testFiles } = classifyBranch({ paths, deleted, branch, refactor: args.refactor })

  const finish = (report: Omit<ProofReport, 'kind' | 'base'>, pass: boolean, extra: string[] = []) => ({
    verdict: { pass, reason: report.reason },
    lines: [...proofLines({ kind, base: baseShort, ...report }), ...extra],
  })

  if (kind === 'empty') return finish({ files: [], reason: 'not proved: the branch changes nothing since its base' }, false)
  if (kind === 'docs-only') return finish({ files: [], reason: 'exempt: every changed path is documentation' }, true)
  if (kind === 'no-tests') return finish({ files: [], reason: 'no tests: the branch adds or changes no test file' }, false)

  if (kind === 'refactor') {
    const renames = parseRenames(git(['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', `${base}...HEAD`], repo))
    const entries: RefactorTestEntry[] = paths.filter(isTestFile).map((p) => {
      const oldPath = renames.get(p)
      return {
        path: p, oldPath,
        baseText: showAt(base, oldPath ?? p, repo)?.toString('utf8') ?? null,
        headText: showAt(head, p, repo)?.toString('utf8') ?? null,
      }
    })
    const guarded = refactorGuardedChanges(paths)
    const logic = compareRefactorTests(entries)
    const problems = [
      ...(guarded.length ? [`test setup changed: ${guarded.map((p) => `\`${p}\``).join(', ')}`] : []),
      ...logic,
    ]
    const flagged = new Set(logic.map((p) => p.slice(1, p.indexOf('`', 1))))
    const files = entries
      .filter((e) => e.headText !== null && e.baseText !== null && !flagged.has(e.path))
      .map((e) => ({ path: e.path, note: 'test logic unchanged' }))
    if (problems.length > 0) {
      return finish({ files, problems, reason: refactorVerdict(problems, null, null).reason }, false)
    }
    // Master's own suite on master's source: the branch's tests may import from moved modules,
    // and the text check above already showed their logic is master's.
    const masterRun = await scratch.vitest(scratch.checkout(base, 'master'), 'master', [])
    const branchRun = await scratch.vitest(scratch.checkout(head, 'branch'), 'branch', [])
    const suites = {
      master: summariseSuite(masterRun.json, masterRun.exitCode),
      branch: summariseSuite(branchRun.json, branchRun.exitCode),
    }
    const v = refactorVerdict(problems, suites.master, suites.branch)
    const extra = [
      ...(masterRun.json ? [] : ['- master run produced no report:', ...lastLines(masterRun.stderr)]),
      ...(branchRun.json ? [] : ['- branch run produced no report:', ...lastLines(branchRun.stderr)]),
    ]
    return finish({ files, suites, reason: v.reason }, v.pass, extra)
  }

  // Fix or feature. The branch's committed tests/ files (test files and any support files they
  // need) go into master's source; tests new on the branch do not exist there otherwise.
  const masterDir = scratch.checkout(base, 'master', { ref: head, paths: overlayPaths(paths, deleted) })
  const masterRun = await scratch.vitest(masterDir, 'master', testFiles)
  const branchDir = scratch.checkout(head, 'branch')
  const branchRun = await scratch.vitest(branchDir, 'branch', testFiles)
  const master = summariseRun(masterRun.json, masterDir, testFiles)
  const branchRes = summariseRun(branchRun.json, branchDir, testFiles)
  const newFiles = testFiles.filter((p) => showAt(base, p, repo) === null)
  const v = fixVerdict(testFiles, master, branchRes, { newFiles, branchExitCode: branchRun.exitCode })
  const extra = [
    ...(masterRun.json ? [] : ['- master run produced no report:', ...lastLines(masterRun.stderr)]),
    ...(branchRun.json ? [] : ['- branch run produced no report:', ...lastLines(branchRun.stderr)]),
  ]
  const files = testFiles.map((p) => ({ path: p, master: master[p], branch: branchRes[p] }))
  return finish({ files, reason: v.reason }, v.pass, extra)
}

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`error: ${(e as Error).message}`)
    console.error('usage: loop:proof [--base <ref>] [--refactor]')
    return 1
  }
  const repo = fs.realpathSync(git(['rev-parse', '--show-toplevel'], process.cwd()))
  const state = treeState(repo)
  const scratch = new Scratch(repo)
  const onSignal = makeSignalHandler(scratch, (code) => process.exit(code), (m) => console.error(m))
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let result: { verdict: ProofVerdict; lines: string[] }
  try {
    result = await prove(repo, args, scratch)
  } catch (e) {
    result = {
      verdict: { pass: false, reason: 'error' },
      lines: [`- verdict: not proved: the proof could not run (${clip(String((e as Error).message ?? e), 200)})`],
    }
  } finally {
    scratch.cleanup()
  }
  process.stdout.write(`${formatEvidenceBlock({
    command: 'proof', verdict: result.verdict.pass ? 'pass' : 'fail', ...state, lines: result.lines,
  })}\n`)
  return result.verdict.pass ? 0 : 1
}

// Run only as a script, so the tests can import the functions above without side effects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code },
    (e) => {
      console.error(`error: loop:proof failed unexpectedly: ${String(e)}`)
      process.exitCode = 1
    },
  )
}
