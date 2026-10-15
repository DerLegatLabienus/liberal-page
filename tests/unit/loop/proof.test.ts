import { describe, it, expect } from 'vitest'
import {
  classifyBranch,
  compareRefactorTests,
  fixVerdict,
  formatFileResult,
  isTestFile,
  overlayPaths,
  normaliseTestText,
  parseArgs,
  parseRenames,
  proofLines,
  refactorVerdict,
  summariseRun,
  summariseSuite,
  type FileResult,
  type VitestJson,
} from '../../../scripts/loop/proof'

describe('isTestFile', () => {
  it('matches test files under tests/ only', () => {
    expect(isTestFile('tests/unit/loop/proof.test.ts')).toBe(true)
    expect(isTestFile('tests/components/letters/Card.test.tsx')).toBe(true)
    expect(isTestFile('tests/support/fixtures.ts')).toBe(false)
    expect(isTestFile('src/lib/thing.test.ts')).toBe(false)
    expect(isTestFile('tests/unit/notes.md')).toBe(false)
  })
})

describe('overlayPaths', () => {
  it('copies the branch’s committed tests/ files, support files included, but not deleted ones or code', () => {
    expect(overlayPaths(
      ['src/a.ts', 'tests/unit/a.test.ts', 'tests/support/fixtures.ts', 'tests/unit/gone.test.ts', 'docs/x.md'],
      ['tests/unit/gone.test.ts'],
    )).toEqual(['tests/unit/a.test.ts', 'tests/support/fixtures.ts'])
  })
})

describe('classifyBranch', () => {
  const base = { branch: 'fix/thing', refactor: false, deleted: [] as string[] }

  it('exempts a branch that changes only docs', () => {
    expect(classifyBranch({ ...base, paths: ['docs/a.md', 'README.md', 'docs/img/x.png'] }))
      .toEqual({ kind: 'docs-only', testFiles: [] })
  })

  it('does not exempt an empty diff', () => {
    expect(classifyBranch({ ...base, paths: [] }).kind).toBe('empty')
  })

  it('reports a code branch without test changes as no tests', () => {
    expect(classifyBranch({ ...base, paths: ['src/a.ts', 'docs/a.md'] }))
      .toEqual({ kind: 'no-tests', testFiles: [] })
  })

  it('does not count a deleted test file as a test change', () => {
    const r = classifyBranch({ ...base, paths: ['src/a.ts', 'tests/unit/a.test.ts'], deleted: ['tests/unit/a.test.ts'] })
    expect(r.kind).toBe('no-tests')
  })

  it('lists the added or changed test files of a fix', () => {
    expect(classifyBranch({ ...base, paths: ['src/a.ts', 'tests/unit/a.test.ts', 'tests/support/fixtures.ts'] }))
      .toEqual({ kind: 'fix', testFiles: ['tests/unit/a.test.ts'] })
  })

  it('treats a refactor/ branch or the flag as a refactor, even with no test changes', () => {
    expect(classifyBranch({ ...base, branch: 'refactor/split', paths: ['src/a.ts'] }).kind).toBe('refactor')
    expect(classifyBranch({ ...base, refactor: true, paths: ['src/a.ts'] }).kind).toBe('refactor')
  })

  it('still exempts a docs-only refactor branch', () => {
    expect(classifyBranch({ ...base, branch: 'refactor/docs', paths: ['docs/a.md'] }).kind).toBe('docs-only')
  })
})

describe('parseArgs', () => {
  it('reads --base and --refactor', () => {
    expect(parseArgs([])).toEqual({ refactor: false })
    expect(parseArgs(['--base', 'abc', '--refactor'])).toEqual({ base: 'abc', refactor: true })
    expect(parseArgs(['--base=abc'])).toEqual({ base: 'abc', refactor: false })
  })

  it('refuses unknown or incomplete arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--base'])).toThrow(/--base needs a ref/)
  })
})

