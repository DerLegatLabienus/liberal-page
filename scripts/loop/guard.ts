// CLI for the unattended loop: check a branch against its plan and the rules for risky work.
// Usage: npm run -s loop:guard -- [--base <ref>] [--plan <plan.md>]
//
// Compares the base (the merge base with origin/master or master, or --base) with HEAD. Both
// trees are read from git objects; nothing is checked out and the working tree is never read.
//   - packages added to package.json (dependencies, devDependencies, optionalDependencies,
//     peerDependencies), and any added or changed one installed from outside the npm registry,
//   - new imports from one area of the code into another, and new imports that break the
//     layering (docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md, "Risky work"),
//   - risky areas the change falls in (migrations, auth, CI and deploy configuration,
//     production data script; see RISKY_AREAS and riskyContext below),
//   - guardrail paths (the rules the loop follows; see isGuardrailPath) and `loop:*` scripts,
//   - HEAD's migrations applied to a fresh in-memory pglite database,
//   - new migrations that drop, rename, change a type or delete data (destructiveStatements),
//     and edits to a migration already on the base.
// Prints one evidence block (`<!-- loop:guard -->`) on stdout.
//
// WHERE IT RUNS. A branch can edit this file and the `loop:guard` script, so the guard must
// not be taken from the branch it judges. The loop runs master's copy: for example
// `git show origin/master:scripts/loop/guard.ts` (and evidence.ts) written to a temp folder and
// run from the branch's checkout, or a checkout of master, with --base and --plan set by the
// caller, never by the branch. Wiring that up is #45. Here, as a second line, any change to a
// `loop:*` package.json script or to scripts/loop/** is a guardrail violation.
//
// Every rule fails closed. Decisions, so a reviewer can check them:
//   - Plan lines are read strictly. Each item is one bullet (or the text after the label).
//     Reading stops at a heading, at a line no deeper than the label line, and at any line that
//     carries a different `**Label:**` (New dependencies keeps `**Packages:**` and
//     `**Cross-module dependencies:**`).
//   - Risky areas: each item (split on `,` and `;`) must be an area name or a listed alias
//     (RISKY_ALIASES), case-insensitive, trailing punctuation ignored. `none`, optionally with
//     ` — reason`, ` - reason`, `: reason` or `(reason)`, names nothing. Anything else is an
//     `unclear` finding that fails and names the item; so is `none` next to an area.
//   - A package is declared only by an item whose first token is `name` or `name@version`
//     (backticks fine). An import only by an item that starts with an `A → B` pair (`->`, `=>`
//     too); each side is an area, a file path (extension and `@/` optional) or a folder prefix.
//     An item holding a negation (no, not, n't, without, instead of, considered, rejected)
//     declares nothing.
//   - A layering break is excused only by an item that declares the import and contains
//     `exception:` followed by a reason of at least three words.
//   - Packages from outside the registry (npm:, git, github:, file:, link:, URLs, owner/repo)
//     fail whatever the plan says.
//   - package.json changes to `scripts` (other than loop:*, which are guardrails), install
//     hooks, `overrides` or `resolutions` count as CI and deploy configuration.
//   - Auth also covers any file whose diff adds or removes a line using requireAuth,
//     requireAdmin or optionalAuth. A production data script is also any changed script outside
//     scripts/loop that imports server/db or server/repositories.
//   - Migrations: any DROP fails except DROP INDEX, DROP CONSTRAINT, DROP NOT NULL, DROP DEFAULT
//     and exactly `DROP SCHEMA [IF EXISTS] loop_read CASCADE` (CLAUDE.md requires it before a
//     migration that touches a column the loop's views use). RENAME, a type change, TRUNCATE,
//     DELETE FROM and any EXECUTE (dynamic SQL cannot be checked) fail. Comments and string
//     contents (E'' escapes included) are ignored; dollar-quoted bodies are scanned. Migration
//     files are every .sql under server/db/migrations/ (nested too); a journal tag pointing
//     outside that folder fails, and so does a .sql file the journal does not list.
//   - Paths come from git with -z and core.quotePath=false, and renames are off, so a file moved
//     out of a guarded folder shows its old path. A path holding a newline stops the run (2).
//   - HEAD's package.json must be readable and valid JSON, or the run stops (2).
//
// Each rule is one entry in CHECKS (a function from the context to findings), so a new rule is
// added there without touching the others.
//
// Exit codes: 0 = pass; 1 = any finding is undeclared, unclear or a violation;
//             2 = could not run (bad arguments, unreadable plan or package.json, git failed).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
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

/** After one of these (or at the start), a `/` opens a regex literal rather than dividing. */
const REGEX_MAY_FOLLOW = new Set([...'(,=:[!&|?{};+-*%<>~^'])

/**
 * Source with `//` and `/* … *\/` comments removed. Strings, template literals and regex
 * literals are copied as they are, so `'http://x'` or `/\/\*+/` is not read as a comment.
 */
