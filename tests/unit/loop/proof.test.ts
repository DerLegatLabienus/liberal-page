import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  Scratch,
  classifyBranch,
  compareRefactorTests,
  fixVerdict,
  formatFileResult,
  isTestFile,
  makeSignalHandler,
  refactorGuardedChanges,
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
      'tests/unit/a.test.ts': { state: 'ran', status: 'failed', passed: 2, failed: 1, skipped: 0 },
      'tests/unit/b.test.ts': { state: 'ran', status: 'passed', passed: 1, failed: 0, skipped: 1 },
    })
  })

  it('keeps the file status: a file whose afterAll throws failed though every test passed', () => {
    const json = run([{
      name: '/repo/tests/unit/a.test.ts', status: 'failed', message: 'Error: afterAll boom\n  at x', assertionResults: [ok, ok],
    }])
    expect(summariseRun(json, ROOT, ['tests/unit/a.test.ts'])['tests/unit/a.test.ts']).toEqual({
      state: 'ran', status: 'failed', passed: 2, failed: 0, skipped: 0, message: 'Error: afterAll boom',
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
    expect(formatFileResult({ state: 'ran', status: 'failed', passed: 2, failed: 1, skipped: 0 })).toBe('1 failed, 2 passed')
    expect(formatFileResult({ state: 'ran', status: 'passed', passed: 3, failed: 0, skipped: 1 })).toBe('3 passed, 1 skipped')
    expect(formatFileResult({ state: 'ran', status: 'passed', passed: 0, failed: 0, skipped: 0 })).toBe('no tests ran')
    expect(formatFileResult({ state: 'ran', status: 'failed', passed: 2, failed: 0, skipped: 0, message: 'boom' }))
      .toBe('2 passed, file failed (boom)')
    expect(formatFileResult({ state: 'load-error', message: 'boom' })).toBe('failed to load (boom)')
    expect(formatFileResult({ state: 'missing' })).toBe('not run')
  })
})

const ran = (passed: number, failed = 0, status = failed > 0 ? 'failed' : 'passed'): FileResult =>
  ({ state: 'ran', status, passed, failed, skipped: 0 })
/** A file whose own hooks failed (e.g. afterAll threw) though every test in it passed. */
const hookFailed = (passed: number): FileResult => ({ state: 'ran', status: 'failed', passed, failed: 0, skipped: 0, message: 'afterAll' })