describe('parseRenames', () => {
  it('maps each renamed path to its old path', () => {
    const out = 'M\tsrc/a.ts\nR100\ttests/old.test.ts\ttests/new.test.ts\nR087\tsrc/x.ts\tsrc/y.ts'
    expect(parseRenames(out)).toEqual(new Map([
      ['tests/new.test.ts', 'tests/old.test.ts'],
      ['src/y.ts', 'src/x.ts'],
    ]))
    expect(parseRenames('')).toEqual(new Map())
  })
})

const ROOT = '/repo'
function run(files: VitestJson['testResults']): VitestJson {
  return { success: files.every((f) => f.status === 'passed'), testResults: files }
}
const ok = { status: 'passed' }
const bad = { status: 'failed' }
const skip = { status: 'skipped' }

describe('summariseRun', () => {
  it('counts each file’s passed, failed and skipped tests', () => {
    const json = run([
      { name: '/repo/tests/unit/a.test.ts', status: 'failed', message: '', assertionResults: [bad, ok, ok] },
      { name: '/repo/tests/unit/b.test.ts', status: 'passed', message: '', assertionResults: [ok, skip] },
    ])
    expect(summariseRun(json, ROOT, ['tests/unit/a.test.ts', 'tests/unit/b.test.ts'])).toEqual({
      'tests/unit/a.test.ts': { state: 'ran', passed: 2, failed: 1, skipped: 0 },
      'tests/unit/b.test.ts': { state: 'ran', passed: 1, failed: 0, skipped: 1 },
    })
  })

  it('marks a file that failed to load, with the first line of the error', () => {
    const json = run([{
      name: '/repo/tests/unit/a.test.ts', status: 'failed',
      message: 'Failed to load url ../../src/new (resolved id: ../../src/new)\n    at stack', assertionResults: [],
    }])
    expect(summariseRun(json, ROOT, ['tests/unit/a.test.ts'])['tests/unit/a.test.ts']).toEqual({
      state: 'load-error', message: 'Failed to load url ../../src/new (resolved id: ../../src/new)',
    })
  })

  it('marks files absent from the results, or a run with no results, as not run', () => {
    const json = run([{ name: '/repo/tests/unit/a.test.ts', status: 'passed', message: '', assertionResults: [ok] }])
    expect(summariseRun(json, ROOT, ['tests/unit/b.test.ts'])['tests/unit/b.test.ts']).toEqual({ state: 'missing' })
    expect(summariseRun(null, ROOT, ['tests/unit/a.test.ts'])['tests/unit/a.test.ts']).toEqual({ state: 'missing' })
  })
})

describe('formatFileResult', () => {
  it('prints counts, skipping zero counts', () => {
    expect(formatFileResult({ state: 'ran', passed: 2, failed: 1, skipped: 0 })).toBe('1 failed, 2 passed')
    expect(formatFileResult({ state: 'ran', passed: 3, failed: 0, skipped: 1 })).toBe('3 passed, 1 skipped')
    expect(formatFileResult({ state: 'ran', passed: 0, failed: 0, skipped: 0 })).toBe('no tests ran')
    expect(formatFileResult({ state: 'load-error', message: 'boom' })).toBe('failed to load (boom)')
    expect(formatFileResult({ state: 'missing' })).toBe('not run')
  })
})

const ran = (passed: number, failed = 0): FileResult => ({ state: 'ran', passed, failed, skipped: 0 })

