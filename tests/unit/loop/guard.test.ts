import { describe, it, expect } from 'vitest'
import {
  addedPackages,
  areaOf,
  buildEdges,
  CHECKS,
  evaluate,
  extractSpecifiers,
  guardLines,
  isScannedFile,
  KNOWN_EXCEPTIONS,
  layeringViolation,
  newEdges,
  packageDeclared,
  edgeDeclaration,
  parsePlan,
  resolveSpecifier,
  riskyAreasOf,
  parseRiskyAreas,
  isGuardrailPath,
  stripSqlComments,
  destructiveStatements,
  migrationChanges,
  unjournaledMigrations,
  type Edge,
  type GuardContext,
} from '../../../scripts/loop/guard'
import { findEvidenceBlock, formatEvidenceBlock } from '../../../scripts/loop/evidence'

describe('extractSpecifiers', () => {
  it('finds import/export from, side-effect, dynamic import and vi.mock', () => {
    const src = [
      "import React from 'react'",
      "import type { A } from '../types'",
      'import {',
      '  b,',
      '  c,',
      "} from './multi'",
      "export { d } from './reexport'",
      "export * from '@/lib/all'",
      "import './side.css'",
      "const m = await import('./lazy')",
      "vi.mock('../../server/services/x', () => ({}))",
      "vi.mock(\"@/hooks/useY\")",
    ].join('\n')
    expect(extractSpecifiers(src).sort()).toEqual([
      '../../server/services/x', '../types', './lazy', './multi', './reexport', './side.css',
      '@/hooks/useY', '@/lib/all', 'react',
    ])
  })

  it('does not read a string that merely follows an assignment as a specifier', () => {
    expect(extractSpecifiers("const x = 'from'; const y = 'not/a/module'")).toEqual([])
  })
})

describe('resolveSpecifier', () => {
  const files = new Set([
    'src/types.ts', 'src/lib/phone.ts', 'src/hooks/index.ts', 'src/components/Card.tsx',
    'scripts/loop/evidence.ts', 'src/index.css',
  ])

  it('resolves relative paths with an implied extension', () => {
    expect(resolveSpecifier('server/routes/a.ts', '../../src/types', files)).toBe('src/types.ts')
  })
  it('resolves the @/ alias to src/', () => {
    expect(resolveSpecifier('src/pages/P.tsx', '@/lib/phone', files)).toBe('src/lib/phone.ts')
    expect(resolveSpecifier('src/pages/P.tsx', '@/components/Card', files)).toBe('src/components/Card.tsx')
  })
  it('resolves a directory to its index file', () => {
    expect(resolveSpecifier('src/App.tsx', './hooks', files)).toBe('src/hooks/index.ts')
  })
  it('maps a .js specifier to the .ts source (nodenext style)', () => {
    expect(resolveSpecifier('scripts/loop/guard.ts', './evidence.js', files)).toBe('scripts/loop/evidence.ts')
  })
  it('keeps an exact non-code path', () => {
    expect(resolveSpecifier('src/main.tsx', './index.css', files)).toBe('src/index.css')
  })
  it('returns null for packages and for paths that do not resolve', () => {
    expect(resolveSpecifier('src/App.tsx', 'react', files)).toBeNull()
    expect(resolveSpecifier('src/App.tsx', '@types/node', files)).toBeNull()
    expect(resolveSpecifier('src/App.tsx', './missing', files)).toBeNull()
  })
})

describe('areaOf', () => {
  it.each([
    ['src/components/letters/X.tsx', 'src/components'],
    ['src/hooks/useA.ts', 'src/hooks'],
    ['src/locales/he.json', 'src/locales'],
    ['src/types.ts', 'src'],
    ['server/routes/admin.ts', 'server/routes'],
    ['server/services/auth-providers/dev.ts', 'server/services'],
    ['server/lib/x.ts', 'server/lib'],
    ['server/index.ts', 'server'],
    ['scripts/loop/guard.ts', 'scripts'],
    ['tests/unit/loop/guard.test.ts', 'tests'],
    ['vite.config.ts', '(root)'],
  ])('%s -> %s', (file, area) => {
    expect(areaOf(file)).toBe(area)
  })
})

describe('isScannedFile', () => {
  it('scans code files only', () => {
    expect(isScannedFile('src/App.tsx')).toBe(true)
    expect(isScannedFile('scripts/x.mjs')).toBe(true)
    expect(isScannedFile('src/data/site.json')).toBe(false)
    expect(isScannedFile('server/db/migrations/0001.sql')).toBe(false)
    expect(isScannedFile('src/vite-env.d.ts')).toBe(false)
  })
})