describe('fixVerdict', () => {
  const files = ['tests/a.test.ts', 'tests/b.test.ts']
  const opts = { newFiles: files, branchExitCode: 0 }

  it('is proved when at least one file fails on master and all pass on the branch', () => {
    const v = fixVerdict(files, { 'tests/a.test.ts': ran(2, 1), 'tests/b.test.ts': ran(1) },
      { 'tests/a.test.ts': ran(3), 'tests/b.test.ts': ran(1) }, opts)
    expect(v).toEqual({ pass: true, reason: "proved: 1 of 2 test files fail on master's source; all pass on the branch" })
  })

  it('counts a file that cannot load on master (new module) as failing there', () => {
    const v = fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': { state: 'load-error', message: 'x' } },
      { 'tests/a.test.ts': ran(2) }, opts)
    expect(v.pass).toBe(true)
  })

  it('does not count a load error on master for a test file that already exists there', () => {
    const v = fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': { state: 'load-error', message: 'x' } },
      { 'tests/a.test.ts': ran(2) }, { newFiles: [], branchExitCode: 0 })
    expect(v).toEqual({
      pass: false,
      reason: "not proved: every test passes on master's source too, so the tests do not show the change",
    })
  })

  it('counts a file whose hooks fail on master as failing there', () => {
    const v = fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': hookFailed(2) }, { 'tests/a.test.ts': ran(2) }, opts)
    expect(v.pass).toBe(true)
  })

  it('is not proved when a file’s hooks fail on the branch though its tests pass', () => {
    const v = fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': ran(0, 1) }, { 'tests/a.test.ts': hookFailed(2) }, opts)
    expect(v).toEqual({
      pass: false, reason: 'not proved: `tests/a.test.ts` does not pass on the branch (2 passed, file failed (afterAll))',
    })
  })

  it('is not proved when vitest exits non-zero on the branch (an unhandled error)', () => {
    const v = fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': ran(0, 1) }, { 'tests/a.test.ts': ran(2) },
      { newFiles: ['tests/a.test.ts'], branchExitCode: 1 })
    expect(v).toEqual({ pass: false, reason: 'not proved: vitest exited with code 1 on the branch (unhandled errors?)' })
    expect(fixVerdict(['tests/a.test.ts'], { 'tests/a.test.ts': ran(0, 1) }, { 'tests/a.test.ts': ran(2) },
      { newFiles: ['tests/a.test.ts'], branchExitCode: null }).pass).toBe(false)
  })

  it('is not proved when every test passes on master too', () => {
    const v = fixVerdict(files, { 'tests/a.test.ts': ran(3), 'tests/b.test.ts': ran(1) },
      { 'tests/a.test.ts': ran(3), 'tests/b.test.ts': ran(1) }, opts)
    expect(v).toEqual({
      pass: false,
      reason: "not proved: every test passes on master's source too, so the tests do not show the change",
    })
  })

  it('is not proved when a file fails, does not load or runs nothing on the branch', () => {
    const master = { 'tests/a.test.ts': ran(0, 1), 'tests/b.test.ts': ran(1) }
    expect(fixVerdict(files, master, { 'tests/a.test.ts': ran(2, 1), 'tests/b.test.ts': ran(1) }, opts))
      .toEqual({ pass: false, reason: 'not proved: `tests/a.test.ts` does not pass on the branch (1 failed, 2 passed)' })
    expect(fixVerdict(files, master, { 'tests/a.test.ts': ran(0), 'tests/b.test.ts': ran(1) }, opts).reason)
      .toContain('(no tests ran)')
    expect(fixVerdict(files, master, { 'tests/a.test.ts': { state: 'missing' }, 'tests/b.test.ts': ran(1) }, opts).reason)
      .toContain('(not run)')
  })

  it('is not proved when a file did not run on master at all', () => {
    const v = fixVerdict(files, { 'tests/a.test.ts': ran(0, 1), 'tests/b.test.ts': { state: 'missing' } },
      { 'tests/a.test.ts': ran(1), 'tests/b.test.ts': ran(1) }, opts)
    expect(v).toEqual({ pass: false, reason: "not proved: `tests/b.test.ts` did not run on master's source" })
  })
})

