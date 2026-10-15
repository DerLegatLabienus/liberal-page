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
  declaresNoRiskyArea,
  isGuardrailPath,
  stripSqlComments,
  destructiveStatements,
  migrationChanges,
  unjournaledMigrations,
  parseNulList,
  loopScriptChanges,
  packageJsonRiskyChanges,
  nonRegistrySources,
  journalTargets,
  stripJsComments,
  authGateFiles,
  prodDataScripts,
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
      { name: '@types/x', version: '^2', list: 'devDependencies' },
      { name: 'left-pad', version: '^1.3.0', list: 'dependencies' },
    ])
  })
  it('treats a missing base package.json as empty', () => {
    expect(addedPackages(null, { dependencies: { a: '1' } })).toEqual([{ name: 'a', version: '1', list: 'dependencies' }])
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
      '    - `server/repositories/a.ts -> server/services/b.ts`: exception: a pure string helper',
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
  const plan = parsePlan([
    '- **New dependencies:**',
    '  - `zod@^3.23` for schema checks',
    '  - @types/node, types for the scripts',
    '  - react',
    '  - left-pad is not needed, padStart covers it',
    '  - we use `lodash` without its types',
    '  - considered date-fns',
  ].join('\n'))
  it('matches a whole package name as the first token of an item, with or without a version or backticks', () => {
    expect(packageDeclared('zod', plan)).toBe(true)
    expect(packageDeclared('@types/node', plan)).toBe(true)
    expect(packageDeclared('react', plan)).toBe(true)
  })
  it('does not let a name match a longer one', () => {
    expect(packageDeclared('react-dom', plan)).toBe(false)
    expect(packageDeclared('node', plan)).toBe(false)
    expect(packageDeclared('zo', plan)).toBe(false)
  })
  it('only reads the first token, and never an item whose head holds a negation', () => {
    expect(packageDeclared('left-pad', plan)).toBe(false)
    expect(packageDeclared('lodash', plan)).toBe(false)
    expect(packageDeclared('date-fns', plan)).toBe(false)
    expect(packageDeclared('schema', plan)).toBe(false)
    expect(packageDeclared('zod', parsePlan('- **New dependencies:**\n  - not adding zod'))).toBe(false)
    expect(packageDeclared('zod', parsePlan('- **New dependencies:**\n  - zod is not needed'))).toBe(false)
  })
  it('reads a package written the way the spec asks, with why and why nothing existing covers it', () => {
    const spec = parsePlan([
      '- **New dependencies:**',
      '  - **Packages:**',
      "    - `zod@3.23.8` — validates the plan's input; no existing package does this and hand-rolled checks don't cover nesting",
      '    - date-fns@4.1.0: formats Hebrew dates (Intl alone does not give the Knesset format)',
    ].join('\n'))
    expect(packageDeclared('zod', spec)).toBe(true)
    expect(packageDeclared('date-fns', spec)).toBe(true)
  })
  it('does not declare a package named later in an inline list', () => {
    const inline = parsePlan('- **New dependencies:** `zod@^3.23` (why), @types/node, react')
    expect(packageDeclared('zod', inline)).toBe(true)
    expect(packageDeclared('react', inline)).toBe(false)
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
    '  - server/repositories/a.ts => server/services/b: exception: a pure string helper',
    '  - server/routes/x.ts → server/db: exception',
    '  - server/services/s.ts -> server/routes/r.ts: exception: two words',
    '  - server/repositories/c.ts -> server/services/d.ts: exception: it does not touch the database',
    "  - `server/routes/q.ts → server/db` — exception: needs a raw transaction the repository doesn't expose; avoiding it means a new repository method",
    '  - not server/routes/n.ts -> server/db',
    '  - the hook now uses src/contexts -> src/lib',
    '  - `src/pages -> src/hooks` is not needed any more',
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
  it('needs `exception:` and a reason of at least three words', () => {
    expect(edgeDeclaration(edge('server/services/s.ts', 'server/routes/r.ts'), plan)).toEqual({ declared: true, exception: false })
  })
  it('accepts a reason written with negations, as the spec asks (why it is needed, what avoiding it takes)', () => {
    expect(edgeDeclaration(edge('server/repositories/c.ts', 'server/services/d.ts'), plan)).toEqual({ declared: true, exception: true })
    expect(edgeDeclaration(edge('server/routes/q.ts', 'server/db/index.ts'), plan)).toEqual({ declared: true, exception: true })
  })
  it('declares nothing when the negation is in the head', () => {
    expect(edgeDeclaration(edge('server/routes/n.ts', 'server/db/index.ts'), plan).declared).toBe(false)
  })
  it('only reads a pair at the start of an item, and never one with a negation', () => {
    expect(edgeDeclaration(edge('src/contexts/C.tsx', 'src/lib/l.ts'), plan).declared).toBe(false)
    expect(edgeDeclaration(edge('src/pages/P.tsx', 'src/hooks/h.ts'), plan).declared).toBe(false)
  })
})

function ctx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    addedPackages: [], newEdges: [], plan: { none: true, items: [] },
    changedPaths: [], riskyDeclared: [], migrations: { added: [], edited: [], unjournaled: [] }, migrationRun: null,
    riskyUnclear: [], extraRisky: [], loopScriptChanges: [], nonRegistry: [], journalOutside: [],
    ...over,
  }
}