describe('buildEdges and newEdges', () => {
  const tree = new Map([
    ['src/components/A.tsx', "import { useX } from '@/hooks/useX'\nimport { b } from './B'"],
    ['src/components/B.tsx', ''],
    ['src/hooks/useX.ts', "import type { T } from '../types'"],
    ['src/types.ts', ''],
    ['tests/unit/a.test.ts', "import { A } from '../../src/components/A'"],
  ])

  it('keeps only cross-area edges and skips importers under tests/', () => {
    const edges = buildEdges(tree)
    expect(edges).toEqual([
      { fromFile: 'src/components/A.tsx', toFile: 'src/hooks/useX.ts', fromArea: 'src/components', toArea: 'src/hooks' },
      { fromFile: 'src/hooks/useX.ts', toFile: 'src/types.ts', fromArea: 'src/hooks', toArea: 'src' },
    ])
  })

  it('reports edges on HEAD that base does not have', () => {
    const base = buildEdges(new Map([...tree, ['src/components/A.tsx', "import { b } from './B'"]]))
    const head = buildEdges(tree)
    expect(newEdges(base, head).map((e) => e.toFile)).toEqual(['src/hooks/useX.ts'])
  })

  it('counts one file importing another twice as one edge', () => {
    const edges = buildEdges(new Map([
      ['src/pages/P.tsx', "import a from '@/lib/l'\nimport type { b } from '@/lib/l'"],
      ['src/lib/l.ts', ''],
    ]))
    expect(edges).toHaveLength(1)
  })
})

const edge = (fromFile: string, toFile: string): Edge => ({
  fromFile, toFile, fromArea: areaOf(fromFile), toArea: areaOf(toFile),
})

describe('layeringViolation', () => {
  it('src never imports server', () => {
    expect(layeringViolation(edge('src/hooks/a.ts', 'server/services/b.ts'))).toMatch(/src\/ never imports server/)
  })
  it('server may import src/types.ts and the two shared lib helpers only', () => {
    expect(layeringViolation(edge('server/routes/a.ts', 'src/types.ts'))).toBeNull()
    expect(layeringViolation(edge('server/services/a.ts', 'src/lib/letter-urls.ts'))).toBeNull()
    expect(layeringViolation(edge('server/services/a.ts', 'src/lib/phone.ts'))).toBeNull()
    expect(layeringViolation(edge('server/services/a.ts', 'src/lib/other.ts'))).toMatch(/server\/ imports from src\/ only/)
    expect(layeringViolation(edge('server/services/a.ts', 'src/hooks/useA.ts'))).toMatch(/server\/ imports from src\/ only/)
  })
  it('only server/index.ts imports a route', () => {
    expect(layeringViolation(edge('server/index.ts', 'server/routes/a.ts'))).toBeNull()
    expect(layeringViolation(edge('server/services/x.ts', 'server/routes/a.ts'))).toMatch(/only server\/index.ts/)
  })
  it('routes do not import server/db', () => {
    expect(layeringViolation(edge('server/routes/a.ts', 'server/db/index.ts'))).toMatch(/routes do not import server\/db/)
  })
  it('repositories do not import services, except the three known ones', () => {
    expect(layeringViolation(edge('server/repositories/a.ts', 'server/services/b.ts'))).toMatch(/repositories do not import services/)
    expect(KNOWN_EXCEPTIONS).toHaveLength(3)
    for (const k of KNOWN_EXCEPTIONS) expect(layeringViolation(edge(k.fromFile, k.toFile))).toBeNull()
  })
  it('allows the ordinary directions', () => {
    expect(layeringViolation(edge('server/routes/a.ts', 'server/services/b.ts'))).toBeNull()
    expect(layeringViolation(edge('server/services/a.ts', 'server/repositories/b.ts'))).toBeNull()
    expect(layeringViolation(edge('src/components/a.tsx', 'src/hooks/b.ts'))).toBeNull()
  })
  it('never checks importers under tests/', () => {
    expect(layeringViolation(edge('tests/server/a.test.ts', 'server/routes/a.ts'))).toBeNull()
  })
})