describe('normaliseTestText', () => {
  it('ignores changed module paths and the layout of multi-line imports', () => {
    const before = "import { a } from '../src/a'\nimport {\n  b,\n  c,\n} from '../src/bc'\nimport '../src/side'\nexport { d } from '../src/d'\n\nit('x', () => a(b, c))\n"
    const after = "import { a } from '../src/lib/a'\nimport { b, c } from \"../src/lib/bc\";\nimport '../src/lib/side'\nexport { d } from '../src/lib/d'\nit('x', () => a(b, c))\n"
    expect(normaliseTestText(before)).toBe(normaliseTestText(after))
  })

  it('keeps imported names: importing something else is a change', () => {
    expect(normaliseTestText("import { a } from '../src/a'\nit('x', () => a())"))
      .not.toBe(normaliseTestText("import { b as a } from '../src/a'\nit('x', () => a())"))
    expect(normaliseTestText("import { a } from '../src/a'")).not.toBe(normaliseTestText("import { a, extra } from '../src/a'"))
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

  const compareOne = (baseText: string, headText: string) =>
    compareRefactorTests([{ path: 'tests/a.test.ts', baseText, headText }])
  const body = "\nit('a', () => {\n  expect(a()).toBe(1)\n})"

  it('passes a name moved to its own import from another module', () => {
    expect(compareOne(
      "import { Provider, useThing } from '@/contexts/Thing'" + body,
      "import { Provider } from '@/contexts/Thing'\nimport { useThing } from '@/hooks/useThing'" + body,
    )).toEqual([])
    expect(compareOne(
      "import { b } from './b'\nimport { a } from './a'" + body,
      "import { a, b } from './ab'" + body,
    )).toEqual([])
  })

  it('reports a changed set of imported names, whatever the grouping', () => {
    const changed = (head: string) => compareOne("import { a } from './a'" + body, head + body)
    expect(changed("import { b as a } from './a'")).toEqual(['`tests/a.test.ts`: imported names changed: removed `a`, added `b as a`'])
    expect(changed("import { a } from './a'\nimport { extra } from './x'")).toEqual(['`tests/a.test.ts`: imported names changed: added `extra`'])
    expect(changed("import a from './a'")).toEqual(['`tests/a.test.ts`: imported names changed: removed `a`, added `default as a`'])
    expect(changed("import * as a from './a'")).toEqual(['`tests/a.test.ts`: imported names changed: removed `a`, added `* as a`'])
    expect(changed("import { type a } from './a'")).toEqual(['`tests/a.test.ts`: imported names changed: removed `a`, added `type a`'])
    expect(changed("import type { a } from './a'")).toEqual(['`tests/a.test.ts`: imported names changed: removed `a`, added `type a`'])
    expect(changed("import '../setup'\nimport { a } from './a'")).toEqual(['`tests/a.test.ts`: imported names changed: added side-effect import'])
  })

  it('still reports changed logic after a regrouped import', () => {
    expect(compareOne(
      "import { a, b } from './ab'" + body,
      "import { a } from './a'\nimport { b } from './b'\nit('a', () => {\n  expect(a()).toBe(2)\n})",
    )).toEqual(['`tests/a.test.ts`: test logic changed: `expect(a()).toBe(1)` became `expect(a()).toBe(2)`'])
  })
})

describe('refactorGuardedChanges', () => {
  it('lists changed test infrastructure a refactor may not touch', () => {
    expect(refactorGuardedChanges([
      'src/a.ts', 'tests/unit/a.test.ts', 'tests/support/fixtures.ts', 'vitest.config.ts', 'src/test-setup.ts',
      'src/__mocks__/react-i18next.ts', 'tests/unit/__snapshots__/a.test.ts.snap', 'src/x.snap', 'docs/a.md',
    ])).toEqual([
      'tests/support/fixtures.ts', 'vitest.config.ts', 'src/test-setup.ts',
      'src/__mocks__/react-i18next.ts', 'tests/unit/__snapshots__/a.test.ts.snap', 'src/x.snap',
    ])
    expect(refactorGuardedChanges(['src/a.ts', 'tests/unit/a.test.tsx'])).toEqual([])
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
    expect(summariseSuite(green, 0)).toEqual({ state: 'ran', passed: 3, failed: 0, skipped: 1, failedFiles: 0, exitCode: 0 })
    expect(summariseSuite(red, 1)).toEqual({ state: 'ran', passed: 1, failed: 1, skipped: 0, failedFiles: 2, exitCode: 1 })
    expect(summariseSuite(null, 1)).toEqual({ state: 'missing' })
  })

  it('passes only with no logic changes and a green suite on both sides', () => {
    const g = summariseSuite(green, 0)
    expect(refactorVerdict([], g, g)).toEqual({
      pass: true, reason: "proved: test logic unchanged; the suite is green on master's source and on the branch",
    })
    expect(refactorVerdict(['`tests/a.test.ts`: test file deleted'], null, null)).toEqual({
      pass: false, reason: 'not proved: 1 test change a refactor may not make',
    })
    expect(refactorVerdict([], summariseSuite(red, 1), g).reason).toBe("not proved: the suite is not green on master's source")
    expect(refactorVerdict([], g, summariseSuite(red, 1)).reason).toBe('not proved: the suite is not green on the branch')
    // Every test passed but vitest still exited non-zero (an unhandled error): not green.
    expect(refactorVerdict([], g, summariseSuite(green, 1)).reason).toBe('not proved: the suite is not green on the branch')
    expect(refactorVerdict([], summariseSuite(green, 1), g).reason).toBe("not proved: the suite is not green on master's source")
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
      suites: { master: { state: 'ran', passed: 5, failed: 0, skipped: 0, failedFiles: 0, exitCode: 0 }, branch: { state: 'missing' } },
      reason: 'not proved: y',
    })).toEqual([
      '- kind: refactor',
      '- base: `abc1234`',
      '- `tests/a.test.ts`: test file deleted',
      '- suite: master: 5 passed; branch: not run',
      '- verdict: not proved: y',
    ])
    expect(proofLines({
      kind: 'refactor', base: 'abc', files: [], reason: 'r',
      suites: {
        master: { state: 'ran', passed: 5, failed: 0, skipped: 0, failedFiles: 0, exitCode: 1 },
        branch: { state: 'ran', passed: 4, failed: 1, skipped: 0, failedFiles: 1, exitCode: 1 },
      },
    })).toContain('- suite: master: 5 passed (vitest exit 1); branch: 1 failed, 4 passed (1 file(s) failed) (vitest exit 1)')
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

describe('Scratch (against a temporary repo)', () => {
  let repo: string
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-proof-test-repo-')))
    git('init', '-q')
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n')
    fs.mkdirSync(path.join(repo, 'tests'))
    fs.writeFileSync(path.join(repo, 'tests', 'a.test.ts'), 'base')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    fs.writeFileSync(path.join(repo, 'tests', 'a.test.ts'), 'head')
    git('commit', '-q', '-am', 'head')
    fs.mkdirSync(path.join(repo, 'node_modules'))
    fs.writeFileSync(path.join(repo, 'node_modules', 'keep.txt'), 'x')
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'live tree file')
  })
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it('makes two checkouts with node_modules linked and an overlay, then removes everything', () => {
    const statusBefore = git('status', '--porcelain')
    const scratch = new Scratch(repo)
    const a = scratch.checkout('HEAD~1', 'master', { ref: 'HEAD', paths: ['tests/a.test.ts'] })
    const b = scratch.checkout('HEAD', 'branch')
    expect(fs.readFileSync(path.join(a, 'tests', 'a.test.ts'), 'utf8')).toBe('head')
    expect(fs.readFileSync(path.join(b, 'node_modules', 'keep.txt'), 'utf8')).toBe('x')
    expect(git('worktree', 'list').split('\n')).toHaveLength(3)

    scratch.cleanup()
    scratch.cleanup() // idempotent
    expect(git('worktree', 'list').split('\n')).toHaveLength(1)
    expect(git('status', '--porcelain')).toBe(statusBefore)
    expect(fs.existsSync(scratch.dir)).toBe(false)
    expect(fs.readFileSync(path.join(repo, 'node_modules', 'keep.txt'), 'utf8')).toBe('x')
    expect(fs.readFileSync(path.join(repo, 'tests', 'a.test.ts'), 'utf8')).toBe('head')
  })

  it('the signal handler runs the same cleanup, then exits 130 or 143', () => {
    for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
      const scratch = new Scratch(repo)
      scratch.checkout('HEAD', 'branch')
      const exit = vi.fn()
      const log = vi.fn()
      makeSignalHandler(scratch, exit, log)(signal)
      expect(exit).toHaveBeenCalledWith(code)
      expect(log).toHaveBeenCalledWith(expect.stringContaining(signal))
      expect(git('worktree', 'list').split('\n')).toHaveLength(1)
      expect(fs.existsSync(scratch.dir)).toBe(false)
    }
  })
})
