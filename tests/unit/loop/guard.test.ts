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
    expect(parsed.items).toHaveLength(4)
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
  return { addedPackages: [], newEdges: [], plan: { none: true, items: [] }, ...over }
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
    expect(CHECKS.map((c) => c.name)).toEqual(['packages', 'imports', 'layering'])
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