describe('addedPackages', () => {
  it('lists names new to dependencies or devDependencies, ignoring moves and bumps', () => {
    const base = { dependencies: { react: '^18.0.0', zod: '^3.0.0' }, devDependencies: { vitest: '^1' } }
    const head = {
      dependencies: { react: '^18.3.0', 'left-pad': '^1.3.0' },
      devDependencies: { vitest: '^1', zod: '^3.0.0', '@types/x': '^2' },
    }
    expect(addedPackages(base, head)).toEqual([
      { name: '@types/x', version: '^2', dev: true },
      { name: 'left-pad', version: '^1.3.0', dev: false },
    ])
  })
  it('treats a missing base package.json as empty', () => {
    expect(addedPackages(null, { dependencies: { a: '1' } })).toEqual([{ name: 'a', version: '1', dev: false }])
  })
})

describe('parsePlan', () => {
  it('reads "none"', () => {
    expect(parsePlan('- **Risky areas:** none\n- **New dependencies:** none\n- **Approach** x')).toEqual({ none: true, items: [] })
  })
  it('treats no line at all as nothing declared', () => {
    expect(parsePlan('# plan\nno deps line')).toEqual({ none: true, items: [] })
  })
  it('reads the inline rest and the nested sub-bullets, stopping at the next top-level bullet', () => {
    const plan = [
      '- **Risky areas:** none',
      '- **New dependencies:** `zod@3.23` for schema checks',
      '  - **Packages:** none beyond zod',
      '  - **Cross-module dependencies:**',
      '    - `src/components → src/hooks`: the card uses the hook',
      '    - `server/repositories/a.ts -> server/services/b.ts`: layering exception, pure helper with no I/O',
      '- **Approach** something with src/x → src/y in it',
    ].join('\n')
    const parsed = parsePlan(plan)
    expect(parsed.none).toBe(false)
    // `none beyond zod` is a none-item and declares nothing; zod comes from the inline rest
    expect(parsed.items).toHaveLength(3)
    expect(parsed.items.some((i) => i.includes('src/x'))).toBe(false)
  })
  it('accepts a non-bullet line followed by an unindented list', () => {
    const parsed = parsePlan('**New dependencies:**\n- `left-pad`\n- src/pages -> src/lib\n\n## Next')
    expect(parsed.items).toEqual(['`left-pad`', 'src/pages -> src/lib'])
  })
})

describe('packageDeclared', () => {
  const plan = parsePlan('- **New dependencies:** `zod@^3.23` (why), @types/node, react')
  it('matches a whole package name, with or without a version or backticks', () => {
    expect(packageDeclared('zod', plan)).toBe(true)
    expect(packageDeclared('@types/node', plan)).toBe(true)
    expect(packageDeclared('react', plan)).toBe(true)
  })
  it('does not let a name match a longer one', () => {
    expect(packageDeclared('react-dom', plan)).toBe(false)
    expect(packageDeclared('node', plan)).toBe(false)
    expect(packageDeclared('zo', plan)).toBe(false)
  })
  it('does not let a none-item declare what its reason mentions', () => {
    const p = parsePlan('- **New dependencies:**\n  - **Packages:** none (considered date-fns, not needed)\n  - src/pages -> src/lib: formatting')
    expect(packageDeclared('date-fns', p)).toBe(false)
    expect(p.items).toEqual(['src/pages -> src/lib: formatting'])
  })
  it('declares nothing when the plan says none', () => {
    expect(packageDeclared('zod', parsePlan('**New dependencies:** none'))).toBe(false)
  })
})

describe('edgeDeclaration', () => {
  const plan = parsePlan([
    '- **New dependencies:**',
    '  - `src/components → src/hooks`: the card uses the hook',
    '  - @/pages/Home.tsx -> @/lib/format: date formatting',
    '  - server/repositories/a.ts => server/services/b: layering exception, pure helper with no I/O',
    '  - server/routes/x.ts → server/db: exception',
  ].join('\n'))

  it('matches by area on both sides', () => {
    expect(edgeDeclaration(edge('src/components/letters/X.tsx', 'src/hooks/useY.ts'), plan)).toEqual({ declared: true, exception: false })
  })
  it('matches by file path with optional extension and @/ alias', () => {
    expect(edgeDeclaration(edge('src/pages/Home.tsx', 'src/lib/format.ts'), plan).declared).toBe(true)
  })
  it('does not match the wrong direction or a near-miss path', () => {
    expect(edgeDeclaration(edge('src/hooks/useY.ts', 'src/components/X.tsx'), plan).declared).toBe(false)
    expect(edgeDeclaration(edge('src/pages/HomeOld.tsx', 'src/lib/format.ts'), plan).declared).toBe(false)
  })
  it('marks an exception only when the line says so and gives a reason', () => {
    expect(edgeDeclaration(edge('server/repositories/a.ts', 'server/services/b.ts'), plan)).toEqual({ declared: true, exception: true })
    expect(edgeDeclaration(edge('server/routes/x.ts', 'server/db/index.ts'), plan)).toEqual({ declared: true, exception: false })
  })
})

