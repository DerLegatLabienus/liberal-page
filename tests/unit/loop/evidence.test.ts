import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  changedPaths, evidenceMarker, findEvidenceBlock, formatEvidenceBlock, resolveBase, treeState,
} from '../../../scripts/loop/evidence'

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

  it('stops at a blank line in a CRLF body too', () => {
    const crlf = block.replace(/\n/g, '\r\n')
    expect(findEvidenceBlock(`## Summary\r\nstuff\r\n\r\n${crlf}\r\n\r\nmore text`, 'guard')).toBe(crlf)
  })

  it('returns null when the marker is absent', () => {
    expect(findEvidenceBlock(block, 'gate')).toBeNull()
  })

  it('uses one marker per command', () => {
    expect(evidenceMarker('proof')).toBe('<!-- loop:proof -->')
  })
})

describe('git facts (against a temporary repo)', () => {
  let dir: string
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const commitFile = (name: string) => {
    fs.writeFileSync(path.join(dir, name), name)
    git('add', name)
    git('commit', '-q', '-m', name)
    return git('rev-parse', 'HEAD')
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-evidence-'))
    git('init', '-q')
    git('symbolic-ref', 'HEAD', 'refs/heads/master')
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('treeState gives the short SHA and counts untracked files as dirty', () => {
    const sha = commitFile('a.txt')
    expect(treeState(dir)).toEqual({ commit: sha.slice(0, treeState(dir).commit.length), dirty: false })
    expect(sha.startsWith(treeState(dir).commit)).toBe(true)
    fs.writeFileSync(path.join(dir, 'new.txt'), 'x')
    expect(treeState(dir).dirty).toBe(true)
  })

  it('resolveBase uses master when there is no origin/master, and prefers origin/master when there is', () => {
    const first = commitFile('a.txt')
    const second = commitFile('b.txt')
    git('checkout', '-q', '-b', 'feature')
    commitFile('c.txt')
    expect(resolveBase(undefined, dir)).toBe(second)
    git('update-ref', 'refs/remotes/origin/master', first)
    expect(resolveBase(undefined, dir)).toBe(first)
  })

  it('resolveBase takes an explicit base and resolves it to a full SHA', () => {
    const first = commitFile('a.txt')
    commitFile('b.txt')
    expect(resolveBase('HEAD~1', dir)).toBe(first)
  })

  it('resolveBase throws when neither origin/master nor master exists', () => {
    git('symbolic-ref', 'HEAD', 'refs/heads/main')
    commitFile('a.txt')
    expect(() => resolveBase(undefined, dir)).toThrow(/no base/)
  })

  it('changedPaths lists what the branch committed since the base, not uncommitted edits', () => {
    commitFile('a.txt')
    const base = git('rev-parse', 'HEAD')
    expect(changedPaths(base, dir)).toEqual([])
    git('checkout', '-q', '-b', 'feature')
    commitFile('b.txt')
    commitFile('c.txt')
    fs.writeFileSync(path.join(dir, 'uncommitted.txt'), 'x')
    expect(changedPaths(base, dir).sort()).toEqual(['b.txt', 'c.txt'])
  })
})