describe('evaluate', () => {
  it('passes with nothing new', () => {
    const r = evaluate(ctx())
    expect(r.verdict).toBe('pass')
  })
  it('fails on an undeclared package and passes once it is declared', () => {
    const pkgs = [{ name: 'zod', version: '^3', list: 'dependencies' }]
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
      addedPackages: [{ name: 'zod', version: '^3', list: 'dependencies' }],
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
  const r = (md: string) => parseRiskyAreas(md)
  it('reads none, a none with a reason, and no line as nothing', () => {
    expect(r('- **Risky areas:** none\n- **New dependencies:** none')).toEqual({ areas: [], unclear: [] })
    expect(r('# plan')).toEqual({ areas: [], unclear: [] })
    for (const none of ['None — no schema change', 'none - nothing risky', 'none: docs only', 'None (docs only)', '`none`.']) {
      expect(r(`- **Risky areas:** ${none}`)).toEqual({ areas: [], unclear: [] })
    }
  })
  it('accepts exact area names and listed aliases, inline or as sub-bullets', () => {
    expect(r('- **Risky areas:** migrations, auth')).toEqual({ areas: ['migrations', 'auth'], unclear: [] })
    expect(r('- **Risky areas:** CI and deploy configuration; production data script.')).toEqual({ areas: ['ci-deploy', 'prod-data'], unclear: [] })
    expect(r([
      '- **Risky areas:**',
      '  - Database migrations',
      '  - `access control`',
      '  - prod-data',
      '  - deploy',
      '- **New dependencies:** none',
    ].join('\n'))).toEqual({ areas: ['migrations', 'auth', 'ci-deploy', 'prod-data'], unclear: [] })
  })
  it('reports anything else as unclear, naming the item', () => {
    expect(r('- **Risky areas:** DB migration (adds a column)')).toEqual({ areas: [], unclear: ['DB migration (adds a column)'] })
    expect(r('- **Risky areas:** migrations; no auth changes')).toEqual({ areas: ['migrations'], unclear: ['no auth changes'] })
    expect(r('- **Risky areas:** None — no migrations, auth or CI changes')).toEqual({ areas: [], unclear: [] })
    expect(r('- **Risky areas:** none\n  - auth').unclear).toEqual(['none, together with areas'])
  })
  it('does not read the next field', () => {
    expect(r('- **Risky areas:** none\n- **Approach** touches the auth flow')).toEqual({ areas: [], unclear: [] })
  })
})

describe('labelled lines stop at another label', () => {
  it('a plain Risky areas line stops at a New dependencies line below it', () => {
    const md = '**Risky areas:**\n- auth\n**New dependencies:** zod\n- react'
    expect(parseRiskyAreas(md)).toEqual({ areas: ['auth'], unclear: [] })
    expect(packageDeclared('zod', parsePlan(md))).toBe(true)
    expect(packageDeclared('react', parsePlan(md))).toBe(true)
  })
  it('a New dependencies list stops at a Risky areas line nested inside it, and the reverse', () => {
    const md = '- **New dependencies:**\n  - zod\n  - **Risky areas:** auth\n  - react'
    expect(parsePlan(md).items).toEqual(['zod'])
    expect(parseRiskyAreas(md).areas).toEqual(['auth'])
    const md2 = '- **Risky areas:**\n  - auth\n  - **New dependencies:** zod'
    expect(parseRiskyAreas(md2)).toEqual({ areas: ['auth'], unclear: [] })
    expect(packageDeclared('zod', parsePlan(md2))).toBe(true)
  })
  it('keeps the sub-labels of New dependencies', () => {
    const md = '- **New dependencies:**\n  - **Packages:** zod\n  - **Cross-module dependencies:** src/pages -> src/lib'
    expect(parsePlan(md).items).toEqual(['zod', 'src/pages -> src/lib'])
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

describe('review fixes: paths', () => {
  it('splits NUL-separated git output, keeping Hebrew names and quotes as they are', () => {
    const files = parseNulList('.claude/שלום.md\0.claude/a"b.md\0src/App.tsx\0')
    expect(files).toEqual(['.claude/שלום.md', '.claude/a"b.md', 'src/App.tsx'])
    expect(files.slice(0, 2).every(isGuardrailPath)).toBe(true)
    expect(parseNulList('')).toEqual([])
  })
})

describe('loopScriptChanges', () => {
  it('lists loop:* scripts added, removed or changed', () => {
    const base = { scripts: { 'loop:guard': 'tsx scripts/loop/guard.ts', 'loop:sql': 'tsx a', build: 'vite build' } }
    const head = { scripts: { 'loop:guard': 'echo ok', 'loop:new': 'x', build: 'vite build --x' } }
    expect(loopScriptChanges(base, head)).toEqual(['loop:guard', 'loop:new', 'loop:sql'])
    expect(loopScriptChanges(base, base)).toEqual([])
  })
})

describe('packageJsonRiskyChanges', () => {
  it('counts non-loop script changes, install hooks, overrides and resolutions as CI and deploy', () => {
    const base = { scripts: { build: 'vite build', 'loop:x': 'a' }, overrides: { a: '1' } }
    const head = { scripts: { build: 'vite build && x', postinstall: 'curl evil', 'loop:x': 'b' }, overrides: { a: '2' }, resolutions: { b: '1' } }
    expect(packageJsonRiskyChanges(base, head)).toEqual([
      'package.json scripts.build',
      'package.json scripts.postinstall (install hook)',
      'package.json overrides',
      'package.json resolutions',
    ])
    expect(packageJsonRiskyChanges(head, head)).toEqual([])
  })
})

describe('addedPackages and nonRegistrySources across all four lists', () => {
  it('reads optionalDependencies and peerDependencies too', () => {
    expect(addedPackages({}, { optionalDependencies: { a: '1' }, peerDependencies: { b: '2' } })).toEqual([
      { name: 'a', version: '1', list: 'optionalDependencies' },
      { name: 'b', version: '2', list: 'peerDependencies' },
    ])
  })
  it('flags a dependency added or switched to a source outside the registry', () => {
    const base = { dependencies: { a: '^1', b: '^1', c: '^1' }, devDependencies: { d: '^1' } }
    const head = {
      dependencies: { a: 'git+https://example.com/a.git', b: '^2', c: 'npm:evil@1', e: 'github:x/e' },
      devDependencies: { d: 'file:../d' },
      peerDependencies: { f: 'https://example.com/f.tgz', g: 'link:../g', h: 'owner/repo' },
    }
    expect(nonRegistrySources(base, head).map((p) => p.name)).toEqual(['a', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(nonRegistrySources(base, { dependencies: { a: '^1', b: '~1.2.0', c: 'latest' } })).toEqual([])
  })
})

describe('type changes and drops (review fixes)', () => {
  const reasons = (sql: string) => destructiveStatements(sql).map((f) => f.reason)
  it('catches a type change without the COLUMN keyword and with a quoted name holding a space', () => {
    expect(reasons('ALTER TABLE a ALTER n TYPE bigint;')).toEqual(['type change'])
    expect(reasons('ALTER TABLE "a" ALTER COLUMN "my col" SET DATA TYPE text;')).toEqual(['type change'])
    expect(reasons('ALTER TABLE "a" ALTER "my col" TYPE text;')).toEqual(['type change'])
  })
  it('flags every DROP except index, constraint, not null, default and the loop_read reset', () => {
    expect(reasons('DROP FUNCTION f();')).toEqual(['drop function'])
    expect(reasons('DROP TRIGGER t ON x;')).toEqual(['drop trigger'])
    expect(reasons('DROP POLICY p ON x;')).toEqual(['drop policy'])
    expect(reasons('ALTER TABLE a ALTER COLUMN b DROP IDENTITY;')).toEqual(['drop identity'])
    expect(reasons('ALTER TABLE a DROP "c";')).toEqual(['drop column'])
    expect(reasons('ALTER TABLE a DROP IF EXISTS c;')).toEqual(['drop column'])
    expect(reasons('DROP INDEX CONCURRENTLY i; ALTER TABLE a DROP CONSTRAINT c; ALTER TABLE a ALTER b DROP NOT NULL; ALTER TABLE a ALTER b DROP DEFAULT;')).toEqual([])
  })
  it('flags TRUNCATE and DELETE FROM, not ON DELETE in a foreign key', () => {
    expect(reasons('TRUNCATE "letters"."letters";')).toEqual(['truncate'])
    expect(reasons('DELETE FROM users WHERE id = 1;')).toEqual(['delete'])
    expect(reasons('ALTER TABLE a ADD CONSTRAINT f FOREIGN KEY (b) REFERENCES c(id) ON DELETE CASCADE;')).toEqual([])
  })
})

describe('the SQL scanner (review fixes)', () => {
  const reasons = (sql: string) => destructiveStatements(sql).map((f) => f.reason)
  it("handles E'…' strings with backslash escapes", () => {
    expect(reasons("INSERT INTO t VALUES (E'it\\'s; drop table x');")).toEqual([])
    expect(stripSqlComments("SELECT E'a\\'b' || 'c'")).not.toContain('b')
  })
  it('scans the body of a dollar-quoted block instead of skipping it', () => {
    expect(reasons('DO $$ BEGIN ALTER TABLE a DROP COLUMN b; END $$;')).toEqual(['drop column'])
    expect(reasons('DO $body$ BEGIN TRUNCATE a; END $body$;')).toEqual(['truncate'])
    expect(reasons('CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;')).toEqual([])
  })
  it('flags any EXECUTE (dynamic SQL cannot be checked)', () => {
    expect(reasons("DO $$ BEGIN EXECUTE 'DROP TABLE ' || 'x'; END $$;")).toEqual(['dynamic SQL (EXECUTE)'])
  })
})

describe('journalTargets', () => {
  it('maps tags to SQL files, nested folders included, and reports tags that leave the folder', () => {
    const journal = JSON.stringify({ entries: [{ tag: '0000_a' }, { tag: 'sub/0001_b' }, { tag: '../../../scripts/x' }, { tag: '/etc/x' }] })
    expect(journalTargets(journal)).toEqual({
      files: ['server/db/migrations/0000_a.sql', 'server/db/migrations/sub/0001_b.sql'],
      outside: ['../../../scripts/x', '/etc/x'],
    })
  })
  it('counts a nested SQL file as journaled when its tag names it', () => {
    const journal = JSON.stringify({ entries: [{ tag: 'sub/0001_b' }] })
    expect(unjournaledMigrations(['server/db/migrations/sub/0001_b.sql', 'server/db/migrations/sub/0002_c.sql'], journal))
      .toEqual(['server/db/migrations/sub/0002_c.sql'])
  })
  it('treats nested migration files as migrations when added or edited', () => {
    const head = new Map([['server/db/migrations/sub/0002_c.sql', 'DROP TABLE a;']])
    expect(migrationChanges(new Map(), head).added.map((a) => a.file)).toEqual(['server/db/migrations/sub/0002_c.sql'])
  })
})

describe('stripJsComments and the import scan (review fixes)', () => {
  it('drops imports that only appear in comments', () => {
    const src = "// import a from './a'\n/* import b from './b' */\nimport c from './c'"
    expect(extractSpecifiers(src)).toEqual(['./c'])
  })
  it('keeps strings that contain comment markers', () => {
    const src = "const u = 'http://x.test/*'\nimport d from './d'\nconst v = \"a // b\""
    expect(stripJsComments(src)).toContain("'http://x.test/*'")
    expect(extractSpecifiers(src)).toEqual(['./d'])
  })
  it('keeps a regex literal holding comment markers', () => {
    const src = "const r = /\\/\\*+/g\nimport e from './e'\nconst s = /a/ // trailing\n"
    expect(extractSpecifiers(src)).toEqual(['./e'])
  })
  it('accepts backtick strings without ${ and a comment before the string in import()', () => {
    expect(extractSpecifiers("import f from `./f`\nconst g = import(/* webpackChunkName: 'g' */ './g')\nconst h = import(`./h/${x}`)"))
      .toEqual(['./f', './g'])
    expect(extractSpecifiers("vi.mock(`../../server/x`)")).toEqual(['../../server/x'])
  })
})

describe('authGateFiles', () => {
  it('lists files whose diff adds or removes a line using an auth gate', () => {
    const diff = [
      'diff --git a/server/routes/bills.ts b/server/routes/bills.ts',
      '--- a/server/routes/bills.ts',
      '+++ b/server/routes/bills.ts',
      '@@ -10 +10 @@',
      "-router.get('/x', requireAuth, handler)",
      "+router.get('/x', handler)",
      'diff --git a/server/routes/mks.ts b/server/routes/mks.ts',
      '--- a/server/routes/mks.ts',
      '+++ b/server/routes/mks.ts',
      '@@ -1 +1 @@',
      '-const a = 1',
      '+const a = 2',
      ' requireAdmin context line',
      'diff --git a/server/routes/old.ts b/server/routes/old.ts',
      '--- a/server/routes/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      "-router.use(requireAdmin)",
      'diff --git a/server/routes/new.ts b/server/routes/new.ts',
      '--- /dev/null',
      '+++ b/server/routes/new.ts',
      '@@ -0,0 +1 @@',
      '+router.get("/y", optionalAuth, h)',
    ].join('\n')
    expect(authGateFiles(diff)).toEqual(['server/routes/bills.ts', 'server/routes/old.ts', 'server/routes/new.ts'])
  })
})

describe('more auth and prod-data paths', () => {
  it('counts the users repository and role/allowlist/refresh-token/invite services as auth', () => {
    expect(riskyAreasOf('server/repositories/users-repository.ts')).toEqual(['auth'])
    expect(riskyAreasOf('server/services/role-check.ts')).toEqual(['auth'])
    expect(riskyAreasOf('server/repositories/allowlist-repository.ts')).toEqual(['auth'])
    expect(riskyAreasOf('server/services/refresh-token-store.ts')).toEqual(['auth'])
    expect(riskyAreasOf('server/services/invite-mailer.ts')).toEqual(['auth'])
    expect(riskyAreasOf('server/services/committee-list-refresh.ts')).toEqual([])
  })
  it('counts a changed script that imports server/db or a repository as a production data script', () => {
    const edges = [
      edge('scripts/regen.ts', 'server/repositories/letters-repository.ts'),
      edge('scripts/one-off.ts', 'server/db/client.ts'),
      edge('scripts/loop/x.ts', 'server/db/client.ts'),
      edge('scripts/smoke.ts', 'server/services/a.ts'),
      edge('scripts/unchanged.ts', 'server/db/client.ts'),
    ]
    expect(prodDataScripts(['scripts/regen.ts', 'scripts/one-off.ts', 'scripts/loop/x.ts', 'scripts/smoke.ts'], edges))
      .toEqual(['scripts/one-off.ts', 'scripts/regen.ts'])
  })
})

describe('review-fix checks', () => {
  const found = (c: GuardContext, check: string) => evaluate(c).findings.filter((f) => f.check === check)
  it('fails on an unclear Risky areas item, naming it', () => {
    const f = found(ctx({ riskyUnclear: ['DB migration (adds a column)'] }), 'risky-areas')
    expect(f.map((x) => x.status)).toEqual(['unclear'])
    expect(f[0].subject).toContain('DB migration (adds a column)')
    expect(evaluate(ctx({ riskyUnclear: ['x'] })).verdict).toBe('fail')
  })
  it('adds risky paths that come from the diff or package.json, not only from the path name', () => {
    const c = ctx({ extraRisky: [{ area: 'auth', path: 'server/routes/bills.ts' }, { area: 'ci-deploy', path: 'package.json scripts.build' }] })
    expect(found(c, 'risky-areas').map((x) => [x.subject.split(' ')[0], x.status])).toEqual([['auth', 'undeclared'], ['ci-deploy', 'undeclared']])
    expect(evaluate({ ...c, riskyDeclared: ['auth', 'ci-deploy'] }).verdict).toBe('pass')
  })
  it('treats a loop:* script change as a guardrail violation', () => {
    const f = found(ctx({ loopScriptChanges: ['loop:guard'] }), 'guardrails')
    expect(f.map((x) => x.status)).toEqual(['violation'])
    expect(f[0].subject).toContain('loop:guard')
  })
  it('fails on a package from outside the registry, whatever the plan says', () => {
    const c = ctx({
      nonRegistry: [{ name: 'a', version: 'git+https://e/a.git', list: 'dependencies' }],
      plan: parsePlan('**New dependencies:** a'),
    })
    expect(found(c, 'packages').map((x) => x.status)).toEqual(['violation'])
  })
  it('fails on a journal tag outside the migrations folder', () => {
    expect(found(ctx({ journalOutside: ['../../x'] }), 'migrations-apply').map((x) => x.status)).toEqual(['violation'])
  })
})

describe('declaresNoRiskyArea', () => {
  it('is true only for an explicit none', () => {
    expect(declaresNoRiskyArea('### loop — plan\n\n**Risky areas:** none\n**New dependencies:** none')).toBe(true)
    expect(declaresNoRiskyArea('**Risky areas:** None — no schema or auth change')).toBe(true)
  })
  it('is false when the line is missing, names an area, or is unclear', () => {
    expect(declaresNoRiskyArea('### loop — plan\n\n**New dependencies:** none')).toBe(false)
    expect(declaresNoRiskyArea('**Risky areas:** migrations')).toBe(false)
    expect(declaresNoRiskyArea('**Risky areas:** a small DB tweak')).toBe(false)
    expect(declaresNoRiskyArea('**Risky areas:** none, auth')).toBe(false)
  })
})