export function stripJsComments(source: string): string {
  let out = ''
  let last = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') j++
        else if (c !== '`' && source[j] === '\n') break
        j++
      }
      out += source.slice(i, j + 1)
      last = c
      i = j + 1
    } else if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      out += ' '
      i = end === -1 ? n : end + 2
    } else if (c === '/' && (last === '' || REGEX_MAY_FOLLOW.has(last))) {
      let j = i + 1
      let inClass = false
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue }
        if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break
        j++
      }
      out += source.slice(i, j + 1)
      last = 'a'
      i = j + 1
    } else {
      out += c
      if (!/\s/.test(c)) last = c
      i++
    }
  }
  return out
}

/** A quoted module name: '…', "…", or a backtick string with no `${`. */
const STR = String.raw`(?:'([^'\n]+)'|"([^"\n]+)"|` + '`([^`$\\n]+)`)'

const SPECIFIER_PATTERNS = [
  // import … from 'x' and export … from 'x', across multi-line braces. The prefix stops at a
  // quote, so the captured string is always the one right after `from`.
  new RegExp(String.raw`\b(?:import|export)\b[^'"` + '`' + String.raw`;]*?\bfrom\s*${STR}`, 'g'),
  // side-effect import: import './x.css'
  new RegExp(String.raw`\bimport\s*${STR}`, 'g'),
  // dynamic import('x'); a comment before the string is already stripped
  new RegExp(String.raw`\bimport\s*\(\s*${STR}\s*\)`, 'g'),
  // vi.mock('x') / vi.doMock('x')
  new RegExp(String.raw`\bvi\.(?:mock|doMock)\s*\(\s*${STR}`, 'g'),
]

/** Every module specifier a source file names, once each, in first-seen order. */
export function extractSpecifiers(source: string): string[] {
  const code = stripJsComments(source)
  const found = new Set<string>()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const m of code.matchAll(pattern)) found.add(m[1] ?? m[2] ?? m[3])
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

export const DEPENDENCY_LISTS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
export type DependencyList = (typeof DEPENDENCY_LISTS)[number]

export type PackageJson = { [L in DependencyList]?: Record<string, string> } & {
  scripts?: Record<string, string>
  overrides?: unknown
  resolutions?: unknown
}

export interface AddedPackage {
  name: string
  version: string
  list: DependencyList
}

function entries(pkg: PackageJson | null): AddedPackage[] {
  return DEPENDENCY_LISTS.flatMap((list) =>
    Object.entries(pkg?.[list] ?? {}).map(([name, version]) => ({ name, version: String(version), list })))
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Packages on HEAD in none of the base lists. A move between lists or a version bump is not new. */
export function addedPackages(base: PackageJson | null, head: PackageJson): AddedPackage[] {
  const known = new Set(entries(base).map((e) => e.name))
  return entries(head).filter((e) => !known.has(e.name)).sort(byName)
}

/** A version spec that installs from somewhere other than the npm registry. */
const NON_REGISTRY = /^(?:npm:|git(?:\+|:|@)|github:|gitlab:|bitbucket:|gist:|file:|link:|portal:|workspace:|https?:\/\/)|^[\w.-]+\/[\w.-]+(?:#.*)?$/i

/** Dependencies added, or changed, to a source outside the registry. Unchanged ones are baseline. */
export function nonRegistrySources(base: PackageJson | null, head: PackageJson): AddedPackage[] {
  const before = new Map(entries(base).map((e) => [`${e.list}\0${e.name}`, e.version]))
  return entries(head)
    .filter((e) => NON_REGISTRY.test(e.version.trim()) && before.get(`${e.list}\0${e.name}`) !== e.version)
    .sort(byName)
}

const isLoopScript = (name: string) => name.startsWith('loop:')
const INSTALL_HOOKS = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish'])

function changedKeys(a: Record<string, string> = {}, b: Record<string, string> = {}): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort()
}

/** `loop:*` scripts added, removed or changed: the guard's own wiring. */
export function loopScriptChanges(base: PackageJson | null, head: PackageJson): string[] {
  return changedKeys(base?.scripts, head.scripts).filter(isLoopScript)
}

/** package.json changes that count as CI and deploy configuration. */
export function packageJsonRiskyChanges(base: PackageJson | null, head: PackageJson): string[] {
  const found = changedKeys(base?.scripts, head.scripts).filter((k) => !isLoopScript(k))
    .map((k) => `package.json scripts.${k}${INSTALL_HOOKS.has(k) ? ' (install hook)' : ''}`)
  for (const field of ['overrides', 'resolutions'] as const) {
    if (JSON.stringify(base?.[field] ?? null) !== JSON.stringify(head[field] ?? null)) found.push(`package.json ${field}`)
  }
  return found
}

// ---------------------------------------------------------------------------------------------
// The plan

export interface PlanDeclaration {
  /** True when the plan declares nothing (says `none`, or has no New dependencies line). */
  none: boolean
  /** One entry per declared item: the text after the label, and each line under it. */
  items: string[]
}

const DEPS_LABEL = /\*\*New dependencies:?\*\*:?/i
const DEPS_SUBLABELS = ['packages', 'cross-module dependencies']
const RISKY_LABEL = /\*\*Risky areas:?\*\*:?/i
const ANY_LABEL = /\*\*([^*\n]+?)(?::\*\*|\*\*:)/g
const BULLET = /^\s*[-*+]\s+/
const indentOf = (line: string) => /^\s*/.exec(line)![0].length
const NEGATION = /\b(?:no|not|without|instead\s+of|considered|rejected)\b|n't\b/i
const NONE_ITEM = /^none\b/i

/** Strips a bullet marker and a leading bold label (`**Packages:**`). */
function itemText(line: string): string {
  return line.replace(BULLET, '').trim().replace(/^\*\*[^*]+\*\*:?\s*/, '').trim()
}

/** Whether a line carries a bold label other than the allowed sub-labels. */
function carriesOtherLabel(line: string, subLabels: readonly string[]): boolean {
  return [...line.matchAll(ANY_LABEL)].some((m) => !subLabels.includes(m[1].trim().toLowerCase()))
}

/**
 * The raw items of every line carrying `label`: the rest of that line, then the lines under it.
 * Under a bullet, those are the lines indented deeper (blank lines between them are fine);
 * under a plain line, the list that follows it, up to a blank line. Reading always stops at a
 * heading and at a line carrying any other `**Label:**`.
 */
function labelledItems(markdown: string, labelPattern: RegExp, subLabels: readonly string[] = []): string[] {
  const lines = markdown.split(/\r?\n/)
  const items: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const label = labelPattern.exec(lines[i])
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
      if (/^\s*#/.test(line) || carriesOtherLabel(line, subLabels)) break
      if (isBullet ? indentOf(line) <= indent : !BULLET.test(line) && indentOf(line) <= indent) break
      const text = itemText(line)
      if (text) items.push(text)
    }
    i = j - 1
  }
  return items
}

