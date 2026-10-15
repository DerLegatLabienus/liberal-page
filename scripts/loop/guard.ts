// CLI for the unattended loop: check a branch's new dependencies against its plan.
// Usage: npm run -s loop:guard -- [--base <ref>] [--plan <plan.md>]
//
// Compares the base (the merge base with origin/master or master, or --base) with HEAD:
//   - packages added to package.json (dependencies or devDependencies),
//   - new imports from one area of the code into another (an import scan of both trees, read
//     from git objects; nothing is checked out and the working tree is never touched),
//   - new imports that break the layering (docs/superpowers/specs/
//     2026-10-14-loop-plan-and-proof-design.md, "Risky work").
// Each finding must be named on the plan's `**New dependencies:**` line; a layering break must
// be named there as an exception with a reason. Without --plan, nothing counts as declared.
// Prints one evidence block (`<!-- loop:guard -->`) on stdout.
//
// Plan matching (forgiving on purpose, see parsePlan / packageDeclared / edgeDeclaration):
//   - a package is declared when its full name appears anywhere in the New dependencies text
//     as a whole token (backticks and an `@version` suffix are fine; `react` does not match
//     `react-dom`);
//   - an import is declared by an `A → B` pair (`->` and `=>` work too) on that text, where each
//     side is an area (`src/components`), a file path (extension and `@/` optional) or a folder
//     prefix of the file (`server/db` covers `server/db/index.ts`). Direction matters;
//   - a pair is a layering exception when its line contains the word "exception" and some
//     reason besides the pair and the words "layering"/"exception".
//
// Each rule is one entry in CHECKS (a function from the context to findings), so later rules
// (risky areas, guardrail paths, migrations) are added there without touching the others.
//
// Exit codes: 0 = pass; 1 = an undeclared package or import, or an unexcused layering break;
//             2 = could not run (bad arguments, unreadable plan, git failed).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatEvidenceBlock, resolveBase, treeState, type Verdict } from './evidence.js'

// ---------------------------------------------------------------------------------------------
// Import scan

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']
/** Tried in this order when a specifier leaves the extension out. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']

/** Whether a tracked file is read by the import scan: code only, no declaration files. */
export function isScannedFile(file: string): boolean {
  if (file.endsWith('.d.ts')) return false
  if (file.startsWith('node_modules/') || file.includes('/node_modules/')) return false
  return CODE_EXTENSIONS.includes(path.posix.extname(file))
}

const SPECIFIER_PATTERNS = [
  // import … from 'x' and export … from 'x', across multi-line braces. The prefix stops at a
  // quote, so the captured string is always the one right after `from`.
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  // side-effect import: import './x.css'
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  // dynamic import('x')
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  // vi.mock('x') / vi.doMock('x')
  /\bvi\.(?:mock|doMock)\s*\(\s*['"]([^'"\n]+)['"]/g,
]

/** Every module specifier a source file names, once each, in first-seen order. */
export function extractSpecifiers(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1])
  }
  return [...found]
}

/**
 * The repo path a specifier points at, or null for a package or a path that is not in the tree.
 * `@/` is `src/` (vite.config.ts and vitest.config.ts). A `.js` specifier also finds its `.ts`
 * source, as nodenext-style imports name the compiled file.
 */
export function resolveSpecifier(fromFile: string, specifier: string, files: ReadonlySet<string>): string | null {
  let target: string
  if (specifier.startsWith('@/')) target = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    target = path.posix.join(path.posix.dirname(fromFile), specifier)
  } else return null
  target = path.posix.normalize(target).replace(/\/$/, '')

  const candidates = [target]
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(target + ext)
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(`${target}/index${ext}`)
  const compiled = /\.(?:js|jsx|mjs|cjs)$/.exec(target)
  if (compiled) {
    const stem = target.slice(0, compiled.index)
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(stem + ext)
  }
  return candidates.find((c) => files.has(c)) ?? null
}

/**
 * The area a file belongs to: `src/<first folder>` and `server/<first folder>` (`src` and
 * `server` for files directly in them), otherwise the top-level folder (`scripts`, `tests`),
 * and `(root)` for files at the repo root.
 */