function ctx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    addedPackages: [], newEdges: [], plan: { none: true, items: [] },
    changedPaths: [], riskyDeclared: [], migrations: { added: [], edited: [], unjournaled: [] }, migrationRun: null,
    ...over,
  }
}

describe('evaluate', () => {
  it('passes with nothing new', () => {
    const r = evaluate(ctx())
    expect(r.verdict).toBe('pass')
  })
  it('fails on an undeclared package and passes once it is declared', () => {
    const pkgs = [{ name: 'zod', version: '^3', dev: false }]
    expect(evaluate(ctx({ addedPackages: pkgs })).verdict).toBe('fail')
    expect(evaluate(ctx({ addedPackages: pkgs, plan: parsePlan('**New dependencies:** zod') })).verdict).toBe('pass')
  })
  it('fails on an undeclared cross-area import', () => {
    const r = evaluate(ctx({ newEdges: [edge('src/components/A.tsx', 'src/hooks/b.ts')] }))
    expect(r.verdict).toBe('fail')
    expect(r.findings.find((f) => f.check === 'imports')?.status).toBe('undeclared')
  })
  it('fails on a declared layering break that is not an exception, and passes with one', () => {
    const e = [edge('server/repositories/a.ts', 'server/services/b.ts')]
    const declared = evaluate(ctx({ newEdges: e, plan: parsePlan('**New dependencies:** server/repositories -> server/services') }))
    expect(declared.verdict).toBe('fail')
    expect(declared.findings.find((f) => f.check === 'layering')?.status).toBe('violation')
    const excepted = evaluate(ctx({
      newEdges: e,
      plan: parsePlan('**New dependencies:** server/repositories -> server/services (exception: pure string helper)'),
    }))
    expect(excepted.verdict).toBe('pass')
    expect(excepted.findings.find((f) => f.check === 'layering')?.status).toBe('exception')
  })
  it('runs every check in CHECKS', () => {
    expect(CHECKS.map((c) => c.name)).toEqual([
      'packages', 'imports', 'layering', 'risky-areas', 'guardrails', 'migrations-apply', 'schema-adds',
    ])
  })
})

describe('guardLines', () => {
  it('prints a header per check, marks each finding, and has no blank lines', () => {
    const r = evaluate(ctx({
      addedPackages: [{ name: 'zod', version: '^3', dev: false }],
      newEdges: [edge('src/hooks/a.ts', 'server/services/b.ts')],
    }))
    const lines = guardLines(r, { scanned: { base: 10, head: 11 }, edges: { base: 4, head: 5 }, base: 'abc1234' })
    expect(lines).toContain('- packages added: 1')
    expect(lines).toContain('  - `zod@^3` (dependencies): undeclared')
    expect(lines).toContain('- new cross-area imports: 1')
    expect(lines).toContain('  - `src/hooks/a.ts` → `server/services/b.ts` (src/hooks → server/services): undeclared')
    expect(lines.some((l) => l.startsWith('- layering violations: 1'))).toBe(true)
    expect(lines.some((l) => l.includes('violation') && l.includes('src/ never imports server/'))).toBe(true)
    expect(lines).not.toContain('')
    const block = formatEvidenceBlock({ command: 'guard', verdict: r.verdict, commit: 'abc', dirty: false, lines })
    expect(findEvidenceBlock(`${block}\n\nafter`, 'guard')).toBe(block)
  })
  it('says none for empty sections', () => {
    const lines = guardLines(evaluate(ctx()), { scanned: { base: 1, head: 1 }, edges: { base: 0, head: 0 }, base: 'abc' })
    expect(lines).toContain('- packages added: none')
    expect(lines).toContain('- new cross-area imports: none')
    expect(lines).toContain('- layering violations: none')
  })
})

