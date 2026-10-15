import { describe, it, expect } from 'vitest'
import { evidenceMarker, findEvidenceBlock, formatEvidenceBlock } from '../../../scripts/loop/evidence'

describe('formatEvidenceBlock', () => {
  it('starts with the marker, then the verdict, the commit and the lines', () => {
    const text = formatEvidenceBlock({
      command: 'gate', verdict: 'pass', commit: 'abc1234', dirty: false, lines: ['- test: pass'],
    })
    expect(text.split('\n')).toEqual([
      '<!-- loop:gate -->',
      '**loop:gate: PASS**',
      '- commit: `abc1234`',
      '- test: pass',
    ])
  })

  it('says when the tree had uncommitted changes', () => {
    const text = formatEvidenceBlock({ command: 'proof', verdict: 'fail', commit: 'abc1234', dirty: true, lines: [] })
    expect(text).toContain('**loop:proof: FAIL**')
    expect(text).toContain('`abc1234` (uncommitted changes present)')
  })
})

describe('findEvidenceBlock', () => {
  const block = formatEvidenceBlock({ command: 'guard', verdict: 'pass', commit: 'abc1234', dirty: false, lines: ['- ok'] })

  it('finds a block inside a PR body and stops at the blank line after it', () => {
    expect(findEvidenceBlock(`## Summary\nstuff\n\n${block}\n\nmore text`, 'guard')).toBe(block)
  })

  it('returns null when the marker is absent', () => {
    expect(findEvidenceBlock(block, 'gate')).toBeNull()
  })

  it('uses one marker per command', () => {
    expect(evidenceMarker('proof')).toBe('<!-- loop:proof -->')
  })
})