/** The `**New dependencies:**` items. Items that start with `none` declare nothing and are dropped. */
export function parsePlan(markdown: string): PlanDeclaration {
  const items = labelledItems(markdown, DEPS_LABEL, DEPS_SUBLABELS)
    .filter((item) => !NONE_ITEM.test(item.replace(/`/g, '').trim()))
  return { none: items.length === 0, items }
}

/** An item as matched: backticks removed. Null when it holds a negation, so it declares nothing. */
function declaringText(item: string): string | null {
  const text = item.replace(/`/g, '').trim()
  return NEGATION.test(text) ? null : text
}

/** Whether an item's first token is `name` or `name@version`. */
export function packageDeclared(name: string, plan: PlanDeclaration): boolean {
  return plan.items.some((item) => {
    const text = declaringText(item)
    if (text === null) return false
    const first = text.split(/[\s,;()]+/)[0].replace(/[.,;:]+$/, '')
    return first === name || first.startsWith(`${name}@`)
  })
}

const LEADING_PAIR = /^([\w@./-]+)\s*(?:→|->|=>)\s*([\w@./-]+)/
const EXCEPTION_REASON = /\bexception:\s*(.+)$/i

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
    const text = declaringText(item)
    const pair = text === null ? null : LEADING_PAIR.exec(text)
    if (!pair || !sideMatches(pair[1], edge.fromFile, edge.fromArea) || !sideMatches(pair[2], edge.toFile, edge.toArea)) continue
    declared = true
    const reason = EXCEPTION_REASON.exec(text!)
    if (reason && reason[1].split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 3) exception = true
  }
  return { declared, exception }
}

// ---------------------------------------------------------------------------------------------
// Risky areas

export type RiskyArea = 'migrations' | 'auth' | 'ci-deploy' | 'prod-data'

/** Names of auth and access-control code in server/repositories and server/services. */
const AUTH_NAMED = /^server\/(?:repositories|services)\/(?:[^/]+\/)*[^/]*(?:role|allowlist|refresh-token|invite)[^/]*$/

/**
 * The risky tier (CLAUDE.md, "Classify every change") as paths. A path may be in two areas
 * (`server/db/schema/auth.ts`). The order here is the order findings are printed in.
 *   - migrations: anything that changes the database shape or how it is migrated;
 *   - auth (auth and access control): every server file or folder whose name starts with
 *     `auth`, all of server/middleware (where the gates live), server/routes/admin.ts (the
 *     invite allowlist and user roles), server/repositories/users-repository.ts, and any
 *     repository or service named for roles, the allowlist, refresh tokens or invites. Other
 *     admin routes are features behind the gate, but see authGateFiles;
 *   - ci-deploy (CI and deploy configuration): .github/**, render.yaml, .env.example, and see
 *     packageJsonRiskyChanges;
 *   - prod-data (production data script): scripts/seed-data/** and the top-level scripts that
 *     write to a database (seed, backfill, import, migrate, regen), and see prodDataScripts.
 */