describe('riskyAreasOf', () => {
  it.each([
    ['server/db/migrations/0030_x.sql', ['migrations']],
    ['server/db/migrations/meta/_journal.json', ['migrations']],
    ['server/db/schema/letters.ts', ['migrations']],
    ['server/db/migrate.ts', ['migrations']],
    ['drizzle.config.ts', ['migrations']],
    ['server/db/schema/auth.ts', ['migrations', 'auth']],
    ['server/routes/auth.ts', ['auth']],
    ['server/services/auth-service.ts', ['auth']],
    ['server/services/auth-providers/dev.ts', ['auth']],
    ['server/middleware/auth.ts', ['auth']],
    ['server/repositories/auth-repository.ts', ['auth']],
    ['server/routes/admin.ts', ['auth']],
    ['.github/workflows/ci.yml', ['ci-deploy']],
    ['render.yaml', ['ci-deploy']],
    ['.env.example', ['ci-deploy']],
    ['scripts/seed-db.ts', ['prod-data']],
    ['scripts/seed-data/bills.json', ['prod-data']],
    ['scripts/backfill-channels.ts', ['prod-data']],
    ['scripts/import-mk-contacts.ts', ['prod-data']],
    ['scripts/migrate-media.ts', ['prod-data']],
    ['scripts/regen-share-pages.ts', ['prod-data']],
  ])('%s -> %j', (file, areas) => {
    expect(riskyAreasOf(file)).toEqual(areas)
  })
  it.each([
    'server/routes/admin-letters.ts', 'server/services/letter-utils.ts', 'src/components/AuthButton.tsx',
    'scripts/smoke.ts', 'docker-compose.yml', 'tests/server/auth/auth-route.test.ts', 'docs/architecture.md',
  ])('%s is not risky', (file) => {
    expect(riskyAreasOf(file)).toEqual([])
  })
})

describe('parseRiskyAreas', () => {
  it('reads none, and no line as none', () => {
    expect(parseRiskyAreas('- **Risky areas:** none\n- **New dependencies:** none')).toEqual([])
    expect(parseRiskyAreas('# plan')).toEqual([])
  })
  it('accepts the spec names and forgiving synonyms, inline or as sub-bullets', () => {
    expect(parseRiskyAreas('- **Risky areas:** migrations, auth')).toEqual(['migrations', 'auth'])
    expect(parseRiskyAreas('- **Risky areas:** CI and deploy configuration; production data script')).toEqual(['ci-deploy', 'prod-data'])
    expect(parseRiskyAreas([
      '- **Risky areas:**',
      '  - DB migration (adds a column)',
      '  - access control: a new admin check',
      '  - a backfill script for the new column',
      '  - the GitHub workflow',
      '- **New dependencies:** none',
    ].join('\n'))).toEqual(['migrations', 'auth', 'ci-deploy', 'prod-data'])
  })
  it('reads a None line with its reason as none', () => {
    expect(parseRiskyAreas('- **Risky areas:** None — no migrations, auth or CI changes')).toEqual([])
    expect(parseRiskyAreas('- **Risky areas:**\n  - `none`: no schema or deploy change')).toEqual([])
  })
  it('does not read the next field', () => {
    expect(parseRiskyAreas('- **Risky areas:** none\n- **Approach** touches the auth flow')).toEqual([])
  })
})

describe('isGuardrailPath', () => {
  it.each([
    'scripts/loop/guard.ts', 'scripts/loop/PROMPT.md', '.claude/agents/code-reviewer.md', '.claude/settings.json',
    'docs/agents/backlog-rules.md', '.github/workflows/pr-review.yml', '.github/workflows/claude-code-review.yml',
    '.github/workflows/claude.yml', 'scripts/loop-read-views.sql',
  ])('%s is a guardrail', (file) => {
    expect(isGuardrailPath(file)).toBe(true)
  })
  it.each(['.github/workflows/ci.yml', 'scripts/loop-other.ts', 'docs/agents.md', 'tests/unit/loop/guard.test.ts', 'scripts/loopy/x.ts'])(
    '%s is not', (file) => {
      expect(isGuardrailPath(file)).toBe(false)
    },
  )
})

describe('stripSqlComments', () => {
  it('removes line and block comments and string contents', () => {
    const out = stripSqlComments("-- DROP TABLE a\nSELECT 1; /* DROP\nCOLUMN */ INSERT INTO t VALUES ('drop table x', 'it''s');--> statement-breakpoint")
    expect(out).not.toMatch(/drop/i)
    expect(out).toContain('INSERT INTO t VALUES')
  })
})