describe('fixVerdict', () => {
  const files = ['tests/a.test.ts', 'tests/b.test.ts']

  it('is proved when at least one file fails on master and all pass on the branch', () => {
    const v = fixVerdict(files, { 'tests/a.test.ts': ran(2, 1), 'tests/b.test.ts': ran(1) },
      { 'tests/a.test.ts': ran(3), 'tests/b.test.ts': ran(1) })
    expect(v).toEqual({ pass: true, reason: "proved: 1 of 2 test files fail on master's source; all pass on the branch" })
  })

  it('counts a file that cannot load on master (new module) as failing there', () => {
    const v = fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': { state: 'load-error', message: 'x' } },
      { 'tests/a.test.ts': ran(2) })
    expect(v.pass).toBe(true)
  })

  it('is not proved when every test passes on master too', () => {
    const v = fixVerdict(files, { 'tests/a.test.ts': ran(3), 'tests/b.test.ts': ran(1) },
      { 'tests/a.test.ts': ran(3), 'tests/b.test.ts': ran(1) })
    expect(v).toEqual({
      pass: false,
      reason: "not proved: every test passes on master's source too, so the tests do not show the change",
    })
  })

  it('is not proved when a file fails, does not load or runs nothing on the branch', () => {
    const master = { 'tests/a.test.ts': ran(0, 1), 'tests/b.test.ts': ran(1) }
    expect(fixVerdict(files, master, { 'tests/a.test.ts': ran(2, 1), 'tests/b.test.ts': ran(1) }))
      .toEqual({ pass: false, reason: 'not proved: `tests/a.test.ts` does not pass on the branch (1 failed, 2 passed)' })
    expect(fixVerdict(files, master, { 'tests/a.test.ts': ran(0), 'tests/b.test.ts': ran(1) }).reason)
      .toContain('(no tests ran)')
    expect(fixVerdict(files, master, { 'tests/a.test.ts': { state: 'missing' }, 'tests/b.test.ts': ran(1) }).reason)
      .toContain('(not run)')
  })

  it('is not proved when a file did not run on master at all', () => {
    const v = fixVerdict(files, { 'tests/a.test.ts': ran(0, 1), 'tests/b.test.ts': { state: 'missing' } },
      { 'tests/a.test.ts': ran(1), 'tests/b.test.ts': ran(1) })
    expect(v).toEqual({ pass: false, reason: "not proved: `tests/b.test.ts` did not run on master's source" })
  })
})

describe('normaliseTestText', () => {
  it('ignores changes to import statements, including multi-line ones', () => {
    const before = "import { a } from '../src/a'\nimport {\n  b,\n  c,\n} from '../src/bc'\n\nit('x', () => a(b, c))\n"
    const after = "import { a } from '../src/lib/a'\nimport { b, c } from '../src/lib/bc'\nit('x', () => a(b, c))\n"
    expect(normaliseTestText(before)).toBe(normaliseTestText(after))
  })

  it('ignores changed mock paths but not changed mock factories', () => {
    const before = "vi.mock('../server/a', () => ({ f: () => 1 }))\nconst m = await vi.importActual<typeof import('../server/a')>('../server/a')"
    const moved = "vi.mock('../server/lib/a', () => ({ f: () => 1 }))\nconst m = await vi.importActual<typeof import('../server/lib/a')>('../server/lib/a')"
    const changed = "vi.mock('../server/lib/a', () => ({ f: () => 2 }))\nconst m = await vi.importActual<typeof import('../server/lib/a')>('../server/lib/a')"
    expect(normaliseTestText(before)).toBe(normaliseTestText(moved))
    expect(normaliseTestText(before)).not.toBe(normaliseTestText(changed))
  })

  it('does not hide a changed assertion', () => {
    expect(normaliseTestText('expect(f()).toBe(1)')).not.toBe(normaliseTestText('expect(f()).toBe(2)'))
  })
})

describe('compareRefactorTests', () => {
  it('passes unchanged logic and new test files', () => {
    expect(compareRefactorTests([
      { path: 'tests/a.test.ts', baseText: "import x from './a'\nit('a', () => x())", headText: "import x from './b'\nit('a', () => x())" },
      { path: 'tests/new.test.ts', baseText: null, headText: "it('n', () => {})" },
    ])).toEqual([])
  })

  it('reports changed logic with the first differing line, and deleted test files', () => {
    expect(compareRefactorTests([
      { path: 'tests/a.test.ts', baseText: "it('a', () => {\n  expect(1).toBe(1)\n})", headText: "it('a', () => {\n  expect(1).toBe(2)\n})" },
      { path: 'tests/gone.test.ts', baseText: "it('g', () => {})", headText: null },
      { path: 'tests/moved.test.ts', oldPath: 'tests/old.test.ts', baseText: 'it(1)', headText: 'it(1)' },
    ])).toEqual([
      '`tests/a.test.ts`: test logic changed: `expect(1).toBe(1)` became `expect(1).toBe(2)`',
      '`tests/gone.test.ts`: test file deleted',
    ])
  })
})