export const RISKY_AREAS: ReadonlyArray<{ area: RiskyArea; matches: (file: string) => boolean }> = [
  {
    area: 'migrations',
    matches: (f) => under(f, 'server/db/migrations') || under(f, 'server/db/schema') ||
      f === 'server/db/migrate.ts' || f === 'drizzle.config.ts',
  },
  {
    area: 'auth',
    matches: (f) => /^server\/(?:[^/]+\/)*auth[^/]*(?:\/|$)/.test(f) || under(f, 'server/middleware') ||
      f === 'server/routes/admin.ts' || f === 'server/repositories/users-repository.ts' || AUTH_NAMED.test(f),
  },
  {
    area: 'ci-deploy',
    matches: (f) => under(f, '.github') || f === 'render.yaml' || f === '.env.example',
  },
  {
    area: 'prod-data',
    matches: (f) => under(f, 'scripts/seed-data') || /^scripts\/(?:seed|backfill|import|migrate|regen)[^/]*$/.test(f),
  },
]

/** The risky areas one path belongs to. */
export function riskyAreasOf(file: string): RiskyArea[] {
  return RISKY_AREAS.filter((r) => r.matches(file)).map((r) => r.area)
}

/** The only words the Risky areas line may use, lowercase. */
export const RISKY_ALIASES: Readonly<Record<string, RiskyArea>> = {
  'migrations': 'migrations',
  'migration': 'migrations',
  'database migrations': 'migrations',
  'database migration': 'migrations',
  'auth': 'auth',
  'auth and access control': 'auth',
  'access control': 'auth',
  'ci and deploy configuration': 'ci-deploy',
  'ci': 'ci-deploy',
  'deploy': 'ci-deploy',
  'ci-deploy': 'ci-deploy',
  'production data script': 'prod-data',
  'production data scripts': 'prod-data',
  'prod data': 'prod-data',
  'prod-data': 'prod-data',
}

/** `none`, optionally with ` — reason`, ` - reason`, `: reason` or `(reason)`. */
const NONE_DECLARATION = /^none\s*(?:\.?\s*$|(?:—|–|-|:)\s*\S.*$|\(.*\)\s*\.?\s*$)/i

/** The areas a plan's `**Risky areas:**` line names, and the items that are not an area or `none`. */
export function parseRiskyAreas(markdown: string): { areas: RiskyArea[]; unclear: string[] } {
  const named = new Set<RiskyArea>()
  const unclear: string[] = []
  let none = false
  for (const item of labelledItems(markdown, RISKY_LABEL)) {
    const text = item.replace(/`/g, '').trim()
    if (NONE_DECLARATION.test(text)) { none = true; continue }
    for (const piece of text.split(/[,;]/)) {
      const key = piece.trim().replace(/[.,;:!]+$/, '').trim().toLowerCase()
      if (!key) continue
      const area = RISKY_ALIASES[key]
      if (area) named.add(area)
      else unclear.push(piece.trim())
    }
  }
  if (none && (named.size > 0 || unclear.length > 0)) unclear.push('none, together with areas')
  return { areas: RISKY_AREAS.map((r) => r.area).filter((a) => named.has(a)), unclear }
}

const AUTH_GATE = /\b(?:requireAuth|requireAdmin|optionalAuth)\b/

/**
 * Files whose diff (`git diff -U0`) adds or removes a line using an auth gate. Header lines are
 * told apart from content by position: after `diff --git` until the first `@@`.
 */
export function authGateFiles(diff: string): string[] {
  const found: string[] = []
  let minus = ''
  let file = ''
  let inHeader = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { inHeader = true; minus = ''; file = ''; continue }
    if (inHeader) {
      if (line.startsWith('--- ')) minus = line.slice(4).replace(/^a\//, '')
      else if (line.startsWith('+++ ')) file = line.slice(4) === '/dev/null' ? minus : line.slice(4).replace(/^b\//, '')
      else if (line.startsWith('@@')) inHeader = false
      continue
    }
    if ((line.startsWith('+') || line.startsWith('-')) && AUTH_GATE.test(line) && file && !found.includes(file)) found.push(file)
  }
  return found
}

/** Changed scripts (outside scripts/loop) that import server/db or a repository: they write data. */
export function prodDataScripts(changed: readonly string[], headEdges: readonly Edge[]): string[] {
  const touched = new Set(changed)
  return [...new Set(headEdges
    .filter((e) => under(e.fromFile, 'scripts') && !under(e.fromFile, 'scripts/loop') && touched.has(e.fromFile))
    .filter((e) => under(e.toFile, 'server/db') || under(e.toFile, 'server/repositories'))
    .map((e) => e.fromFile))].sort()
}

// ---------------------------------------------------------------------------------------------
// Guardrails: the rules the loop follows. Changing them fails whatever the plan says.

const GUARDRAIL_FOLDERS = ['scripts/loop', '.claude', 'docs/agents']
const GUARDRAIL_FILES = [
  '.github/workflows/pr-review.yml',
  '.github/workflows/claude-code-review.yml',
  '.github/workflows/claude.yml',
  'scripts/loop-read-views.sql',
]

export function isGuardrailPath(file: string): boolean {
  return GUARDRAIL_FILES.includes(file) || GUARDRAIL_FOLDERS.some((d) => under(file, d))
}

/** NUL-separated git output (`-z`) as paths, exactly as git stores them. */
export function parseNulList(out: string): string[] {
  return out.split('\0').filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// Migrations

const MIGRATIONS_DIR = 'server/db/migrations'
const JOURNAL = `${MIGRATIONS_DIR}/meta/_journal.json`
const isMigrationSql = (file: string) => under(file, MIGRATIONS_DIR) && file.endsWith('.sql')

/**
 * SQL with comments removed (`--` to the end of the line, nested `/* … *\/`) and the contents of
 * single-quoted strings blanked (E'' strings with backslash escapes too), so seed text such as
 * `'drop table'` is not read as a statement. Dollar-quoted bodies (`$$ … $$`, `$tag$ … $tag$`)
 * are not strings to skip: their content is scanned like the rest.
 */
export function stripSqlComments(sql: string): string {
  let out = ''
  const n = sql.length
  let i = 0
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    const prevIsWord = i > 0 && /[\w$]/.test(sql[i - 1])
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 } else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 } else i++
      }
      out += ' '
    } else if ((c === 'e' || c === 'E') && next === "'" && !prevIsWord) {
      let j = i + 2
      while (j < n) {
        if (sql[j] === '\\') j += 2
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      out += "''"
      i = j + 1
    } else if (c === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      out += "''"
      i = j + 1
    } else if (c === '$' && !prevIsWord && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 66))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))![0]
      const end = sql.indexOf(tag, i + tag.length)
      const body = sql.slice(i + tag.length, end === -1 ? n : end)
      out += ` ${stripSqlComments(body)} `
      i = end === -1 ? n : end + tag.length
    } else {
      out += c
      i++
    }
  }
  return out
}