describe('destructiveStatements', () => {
  it('flags drops of tables, columns, schemas, views and types', () => {
    const sql = [
      'ALTER TABLE "sent_emails" DROP COLUMN "subject";--> statement-breakpoint',
      'DROP TABLE IF EXISTS "old";',
      'DROP SCHEMA "letters" CASCADE;',
      'DROP VIEW v;',
      'DROP TYPE "public"."kind";',
    ].join('\n')
    expect(destructiveStatements(sql).map((f) => f.reason)).toEqual([
      'drop column', 'drop table', 'drop schema', 'drop view', 'drop type',
    ])
  })
  it('flags renames and type changes', () => {
    const sql = [
      'ALTER TABLE a RENAME TO b;',
      'ALTER TABLE a RENAME COLUMN x TO y;',
      'ALTER TABLE "a" ALTER COLUMN "n" SET DATA TYPE bigint;',
      'ALTER TABLE a ALTER COLUMN n TYPE text USING n::text;',
    ].join('\n')
    expect(destructiveStatements(sql).map((f) => f.reason)).toEqual(['rename', 'rename', 'type change', 'type change'])
  })
  it('allows additive and relaxing statements', () => {
    const sql = [
      'CREATE TABLE "x" ("id" serial PRIMARY KEY, "type" text);',
      'ALTER TABLE "x" ADD COLUMN "kind" text;',
      'ALTER TABLE "l" ALTER COLUMN "email" DROP NOT NULL;',
      'ALTER TABLE "l" ALTER COLUMN "email" DROP DEFAULT;',
      'ALTER TABLE "l" DROP CONSTRAINT IF EXISTS "c";',
      'DROP INDEX IF EXISTS "i";',
      "INSERT INTO t (body) VALUES ('please drop table users');",
      '-- DROP TABLE commented_out;',
    ].join('\n')
    expect(destructiveStatements(sql)).toEqual([])
  })
  it('allows the loop_read reset the repo requires, and nothing broader', () => {
    expect(destructiveStatements('DROP SCHEMA loop_read CASCADE;\nALTER TABLE a ADD COLUMN b int;')).toEqual([])
    expect(destructiveStatements('DROP SCHEMA IF EXISTS "loop_read" CASCADE;')).toEqual([])
    expect(destructiveStatements('DROP SCHEMA loop_read, letters CASCADE;')).toHaveLength(1)
  })
  it('shows the statement on one line', () => {
    const [f] = destructiveStatements('ALTER TABLE "a"\n  DROP COLUMN "b";')
    expect(f.statement).toBe('ALTER TABLE "a" DROP COLUMN "b"')
  })
})

describe('migrationChanges', () => {
  it('lists added and edited migration SQL files, ignoring meta files', () => {
    const base = new Map([
      ['server/db/migrations/0000_a.sql', 'CREATE TABLE a (id int);'],
      ['server/db/migrations/0001_b.sql', 'CREATE TABLE b (id int);'],
      ['server/db/migrations/meta/_journal.json', '{}'],
    ])
    const head = new Map([
      ['server/db/migrations/0000_a.sql', 'CREATE TABLE a (id int);'],
      ['server/db/migrations/0001_b.sql', 'CREATE TABLE b (id bigint);'],
      ['server/db/migrations/0002_c.sql', 'DROP TABLE a;'],
      ['server/db/migrations/meta/_journal.json', '{"x":1}'],
    ])
    expect(migrationChanges(base, head)).toEqual({
      added: [{ file: 'server/db/migrations/0002_c.sql', sql: 'DROP TABLE a;' }],
      edited: ['server/db/migrations/0001_b.sql'],
    })
  })
})

describe('unjournaledMigrations', () => {
  const journal = JSON.stringify({ entries: [{ tag: '0000_a' }, { tag: '0001_b' }] })
  it('lists SQL files the drizzle journal does not name (they would never be applied)', () => {
    expect(unjournaledMigrations(['server/db/migrations/0000_a.sql', 'server/db/migrations/0002_c.sql'], journal))
      .toEqual(['server/db/migrations/0002_c.sql'])
  })
  it('treats a missing or broken journal as naming nothing', () => {
    expect(unjournaledMigrations(['server/db/migrations/0000_a.sql'], null)).toEqual(['server/db/migrations/0000_a.sql'])
    expect(unjournaledMigrations(['server/db/migrations/0000_a.sql'], 'not json')).toEqual(['server/db/migrations/0000_a.sql'])
  })
})

