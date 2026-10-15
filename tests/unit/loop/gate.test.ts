import { describe, it, expect } from 'vitest'
import {
  GATE_CHECKS,
  buildGateBlock,
  checkLine,
  failureTail,
  flattenLine,
  gateVerdict,
  tellingLine,
  type CheckResult,
} from '../../../scripts/loop/gate'
import { findEvidenceBlock } from '../../../scripts/loop/evidence'

const NPM_TRAILER = [
  'npm error Lifecycle script `lint` failed with error:',
  'npm error code 1',
  'npm ERR! A complete log of this run can be found in: /tmp/x.log',
].join('\n')

describe('GATE_CHECKS', () => {
  it('is the four gate commands, in order', () => {
    expect(GATE_CHECKS.map((c) => c.display)).toEqual([
      'npm test', 'npx tsc --noEmit', 'npm run lint', 'npm run build',
    ])
    expect(GATE_CHECKS.map((c) => c.name)).toEqual(['test', 'tsc', 'lint', 'build'])
  })
})

describe('flattenLine', () => {
  it('strips ANSI codes, carriage returns and extra whitespace', () => {
    expect(flattenLine('\u001b[32m  Tests \u001b[39m  12 passed\r (12)  ')).toBe('Tests 12 passed (12)')
  })

  it('caps the length', () => {
    const out = flattenLine('x'.repeat(500))
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('tellingLine: test (vitest)', () => {
  it('picks the Tests summary when all pass', () => {
    const out = [
      '> liberal-page@0.0.0 test', '> vitest run', '',
      ' Test Files  120 passed (120)',
      '      Tests  1200 passed (1200)',
      '   Start at  10:00:00',
      '   Duration  30.1s',
    ].join('\n')
    expect(tellingLine('test', out, 0)).toBe('Tests 1200 passed (1200)')
  })

  it('picks the Tests summary when some fail, not Test Files or Failed Tests', () => {
    const out = [
      '⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯',
      ' FAIL tests/unit/x.test.ts > does a thing',
      ' Test Files  2 failed | 118 passed (120)',
      '      \u001b[1mTests\u001b[22m  \u001b[31m3 failed\u001b[39m | 1200 passed (1203)',
      '   Duration  30.1s',
      NPM_TRAILER,
    ].join('\n')
    expect(tellingLine('test', out, 1)).toBe('Tests 3 failed | 1200 passed (1203)')
  })

  it('falls back to the last non-npm line when there is no summary', () => {
    const out = ['Error: Cannot find module vitest', NPM_TRAILER].join('\n')
    expect(tellingLine('test', out, 1)).toBe('Error: Cannot find module vitest')
  })
})

describe('tellingLine: tsc', () => {
  it('says no errors on a clean run with no output', () => {
    expect(tellingLine('tsc', '', 0)).toBe('no errors')
  })

  it('counts error TS lines', () => {
    const out = [
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/b.ts(9,1): error TS2304: Cannot find name 'x'.",
    ].join('\n')
    expect(tellingLine('tsc', out, 2)).toBe('2 errors')
  })

  it('uses the singular for one error', () => {
    expect(tellingLine('tsc', "src/a.ts(3,5): error TS2322: nope", 2)).toBe('1 error')
  })

  it('falls back to the last line when it failed with no error TS lines', () => {
    expect(tellingLine('tsc', 'error: tsconfig.json not found\n', 1)).toBe('error: tsconfig.json not found')
  })
})

describe('tellingLine: lint (eslint)', () => {
  it('says no problems on a clean run', () => {
    expect(tellingLine('lint', '> liberal-page@0.0.0 lint\n> eslint .\n\n', 0)).toBe('no problems')
  })

  it('shows the problem count line', () => {
    const out = [
      '/repo/src/a.ts', '  3:5  error  x is unused  no-unused-vars', '',
      '✖ 5 problems (3 errors, 2 warnings)', '', NPM_TRAILER,
    ].join('\n')
    expect(tellingLine('lint', out, 1)).toBe('✖ 5 problems (3 errors, 2 warnings)')
  })

  it('handles the singular "problem"', () => {
    expect(tellingLine('lint', '✖ 1 problem (1 error, 0 warnings)\n', 1)).toBe('✖ 1 problem (1 error, 0 warnings)')
  })

  it('shows warnings even when the run passed', () => {
    expect(tellingLine('lint', '✖ 2 problems (0 errors, 2 warnings)\n', 0)).toBe('✖ 2 problems (0 errors, 2 warnings)')
  })
})

describe('tellingLine: build', () => {
  it('prefers the "built in" line over a nearby warning', () => {
    const out = [
      '> tsc -b && vite build',
      'dist/assets/index.js  900.00 kB │ gzip: 250 kB',
      '✓ built in 5.21s',
      '(!) Some chunks are larger than 500 kB after minification.',
    ].join('\n')
    expect(tellingLine('build', out, 0)).toBe('✓ built in 5.21s')
  })

  it('falls back to the last non-npm line when it passed without "built in"', () => {
    expect(tellingLine('build', 'done\n> npm notice\n', 0)).toBe('done')
  })

  it('shows the first tsc error and the count when tsc -b fails', () => {
    const out = [
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable.",
      "src/b.ts(9,1): error TS2304: Cannot find name 'x'.",
      NPM_TRAILER,
    ].join('\n')
    expect(tellingLine('build', out, 2)).toBe("2 errors; first: src/a.ts(3,5): error TS2322: Type 'string' is not assignable.")
  })

  it('shows the first non-npm error line otherwise, never the npm trailer', () => {
    const out = ['vite v5', '[vite]: Rollup failed to resolve import "x"', 'error during build:', NPM_TRAILER].join('\n')
    expect(tellingLine('build', out, 1)).toBe('error during build:')
  })
})

describe('checkLine and gateVerdict', () => {
  const pass: CheckResult = { name: 'test', display: 'npm test', exitCode: 0, output: '      Tests  4 passed (4)' }
  const fail: CheckResult = { name: 'lint', display: 'npm run lint', exitCode: 1, output: '✖ 1 problem (1 error, 0 warnings)' }

  it('formats a passing check', () => {
    expect(checkLine(pass)).toBe('- test (`npm test`): pass — Tests 4 passed (4)')
  })

  it('formats a failing check with its exit code', () => {
    expect(checkLine(fail)).toBe('- lint (`npm run lint`): FAIL (exit 1) — ✖ 1 problem (1 error, 0 warnings)')
  })

  it('reports a check that could not start or was killed', () => {
    expect(checkLine({ name: 'build', display: 'npm run build', exitCode: null, output: '', error: 'spawnSync npm ENOENT' }))
      .toBe('- build (`npm run build`): FAIL — could not run: spawnSync npm ENOENT')
    expect(checkLine({ name: 'build', display: 'npm run build', exitCode: null, output: 'x', signal: 'SIGTERM' }))
      .toBe('- build (`npm run build`): FAIL — killed by SIGTERM')
  })

  it('passes only when every check exited 0', () => {
    expect(gateVerdict([pass, pass])).toBe('pass')
    expect(gateVerdict([pass, fail])).toBe('fail')
    expect(gateVerdict([{ ...pass, exitCode: null }])).toBe('fail')
    expect(gateVerdict([])).toBe('fail')
  })
})

describe('buildGateBlock', () => {
  const results: CheckResult[] = [
    { name: 'test', display: 'npm test', exitCode: 0, output: '      Tests  4 passed (4)\n' },
    { name: 'tsc', display: 'npx tsc --noEmit', exitCode: 0, output: '' },
    { name: 'lint', display: 'npm run lint', exitCode: 1, output: '\n\n✖ 1 problem (1 error, 0 warnings)\n\n' },
    { name: 'build', display: 'npm run build', exitCode: 0, output: '✓ built in 1s\n' },
  ]

  it('is a gate evidence block with one line per check and no blank line', () => {
    const text = buildGateBlock(results, { commit: 'abc1234', dirty: true })
    expect(text.split('\n')).toEqual([
      '<!-- loop:gate -->',
      '**loop:gate: FAIL**',
      '- commit: `abc1234` (uncommitted changes present)',
      '- test (`npm test`): pass — Tests 4 passed (4)',
      '- tsc (`npx tsc --noEmit`): pass — no errors',
      '- lint (`npm run lint`): FAIL (exit 1) — ✖ 1 problem (1 error, 0 warnings)',
      '- build (`npm run build`): pass — ✓ built in 1s',
    ])
  })

  it('can be found whole inside a larger text', () => {
    const text = buildGateBlock(results, { commit: 'abc1234', dirty: false })
    expect(findEvidenceBlock(`## Gate\n\n${text}\n\n## Next`, 'gate')).toBe(text)
  })
})

describe('failureTail', () => {
  it('is the last N lines, trailing blank lines dropped, ANSI stripped', () => {
    const out = Array.from({ length: 30 }, (_, i) => `\u001b[31mline ${i + 1}\u001b[39m`).join('\n') + '\n\n'
    const tail = failureTail(out, 20).split('\n')
    expect(tail).toHaveLength(20)
    expect(tail[0]).toBe('line 11')
    expect(tail[19]).toBe('line 30')
  })

  it('returns everything when shorter than N', () => {
    expect(failureTail('a\nb', 20)).toBe('a\nb')
  })
})