/** The one drop the repo requires (CLAUDE.md, "Migration hazard"): resetting the loop's views. */
const LOOP_READ_RESET = /^drop\s+schema\s+(?:if\s+exists\s+)?"?loop_read"?\s+cascade$/i
/** DROP <this> loses no data: it relaxes a rule or removes an index. */
const ALLOWED_DROPS = new Set(['index', 'constraint', 'not', 'default'])
/** Objects named after DROP; anything else after ALTER TABLE … DROP is a column. */
const DROP_OBJECTS = new Set([
  'table', 'column', 'schema', 'view', 'type', 'sequence', 'database', 'function', 'procedure', 'trigger', 'policy',
  'extension', 'role', 'user', 'domain', 'aggregate', 'operator', 'rule', 'owned', 'identity', 'expression', 'publication',
  'subscription', 'server', 'cast', 'collation', 'conversion', 'routine', 'statistics', 'tablespace',
])
const TYPE_CHANGE = /\balter\s+(?:column\s+)?(?:"[^"]+"|\S+)\s+(?:set\s+data\s+)?type\b/i
const MAX_STATEMENT_CHARS = 120

function dropReason(statement: string): string | null {
  for (const m of statement.matchAll(/\bdrop\s+("[^"]*"|\w+)/gi)) {
    const word = m[1].replace(/"/g, '').toLowerCase()
    if (ALLOWED_DROPS.has(word)) continue
    if (word === 'materialized') return 'drop materialized view'
    if (DROP_OBJECTS.has(word)) return `drop ${word}`
    return /^alter\s+table\b/i.test(statement) ? 'drop column' : `drop ${word}`
  }
  return null
}

/**
 * Statements that do more than add (see the header comment for the full rule): any DROP but the
 * allowed ones, RENAME, a type change, TRUNCATE, DELETE FROM, and any EXECUTE.
 */
export function destructiveStatements(sql: string): Array<{ statement: string; reason: string }> {
  const found: Array<{ statement: string; reason: string }> = []
  for (const raw of stripSqlComments(sql).split(';')) {
    const statement = raw.replace(/\s+/g, ' ').trim()
    if (!statement || LOOP_READ_RESET.test(statement)) continue
    let reason: string | null = /\bexecute\b/i.test(statement) ? 'dynamic SQL (EXECUTE)' : dropReason(statement)
    if (!reason && /\btruncate\b/i.test(statement)) reason = 'truncate'
    if (!reason && /\bdelete\s+from\b/i.test(statement)) reason = 'delete'
    if (!reason && /\brename\b/i.test(statement)) reason = 'rename'
    if (!reason && TYPE_CHANGE.test(statement)) reason = 'type change'
    if (reason) {
      const shown = statement.length > MAX_STATEMENT_CHARS ? `${statement.slice(0, MAX_STATEMENT_CHARS)}…` : statement
      found.push({ statement: shown, reason })
    }
  }
  return found
}

/** Migration SQL files (nested too) added on HEAD, and ones already on the base whose text changed. */
export function migrationChanges(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): { added: Array<{ file: string; sql: string }>; edited: string[] } {
  const added: Array<{ file: string; sql: string }> = []
  const edited: string[] = []
  for (const [file, sql] of [...head].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isMigrationSql(file)) continue
    const before = base.get(file)
    if (before === undefined) added.push({ file, sql })
    else if (before !== sql) edited.push(file)
  }
  return { added, edited }
}

/** The SQL files drizzle's journal points at (`<tag>.sql`), and tags that leave the folder. */
export function journalTargets(journal: string | null): { files: string[]; outside: string[] } {
  const files: string[] = []
  const outside: string[] = []
  let tags: string[] = []
  try {
    const parsed = JSON.parse(journal ?? '') as { entries?: Array<{ tag?: unknown }> }
    tags = (parsed.entries ?? []).map((e) => String(e.tag ?? ''))
  } catch {
    // a missing or broken journal points at nothing (and the migration run fails)
  }
  for (const tag of tags) {
    const normal = path.posix.normalize(tag)
    if (!tag || path.posix.isAbsolute(tag) || normal === '..' || normal.startsWith('../')) outside.push(tag)
    else files.push(`${MIGRATIONS_DIR}/${normal}.sql`)
  }
  return { files, outside }
}

/** SQL files the journal does not point at: drizzle's migrator would never apply them. */
export function unjournaledMigrations(sqlFiles: readonly string[], journal: string | null): string[] {
  const listed = new Set(journalTargets(journal).files)
  return sqlFiles.filter((f) => isMigrationSql(f) && !listed.has(f))
}

export type MigrationRun = { ok: true; applied: number; total: number } | { ok: false; error: string }

// ---------------------------------------------------------------------------------------------
// Checks

export interface GuardContext {
  addedPackages: AddedPackage[]
  /** Dependencies added or changed to a source outside the npm registry. */
  nonRegistry: AddedPackage[]
  newEdges: Edge[]
  plan: PlanDeclaration
  /** Paths the branch changed since the base (committed), renames as both old and new path. */
  changedPaths: string[]
  /** Risky areas found other than by path name: auth gates in a diff, package.json fields, data scripts. */
  extraRisky: Array<{ area: RiskyArea; path: string }>
  /** Areas the plan's Risky areas line names, and its items that are neither an area nor `none`. */
  riskyDeclared: RiskyArea[]
  riskyUnclear: string[]
  /** `loop:*` package.json scripts the branch added, removed or changed. */
  loopScriptChanges: string[]
  migrations: { added: Array<{ file: string; sql: string }>; edited: string[]; unjournaled: string[] }
  /** Journal tags that resolve outside server/db/migrations/. */
  journalOutside: string[]
  /** HEAD's migrations applied to a fresh in-memory database; null when not run (unit tests). */
  migrationRun: MigrationRun | null
}

export type FindingStatus = 'ok' | 'undeclared' | 'unclear' | 'violation' | 'exception'

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
  /** Print the heading without a count (the findings are a result, not a list of things found). */
  countless?: boolean
  run: (ctx: GuardContext) => Finding[]
}