describe('risky-area, guardrail and migration checks', () => {
  const statusOf = (c: GuardContext, check: string) => evaluate(c).findings.filter((f) => f.check === check).map((f) => f.status)

  it('fails on a risky area the plan does not list, passes once listed', () => {
    const changed = { changedPaths: ['server/db/migrations/0030_x.sql', 'src/App.tsx'] }
    expect(evaluate(ctx(changed)).verdict).toBe('fail')
    expect(statusOf(ctx(changed), 'risky-areas')).toEqual(['undeclared'])
    expect(evaluate(ctx({ ...changed, riskyDeclared: ['migrations'] })).verdict).toBe('pass')
  })
  it('reports one finding per area touched', () => {
    const c = ctx({ changedPaths: ['render.yaml', '.env.example', 'server/routes/auth.ts'], riskyDeclared: ['auth'] })
    const found = evaluate(c).findings.filter((f) => f.check === 'risky-areas')
    expect(found.map((f) => [f.subject.split(' ')[0], f.status])).toEqual([['auth', 'ok'], ['ci-deploy', 'undeclared']])
  })
  it('fails on any guardrail path, whatever the plan says', () => {
    const c = ctx({ changedPaths: ['scripts/loop/x.ts', 'docs/agents/backlog-rules.md'], riskyDeclared: ['ci-deploy'] })
    expect(statusOf(c, 'guardrails')).toEqual(['violation', 'violation'])
    expect(evaluate(c).verdict).toBe('fail')
  })
  it('reports the migration run: ok when all applied, a violation on an error', () => {
    expect(statusOf(ctx({ migrationRun: { ok: true, applied: 30, total: 30 } }), 'migrations-apply')).toEqual(['ok'])
    expect(statusOf(ctx({ migrationRun: { ok: true, applied: 29, total: 30 } }), 'migrations-apply')).toEqual(['violation'])
    const failed = ctx({ migrationRun: { ok: false, error: 'syntax error at or near "TABL"' } })
    expect(statusOf(failed, 'migrations-apply')).toEqual(['violation'])
    expect(evaluate(failed).findings.find((f) => f.check === 'migrations-apply')?.subject).toContain('syntax error')
  })
  it('flags a migration file the journal does not name', () => {
    const c = ctx({ migrations: { added: [], edited: [], unjournaled: ['server/db/migrations/0030_x.sql'] } })
    expect(statusOf(c, 'migrations-apply')).toEqual(['violation'])
  })
  it('fails on a destructive statement in a new migration and on an edited old one', () => {
    const c = ctx({
      riskyDeclared: ['migrations'],
      migrations: {
        added: [{ file: 'server/db/migrations/0030_x.sql', sql: 'ALTER TABLE a ADD COLUMN b int;\nALTER TABLE a DROP COLUMN c;' }],
        edited: ['server/db/migrations/0001_b.sql'],
        unjournaled: [],
      },
    })
    const found = evaluate(c).findings.filter((f) => f.check === 'schema-adds')
    expect(found.map((f) => f.status)).toEqual(['violation', 'violation'])
    expect(found[0].subject).toContain('drop column')
    expect(found[1].subject).toContain('0001_b.sql')
  })
  it('prints the migration run without a count, and passes an additive migration', () => {
    const c = ctx({
      riskyDeclared: ['migrations'],
      changedPaths: ['server/db/migrations/0030_x.sql'],
      migrations: { added: [{ file: 'server/db/migrations/0030_x.sql', sql: 'ALTER TABLE a ADD COLUMN b int;' }], edited: [], unjournaled: [] },
      migrationRun: { ok: true, applied: 31, total: 31 },
    })
    const r = evaluate(c)
    expect(r.verdict).toBe('pass')
    const lines = guardLines(r, { scanned: { base: 1, head: 1 }, edges: { base: 0, head: 0 }, base: 'abc' })
    expect(lines).toContain('- migrations apply:')
    expect(lines).toContain('  - 31 of 31 migration(s) applied to a fresh in-memory database: ok')
    expect(lines).toContain('- destructive migration statements: none')
    expect(lines).toContain('- guardrail paths changed: none')
    expect(lines.some((l) => l.startsWith('- risky areas touched: 1'))).toBe(true)
  })
})