describe('summariseSuite and refactorVerdict', () => {
  const green = run([
    { name: '/r/tests/a.test.ts', status: 'passed', message: '', assertionResults: [ok, ok] },
    { name: '/r/tests/b.test.ts', status: 'passed', message: '', assertionResults: [ok, skip] },
  ])
  const red = run([
    { name: '/r/tests/a.test.ts', status: 'failed', message: '', assertionResults: [ok, bad] },
    { name: '/r/tests/b.test.ts', status: 'failed', message: 'boom', assertionResults: [] },
  ])

  it('summarises a whole-suite run', () => {
    expect(summariseSuite(green)).toEqual({ state: 'ran', passed: 3, failed: 0, skipped: 1, failedFiles: 0 })
    expect(summariseSuite(red)).toEqual({ state: 'ran', passed: 1, failed: 1, skipped: 0, failedFiles: 2 })
    expect(summariseSuite(null)).toEqual({ state: 'missing' })
  })

  it('passes only with no logic changes and a green suite on both sides', () => {
    const g = summariseSuite(green)
    expect(refactorVerdict([], g, g)).toEqual({
      pass: true, reason: "proved: test logic unchanged; the suite is green on master's source and on the branch",
    })
    expect(refactorVerdict(['`tests/a.test.ts`: test file deleted'], null, null)).toEqual({
      pass: false, reason: 'not proved: test logic changed in 1 file',
    })
    expect(refactorVerdict([], summariseSuite(red), g).reason).toBe("not proved: the suite is not green on master's source")
    expect(refactorVerdict([], g, summariseSuite(red)).reason).toBe('not proved: the suite is not green on the branch')
    expect(refactorVerdict([], g, { state: 'missing' }).reason).toBe('not proved: the suite is not green on the branch')
  })
})

describe('proofLines', () => {
  it('lists the kind, base, each test file with both runs, and the verdict', () => {
    expect(proofLines({
      kind: 'fix', base: 'abc1234',
      files: [{ path: 'tests/a.test.ts', master: ran(2, 1), branch: ran(3) }],
      reason: 'proved: x',
    })).toEqual([
      '- kind: fix',
      '- base: `abc1234`',
      '- `tests/a.test.ts`: master: 1 failed, 2 passed; branch: 3 passed',
      '- verdict: proved: x',
    ])
  })

  it('prints refactor problems and suite results', () => {
    expect(proofLines({
      kind: 'refactor', base: 'abc1234', files: [],
      problems: ['`tests/a.test.ts`: test file deleted'],
      suites: { master: { state: 'ran', passed: 5, failed: 0, skipped: 0, failedFiles: 0 }, branch: { state: 'missing' } },
      reason: 'not proved: y',
    })).toEqual([
      '- kind: refactor',
      '- base: `abc1234`',
      '- `tests/a.test.ts`: test file deleted',
      '- suite: master: 5 passed; branch: not run',
      '- verdict: not proved: y',
    ])
  })

  it('prints a note for a file with no runs', () => {
    expect(proofLines({ kind: 'refactor', base: 'abc', files: [{ path: 'tests/a.test.ts', note: 'test logic unchanged' }], reason: 'r' }))
      .toContain('- `tests/a.test.ts`: test logic unchanged')
  })

  it('prints no file lines when there are none', () => {
    expect(proofLines({ kind: 'no-tests', base: 'abc', files: [], reason: 'no tests: z' }))
      .toEqual(['- kind: no-tests', '- base: `abc`', '- verdict: no tests: z'])
  })
})