const showEdge = (e: Edge) => `\`${e.fromFile}\` → \`${e.toFile}\``
const showPackage = (p: AddedPackage) => `\`${p.name}@${p.version}\` (${p.list})`

export const CHECKS: readonly Check[] = [
  {
    name: 'packages',
    heading: 'packages added',
    run: (ctx) => [
      ...ctx.addedPackages.map((p): Finding => ({
        check: 'packages', subject: showPackage(p), status: packageDeclared(p.name, ctx.plan) ? 'ok' : 'undeclared',
      })),
      ...ctx.nonRegistry.map((p): Finding => ({
        check: 'packages', subject: `${showPackage(p)} [installed from outside the npm registry]`, status: 'violation',
      })),
    ],
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
  {
    name: 'risky-areas',
    heading: 'risky areas touched',
    run: (ctx) => [
      ...RISKY_AREAS.flatMap(({ area }): Finding[] => {
        const paths = [...new Set([
          ...ctx.changedPaths.filter((p) => riskyAreasOf(p).includes(area)),
          ...ctx.extraRisky.filter((r) => r.area === area).map((r) => r.path),
        ])]
        if (paths.length === 0) return []
        const shown = paths.slice(0, 3).map((p) => `\`${p}\``).join(', ') + (paths.length > 3 ? `, +${paths.length - 3} more` : '')
        const status: FindingStatus = ctx.riskyDeclared.includes(area) ? 'ok' : 'undeclared'
        return [{ check: 'risky-areas', subject: `${area} (${paths.length} path(s): ${shown})`, status }]
      }),
      ...ctx.riskyUnclear.map((item): Finding => ({
        check: 'risky-areas', subject: `plan item "${item}" is not an area name or none`, status: 'unclear',
      })),
    ],
  },
  {
    name: 'guardrails',
    heading: 'guardrail paths changed',
    run: (ctx) => [
      ...ctx.changedPaths.filter(isGuardrailPath).map((p): Finding => ({ check: 'guardrails', subject: `\`${p}\``, status: 'violation' })),
      ...ctx.loopScriptChanges.map((s): Finding => ({ check: 'guardrails', subject: `package.json scripts \`${s}\``, status: 'violation' })),
    ],
  },
  {
    name: 'migrations-apply',
    heading: 'migrations apply',
    countless: true,
    run: (ctx) => {
      const found: Finding[] = [
        ...ctx.journalOutside.map((t): Finding => ({
          check: 'migrations-apply', subject: `journal tag \`${t}\` points outside ${MIGRATIONS_DIR}/`, status: 'violation',
        })),
        ...ctx.migrations.unjournaled.map((f): Finding => ({
          check: 'migrations-apply', subject: `\`${f}\` is not in meta/_journal.json, so it is never applied`, status: 'violation',
        })),
      ]
      const run = ctx.migrationRun
      if (run?.ok) {
        found.push({
          check: 'migrations-apply',
          subject: `${run.applied} of ${run.total} migration(s) applied to a fresh in-memory database`,
          status: run.applied === run.total ? 'ok' : 'violation',
        })
      } else if (run) {
        found.push({ check: 'migrations-apply', subject: `failed on a fresh in-memory database: ${run.error}`, status: 'violation' })
      }
      return found
    },
  },
  {
    name: 'schema-adds',
    heading: 'destructive migration statements',
    run: (ctx) => [
      ...ctx.migrations.added.flatMap(({ file, sql }) => destructiveStatements(sql).map((d): Finding => ({
        check: 'schema-adds',
        subject: `\`${file}\`: \`${d.statement.replace(/`/g, "'")}\` [${d.reason}]`,
        status: 'violation',
      }))),
      ...ctx.migrations.edited.map((file): Finding => ({
        check: 'schema-adds', subject: `\`${file}\` [a migration already on the base was edited]`, status: 'violation',
      })),
    ],
  },
]