export function areaOf(file: string): string {
  const parts = file.split('/')
  if (parts.length === 1) return '(root)'
  if (parts[0] === 'src' || parts[0] === 'server') {
    return parts.length === 2 ? parts[0] : `${parts[0]}/${parts[1]}`
  }
  return parts[0]
}

export interface Edge {
  fromFile: string
  toFile: string
  fromArea: string
  toArea: string
}

const edgeKey = (e: Edge) => `${e.fromFile}\0${e.toFile}`

/** Importers under tests/ are not a dependency of the product code, so they are not edges. */
const isTestFile = (file: string) => file.startsWith('tests/')

/**
 * Every import from one area into another in a tree (path → source), once per file pair,
 * sorted. `files` is the set specifiers resolve against (all tracked paths, so a CSS or JSON
 * import resolves too); it defaults to the scanned files themselves.
 */
export function buildEdges(tree: ReadonlyMap<string, string>, files: ReadonlySet<string> = new Set(tree.keys())): Edge[] {
  const edges = new Map<string, Edge>()
  for (const [fromFile, source] of tree) {
    if (isTestFile(fromFile)) continue
    const fromArea = areaOf(fromFile)
    for (const specifier of extractSpecifiers(source)) {
      const toFile = resolveSpecifier(fromFile, specifier, files)
      if (!toFile) continue
      const toArea = areaOf(toFile)
      if (toArea === fromArea) continue
      const edge = { fromFile, toFile, fromArea, toArea }
      edges.set(edgeKey(edge), edge)
    }
  }
  return [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
}

/** Edges on HEAD that the base does not have. */
export function newEdges(base: readonly Edge[], head: readonly Edge[]): Edge[] {
  const known = new Set(base.map(edgeKey))
  return head.filter((e) => !known.has(edgeKey(e)))
}

// ---------------------------------------------------------------------------------------------
// Layering

/**
 * Imports that break the layering but were on master before the rule was written. They are
 * pure helpers; a plan that touches them may propose moving them.
 */
export const KNOWN_EXCEPTIONS: ReadonlyArray<{ fromFile: string; toFile: string }> = [
  { fromFile: 'server/repositories/letter-channels-repository.ts', toFile: 'server/services/html-sanitizer.ts' },
  { fromFile: 'server/repositories/letter-channels-repository.ts', toFile: 'server/services/letter-utils.ts' },
  { fromFile: 'server/repositories/committees-repository.ts', toFile: 'server/services/committee-status.ts' },
]

/** What server/ may import from src/: the shared types and the pure helpers in src/lib/. */
const SERVER_MAY_IMPORT_FROM_SRC = ['src/types.ts', 'src/lib/letter-urls.ts', 'src/lib/phone.ts']

const under = (file: string, folder: string) => file.startsWith(`${folder}/`)

const LAYERING_RULES: ReadonlyArray<{ rule: string; breaks: (e: Edge) => boolean }> = [
  { rule: 'src/ never imports server/', breaks: (e) => under(e.fromFile, 'src') && under(e.toFile, 'server') },
  {
    rule: 'server/ imports from src/ only src/types.ts, src/lib/letter-urls and src/lib/phone',
    breaks: (e) => under(e.fromFile, 'server') && under(e.toFile, 'src') && !SERVER_MAY_IMPORT_FROM_SRC.includes(e.toFile),
  },
  {
    rule: 'only server/index.ts imports a route',
    breaks: (e) => under(e.toFile, 'server/routes') && e.fromFile !== 'server/index.ts' && !under(e.fromFile, 'server/routes'),
  },
  { rule: 'routes do not import server/db', breaks: (e) => under(e.fromFile, 'server/routes') && under(e.toFile, 'server/db') },
  {
    rule: 'repositories do not import services',
    breaks: (e) => under(e.fromFile, 'server/repositories') && under(e.toFile, 'server/services'),
  },
]

/** The rule an import breaks, or null. Importers under tests/ and the known exceptions pass. */
export function layeringViolation(edge: Edge): string | null {
  if (isTestFile(edge.fromFile)) return null
  if (KNOWN_EXCEPTIONS.some((k) => k.fromFile === edge.fromFile && k.toFile === edge.toFile)) return null
  return LAYERING_RULES.find((r) => r.breaks(edge))?.rule ?? null
}

// ---------------------------------------------------------------------------------------------
// Packages

export interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface AddedPackage {
  name: string
  version: string
  dev: boolean
}

/** Packages on HEAD in neither base list. A move between the lists or a version bump is not new. */
export function addedPackages(base: PackageJson | null, head: PackageJson): AddedPackage[] {
  const known = new Set([...Object.keys(base?.dependencies ?? {}), ...Object.keys(base?.devDependencies ?? {})])
  const added: AddedPackage[] = []
  for (const [list, dev] of [[head.dependencies, false], [head.devDependencies, true]] as const) {
    for (const [name, version] of Object.entries(list ?? {})) {
      if (!known.has(name)) added.push({ name, version, dev })
    }
  }
  return added.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------
// The plan's New dependencies line

export interface PlanDeclaration {
  /** True when the plan declares nothing (says `none`, or has no New dependencies line). */
  none: boolean
  /** One entry per declared line: the text after the label, and each sub-bullet under it. */
  items: string[]
}

const DEPS_LABEL = /\*\*New dependencies:?\*\*:?/i
const BULLET = /^\s*[-*+]\s+/
const indentOf = (line: string) => /^\s*/.exec(line)![0].length

/** Strips a bullet marker and a leading bold label (`**Packages:**`). */
function itemText(line: string): string {
  return line.replace(BULLET, '').trim().replace(/^\*\*[^*]+\*\*:?\s*/, '').trim()
}

/**
 * Reads every `**New dependencies:**` line of a plan: the rest of that line, then the lines
 * under it. Under a bullet, those are the lines indented deeper (blank lines between them are
 * fine); under a plain line, the list that follows it, up to a blank line or a heading.
 */
export function parsePlan(markdown: string): PlanDeclaration {
  const lines = markdown.split(/\r?\n/)
  const items: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const label = DEPS_LABEL.exec(lines[i])
    if (!label) continue
    const indent = indentOf(lines[i])
    const isBullet = BULLET.test(lines[i])
    const rest = lines[i].slice(label.index + label[0].length).trim()
    if (rest) items.push(rest)

    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') {
        if (!isBullet) break
        const next = lines.slice(j + 1).find((l) => l.trim() !== '')
        if (next !== undefined && indentOf(next) > indent) continue
        break
      }
      if (/^\s*#/.test(line)) break
      if (isBullet ? indentOf(line) <= indent : !BULLET.test(line) && indentOf(line) <= indent) break
      const text = itemText(line)
      if (text) items.push(text)
    }
    i = j - 1
  }
  const none = items.length === 0 || (items.length === 1 && /^none\b/i.test(items[0].replace(/`/g, '')))
  return { none, items: none ? [] : items }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether the plan names a package, as a whole token (see the header comment). */
export function packageDeclared(name: string, plan: PlanDeclaration): boolean {
  const text = plan.items.join('\n').replace(/`/g, ' ')
  return new RegExp(`(?<![\\w@/.-])${escapeRegex(name)}(?![\\w/-])`, 'i').test(text)
}

const ARROW_PAIR = /([\w@./-]+)\s*(?:→|->|=>)\s*([\w@./-]+)/g

function normalizeSide(token: string): string {
  let t = token.replace(/^@\//, 'src/').replace(/^\.\//, '').replace(/[./]+$/, '')
  for (const ext of CODE_EXTENSIONS) if (t.endsWith(ext)) t = t.slice(0, -ext.length)
  return t
}

function sideMatches(token: string, file: string, area: string): boolean {
  const t = normalizeSide(token)
  if (!t) return false
  const ext = path.posix.extname(file)
  const stem = CODE_EXTENSIONS.includes(ext) ? file.slice(0, -ext.length) : file
  return t === area || t === stem || t === file || file.startsWith(`${t}/`)
}

/** Whether the plan names an import, and whether as a layering exception with a reason. */
export function edgeDeclaration(edge: Edge, plan: PlanDeclaration): { declared: boolean; exception: boolean } {
  let declared = false
  let exception = false
  for (const item of plan.items) {
    const text = item.replace(/`/g, '')
    for (const [pair, from, to] of text.matchAll(ARROW_PAIR)) {
      if (!sideMatches(from, edge.fromFile, edge.fromArea) || !sideMatches(to, edge.toFile, edge.toArea)) continue
      declared = true
      if (/\bexceptions?\b/i.test(text)) {
        const reason = text.replace(pair, ' ').replace(/\b(?:layering|exceptions?)\b/gi, ' ').replace(/[^\p{L}\p{N}]+/gu, '')
        if (reason) exception = true
      }
    }
  }
  return { declared, exception }
}

// ---------------------------------------------------------------------------------------------
// Checks

export interface GuardContext {
  addedPackages: AddedPackage[]
  newEdges: Edge[]
  plan: PlanDeclaration
}

export type FindingStatus = 'ok' | 'undeclared' | 'violation' | 'exception'

export interface Finding {
  check: string
  /** The finding as printed, without its status. */
  subject: string
  status: FindingStatus
}

export interface Check {
  name: string
  /** The block's line for this check, followed by `: <count>` or `: none`. */
  heading: string
  run: (ctx: GuardContext) => Finding[]
}

const showEdge = (e: Edge) => `\`${e.fromFile}\` → \`${e.toFile}\``

export const CHECKS: readonly Check[] = [
  {
    name: 'packages',
    heading: 'packages added',
    run: (ctx) => ctx.addedPackages.map((p) => ({
      check: 'packages',
      subject: `\`${p.name}@${p.version}\` (${p.dev ? 'devDependencies' : 'dependencies'})`,
      status: packageDeclared(p.name, ctx.plan) ? 'ok' : 'undeclared',
    })),
  },
  {
    name: 'imports',
    heading: 'new cross-area imports',
    run: (ctx) => ctx.newEdges.map((e) => ({
      check: 'imports',
      subject: `${showEdge(e)} (${e.fromArea} → ${e.toArea})`,
      status: edgeDeclaration(e, ctx.plan).declared ? 'ok' : 'undeclared',
    })),
  },
  {
    name: 'layering',
    heading: 'layering violations',
    run: (ctx) => ctx.newEdges.flatMap((e) => {
      const rule = layeringViolation(e)
      if (!rule) return []
      const status: FindingStatus = edgeDeclaration(e, ctx.plan).exception ? 'exception' : 'violation'
      return [{ check: 'layering', subject: `${showEdge(e)} [${rule}]`, status }]
    }),
  },
]

export interface GuardResult {
  verdict: Verdict
  findings: Finding[]
}

const FAILING: readonly FindingStatus[] = ['undeclared', 'violation']

/** Runs every check; the guard fails when any finding is undeclared or an unexcused violation. */
export function evaluate(ctx: GuardContext, checks: readonly Check[] = CHECKS): GuardResult {
  const findings = checks.flatMap((c) => c.run(ctx))
  return { verdict: findings.some((f) => FAILING.includes(f.status)) ? 'fail' : 'pass', findings }
}

export interface ScanStats {
  base: string
  scanned: { base: number; head: number }
  edges: { base: number; head: number }
  planFile?: string
  planItems?: number
}

/** The block's own lines: the scan, then one heading per check with its marked findings. */
export function guardLines(result: GuardResult, stats: ScanStats, checks: readonly Check[] = CHECKS): string[] {
  const plan = stats.planFile
    ? `\`${stats.planFile}\` (${stats.planItems ?? 0} declared item(s))`
    : 'none given, nothing declared'
  const lines = [
    `- base: \`${stats.base.slice(0, 7)}\`; files scanned: ${stats.scanned.base} on base, ${stats.scanned.head} on HEAD; ` +
      `cross-area imports: ${stats.edges.base} on base, ${stats.edges.head} on HEAD`,
    `- plan: ${plan}`,
  ]
  for (const check of checks) {
    const found = result.findings.filter((f) => f.check === check.name)
    lines.push(`- ${check.heading}: ${found.length === 0 ? 'none' : found.length}`)
    for (const f of found) lines.push(`  - ${f.subject}: ${f.status}`)
  }
  return lines
}

// ---------------------------------------------------------------------------------------------
// Git (thin wrapper)

const MAX_BUFFER = 512 * 1024 * 1024

function git(args: string[], input?: string): Buffer {
  return execFileSync('git', args, { input, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'] })
}

function trackedFiles(ref: string): string[] {
  return git(['ls-tree', '-r', '-z', '--name-only', ref]).toString('utf8').split('\0').filter(Boolean)
}

/** Reads many files of one commit through a single `git cat-file --batch`. */
function readFiles(ref: string, files: string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (files.length === 0) return out
  const buf = git(['cat-file', '--batch'], files.map((f) => `${ref}:${f}\n`).join(''))
  let pos = 0
  for (const file of files) {
    const eol = buf.indexOf(0x0a, pos)
    const header = buf.subarray(pos, eol).toString('utf8')
    pos = eol + 1
    const m = /^\S+ (\S+) (\d+)$/.exec(header)
    if (!m) continue // "<object> missing": not a blob at this ref
    const size = Number(m[2])
    if (m[1] === 'blob') out.set(file, buf.subarray(pos, pos + size).toString('utf8'))
    pos += size + 1
  }
  return out
}

function scanTree(ref: string): { scanned: number; edges: Edge[] } {
  const all = trackedFiles(ref)
  const tree = readFiles(ref, all.filter(isScannedFile))
  return { scanned: tree.size, edges: buildEdges(tree, new Set(all)) }
}

function packageJsonAt(ref: string): PackageJson | null {
  try {
    return JSON.parse(git(['show', `${ref}:package.json`]).toString('utf8')) as PackageJson
  } catch {
    return null
  }
}

function parseArgs(argv: string[]): { base?: string; plan?: string } {
  const args: { base?: string; plan?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag !== '--base' && flag !== '--plan') throw new Error(`unknown argument: ${flag}`)
    const value = argv[++i]
    if (!value) throw new Error(`${flag} needs a value`)
    args[flag === '--base' ? 'base' : 'plan'] = value
  }
  return args
}

export function main(argv = process.argv.slice(2)): number {
  let args: { base?: string; plan?: string }
  let plan: PlanDeclaration = { none: true, items: [] }
  try {
    args = parseArgs(argv)
    if (args.plan) plan = parsePlan(readFileSync(args.plan, 'utf8'))
  } catch (err) {
    console.error(`error: ${(err as Error).message}`)
    console.error('usage: npm run -s loop:guard -- [--base <ref>] [--plan <plan.md>]')
    return 2
  }

  const base = resolveBase(args.base)
  const baseScan = scanTree(base)
  const headScan = scanTree('HEAD')
  const headPkg = packageJsonAt('HEAD')
  const ctx: GuardContext = {
    addedPackages: addedPackages(packageJsonAt(base), headPkg ?? {}),
    newEdges: newEdges(baseScan.edges, headScan.edges),
    plan,
  }
  const result = evaluate(ctx)
  const lines = guardLines(result, {
    base,
    scanned: { base: baseScan.scanned, head: headScan.scanned },
    edges: { base: baseScan.edges.length, head: headScan.edges.length },
    planFile: args.plan,
    planItems: plan.items.length,
  })
  process.stdout.write(`${formatEvidenceBlock({ command: 'guard', verdict: result.verdict, ...treeState(), lines })}\n`)
  return result.verdict === 'pass' ? 0 : 1
}

// Run only as a script, so the tests can import the functions above without side effects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (err) {
    console.error(`error: loop:guard could not run: ${(err as Error).message}`)
    process.exitCode = 2
  }
}