export interface GuardResult {
  verdict: Verdict
  findings: Finding[]
}

const FAILING: readonly FindingStatus[] = ['undeclared', 'unclear', 'violation']

/** Runs every check; the guard fails when any finding is undeclared, unclear or a violation. */
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
  planRisky?: RiskyArea[]
}

/** The block's own lines: the scan, then one heading per check with its marked findings. */
export function guardLines(result: GuardResult, stats: ScanStats, checks: readonly Check[] = CHECKS): string[] {
  const plan = stats.planFile
    ? `\`${stats.planFile}\`; risky areas named: ${stats.planRisky?.length ? stats.planRisky.join(', ') : 'none'}; ` +
      `new dependencies: ${stats.planItems ? `${stats.planItems} item(s)` : 'none'}`
    : 'none given, nothing declared'
  const lines = [
    `- base: \`${stats.base.slice(0, 7)}\`; files scanned: ${stats.scanned.base} on base, ${stats.scanned.head} on HEAD; ` +
      `cross-area imports: ${stats.edges.base} on base, ${stats.edges.head} on HEAD`,
    `- plan: ${plan}`,
  ]
  for (const check of checks) {
    const found = result.findings.filter((f) => f.check === check.name)
    if (check.countless) lines.push(found.length === 0 ? `- ${check.heading}: not run` : `- ${check.heading}:`)
    else lines.push(`- ${check.heading}: ${found.length === 0 ? 'none' : found.length}`)
    for (const f of found) lines.push(`  - ${f.subject}: ${f.status}`)
  }
  return lines
}

// ---------------------------------------------------------------------------------------------
// Git (thin wrapper)

const MAX_BUFFER = 512 * 1024 * 1024

function git(args: string[], input?: string): Buffer {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { input, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'] })
}

function trackedFiles(ref: string): string[] {
  return parseNulList(git(['ls-tree', '-r', '-z', '--name-only', ref]).toString('utf8'))
}

/** Reads many files of one commit through a single `git cat-file --batch`. */
function readFiles(ref: string, files: string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (files.length === 0) return out
  const odd = files.find((f) => f.includes('\n'))
  if (odd !== undefined) throw new Error(`a path holds a newline and cannot be read safely: ${JSON.stringify(odd)}`)
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

function scanTree(ref: string): { all: string[]; scanned: number; edges: Edge[] } {
  const all = trackedFiles(ref)
  const tree = readFiles(ref, all.filter(isScannedFile))
  return { all, scanned: tree.size, edges: buildEdges(tree, new Set(all)) }
}

/** package.json at a ref. A missing one on the base is empty; on HEAD it stops the run. */
function packageJsonAt(ref: string, required: boolean): PackageJson | null {
  let text: string
  try {
    text = git(['show', `${ref}:package.json`]).toString('utf8')
  } catch {
    if (required) throw new Error(`${ref}:package.json cannot be read`)
    return null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as PackageJson
  } catch {
    if (required) throw new Error(`${ref}:package.json is not valid JSON`)
    return null
  }
}

/** Paths changed since the base, committed only, with renames off (both old and new path). */
function changedPathsBothSides(base: string): string[] {
  return parseNulList(git(['diff', '--name-only', '-z', '--no-renames', `${base}...HEAD`]).toString('utf8'))
}

/** The -U0 diff of the changed code files, for authGateFiles. */
function codeDiff(base: string, changed: string[]): string {
  const code = changed.filter(isScannedFile)
  if (code.length === 0) return ''
  return git(['diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', `${base}...HEAD`, '--', ...code]).toString('utf8')
}

/**
 * Applies HEAD's migrations (copied out of git into a temp folder, never the working tree) to
 * a fresh in-memory pglite with drizzle's migrator, the same way tests/global-setup.ts does,
 * and counts the rows drizzle records.
 */
async function applyMigrations(files: ReadonlyMap<string, string>): Promise<MigrationRun> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'loop-guard-migrations-'))
  try {
    for (const [file, text] of files) {
      const target = path.join(dir, path.posix.relative(MIGRATIONS_DIR, file))
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, text)
    }
    const total = (JSON.parse(files.get(JOURNAL) ?? '{"entries":[]}') as { entries?: unknown[] }).entries?.length ?? 0
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    const pg = new PGlite()
    try {
      await migrate(drizzle(pg), { migrationsFolder: dir })
      const res = await pg.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')
      return { ok: true, applied: res.rows[0]?.n ?? 0, total }
    } finally {
      await pg.close()
    }
  } catch (err) {
    // drizzle wraps the database error ("Failed query: <sql>"); the cause says what went wrong.
    const e = err as Error & { cause?: { message?: string } }
    const message = [e.cause?.message, e.message].find((m) => m && m.trim()) ?? 'unknown error'
    return { ok: false, error: message.replace(/\s+/g, ' ').trim().slice(0, 300) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
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

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: { base?: string; plan?: string }
  let planText = ''
  try {
    args = parseArgs(argv)
    if (args.plan) planText = readFileSync(args.plan, 'utf8')
  } catch (err) {
    console.error(`error: ${(err as Error).message}`)
    console.error('usage: npm run -s loop:guard -- [--base <ref>] [--plan <plan.md>]')
    return 2
  }
  const plan = parsePlan(planText)
  const risky = parseRiskyAreas(planText)

  const base = resolveBase(args.base)
  const headPkg = packageJsonAt('HEAD', true)!
  const basePkg = packageJsonAt(base, false)
  const baseScan = scanTree(base)
  const headScan = scanTree('HEAD')
  const inMigrations = (f: string) => under(f, MIGRATIONS_DIR) && (f.endsWith('.sql') || f === JOURNAL)
  const baseMigrations = readFiles(base, baseScan.all.filter(inMigrations))
  const headMigrations = readFiles('HEAD', headScan.all.filter(inMigrations))
  const journal = headMigrations.get(JOURNAL) ?? null
  const changedPaths = changedPathsBothSides(base)
  const ctx: GuardContext = {
    addedPackages: addedPackages(basePkg, headPkg),
    nonRegistry: nonRegistrySources(basePkg, headPkg),
    newEdges: newEdges(baseScan.edges, headScan.edges),
    plan,
    changedPaths,
    extraRisky: [
      ...authGateFiles(codeDiff(base, changedPaths)).map((p) => ({ area: 'auth' as const, path: p })),
      ...packageJsonRiskyChanges(basePkg, headPkg).map((p) => ({ area: 'ci-deploy' as const, path: p })),
      ...prodDataScripts(changedPaths, headScan.edges).map((p) => ({ area: 'prod-data' as const, path: p })),
    ],
    riskyDeclared: risky.areas,
    riskyUnclear: risky.unclear,
    loopScriptChanges: loopScriptChanges(basePkg, headPkg),
    migrations: {
      ...migrationChanges(baseMigrations, headMigrations),
      unjournaled: unjournaledMigrations([...headMigrations.keys()], journal),
    },
    journalOutside: journalTargets(journal).outside,
    migrationRun: await applyMigrations(headMigrations),
  }
  const result = evaluate(ctx)
  const lines = guardLines(result, {
    base,
    scanned: { base: baseScan.scanned, head: headScan.scanned },
    edges: { base: baseScan.edges.length, head: headScan.edges.length },
    planFile: args.plan,
    planItems: plan.items.length,
    planRisky: risky.areas,
  })
  process.stdout.write(`${formatEvidenceBlock({ command: 'guard', verdict: result.verdict, ...treeState(), lines })}\n`)
  return result.verdict === 'pass' ? 0 : 1
}

// Run only as a script, so the tests can import the functions above without side effects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Set the exit code and let the process end by itself, so queued output is not cut off.
  main().then(
    (code) => { process.exitCode = code },
    (err) => {
      console.error(`error: loop:guard could not run: ${(err as Error).message}`)
      process.exitCode = 2
    },
  )
}
