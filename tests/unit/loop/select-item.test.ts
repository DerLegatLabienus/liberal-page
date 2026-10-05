import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { extractItemId, isLoopBranch, selectNextItem } from '../../../scripts/loop/select-item'

const none = new Set<string>()

function backlog(...items: string[]): string {
  return ['# Backlog', '', '## Now', '', '- **LibPage-001** — something', '', '---', '', ...items].join('\n')
}

function item(heading: string, body = 'Some description.'): string {
  return `## ${heading}\n\n${body}\n`
}

describe('selectNextItem', () => {
  it('picks the first tagged item in file order', () => {
    const text = backlog(
      item('LibPage-002 — Untagged thing'),
      item('LibPage-003 — First tagged [loop-safe]'),
      item('LibPage-004 — Second tagged [loop-safe]'),
    )
    expect(selectNextItem(text, none)).toEqual({ id: 'LibPage-003', title: 'First tagged' })
  })

  it('skips untagged items', () => {
    const text = backlog(item('LibPage-002 — Untagged'), item('LibPage-003 — Also untagged'))
    expect(selectNextItem(text, none)).toBeNull()
  })

  it('refuses a tagged item marked [risky] in its heading', () => {
    const text = backlog(
      item('LibPage-002 — Add a migration [loop-safe] [risky]'),
      item('LibPage-003 — Safe one [loop-safe]'),
    )
    expect(selectNextItem(text, none)?.id).toBe('LibPage-003')
  })

  it('refuses a tagged item marked [risky] in its body', () => {
    const text = backlog(item('LibPage-002 — Touches auth [loop-safe]', 'Changes the allowlist. [risky]'))
    expect(selectNextItem(text, none)).toBeNull()
  })

  it('refuses a tagged item whose status line says "Risky tier"', () => {
    const text = backlog(
      item('LibPage-002 — Workflow [loop-safe]', '**Status:** open. Risky tier (deploy + CI config).'),
    )
    expect(selectNextItem(text, none)).toBeNull()
  })

  it('does not infer risk from prose keywords', () => {
    const text = backlog(
      item('LibPage-002 — Docs for migrations and auth [loop-safe]', 'Explain how a migration and auth work.'),
    )
    expect(selectNextItem(text, none)?.id).toBe('LibPage-002')
  })

  it('skips a tagged item whose ID is rejected and moves on to the next', () => {
    const text = backlog(item('LibPage-002 — Rejected [loop-safe]'), item('LibPage-003 — Next [loop-safe]'))
    expect(selectNextItem(text, new Set(['LibPage-002']))?.id).toBe('LibPage-003')
  })

  it('moves past an item that is in flight to the next tagged one', () => {
    const text = backlog(
      item('LibPage-002 — Has an open PR [loop-safe]'),
      item('LibPage-003 — Was rejected [loop-safe]'),
      item('LibPage-004 — Free [loop-safe]'),
    )
    const inFlightAndRejected = new Set(['LibPage-002', 'LibPage-003'])
    expect(selectNextItem(text, inFlightAndRejected)?.id).toBe('LibPage-004')
  })

  it('picks a previously rejected item once it carries a new ID', () => {
    const text = backlog(item('LibPage-018 — Rejected, retried [loop-safe]'))
    expect(selectNextItem(text, new Set(['LibPage-002']))?.id).toBe('LibPage-018')
  })

  it('returns null when every tagged item is rejected', () => {
    const text = backlog(item('LibPage-002 — A [loop-safe]'), item('LibPage-003 — B [loop-safe]'))
    expect(selectNextItem(text, new Set(['LibPage-002', 'LibPage-003']))).toBeNull()
  })

  it('returns null for an empty backlog', () => {
    expect(selectNextItem('', none)).toBeNull()
    expect(selectNextItem('# Backlog\n\n## Now\n\n## Next\n', none)).toBeNull()
  })

  it('ignores a tagged heading with no ID', () => {
    const text = backlog(item('Quick idea [loop-safe]'), item('Now [loop-safe]'))
    expect(selectNextItem(text, none)).toBeNull()
  })

  it('does not treat sub-headings or list lines as items', () => {
    const text = backlog(
      item('LibPage-002 — Parent', '### LibPage-099 — nested [loop-safe]\n\n- **LibPage-098** — listed [loop-safe]'),
    )
    expect(selectNextItem(text, none)).toBeNull()
  })

  it('does not let one item\'s risky marker leak into the next', () => {
    const text = backlog(
      item('LibPage-002 — Risky, untagged', '**Status:** open. Risky tier.'),
      item('LibPage-003 — Safe [loop-safe]'),
    )
    expect(selectNextItem(text, none)?.id).toBe('LibPage-003')
  })

  it('strips tags and a trailing priority note from the title', () => {
    const text = backlog(item('LibPage-002 — Fix the colour [loop-safe] (Priority: Low)'))
    expect(selectNextItem(text, none)).toEqual({ id: 'LibPage-002', title: 'Fix the colour' })
  })

  it('accepts a plain hyphen or en dash after the ID', () => {
    expect(selectNextItem(backlog(item('LibPage-004 - Hyphen [loop-safe]')), none)?.id).toBe('LibPage-004')
    expect(selectNextItem(backlog(item('LibPage-005 – En dash [loop-safe]')), none)?.id).toBe('LibPage-005')
  })

  it('refuses an item that says "risky tier" anywhere in its body, not only on the status line', () => {
    const text = backlog(
      item('LibPage-006 — Late marker [loop-safe]', 'Intro paragraph.\n\nLater note: this is risky tier work.'),
      item('LibPage-007 — Safe [loop-safe]'),
    )
    expect(selectNextItem(text, none)?.id).toBe('LibPage-007')
  })

  // Must stay green whatever is tagged in the real file: tagging an item is a normal edit.
  it('parses the real BACKLOG.md: every LibPage heading is an item, and the pick is one of them', () => {
    const text = readFileSync(path.resolve(__dirname, '../../../BACKLOG.md'), 'utf8')
    const headings = text.split(/\r?\n/).filter((l) => l.startsWith('## LibPage-'))
    expect(headings.length).toBeGreaterThan(0)
    for (const h of headings) {
      const id = extractItemId(h)!
      const alone = selectNextItem(`${h.replace(/\[risky\]/gi, '')} [loop-safe]\n\nbody\n`, none)
      expect(alone?.id, h).toBe(id)
    }
    const picked = selectNextItem(text, none)
    if (picked) expect(headings.some((h) => extractItemId(h) === picked.id)).toBe(true)
  })
})

describe('isLoopBranch', () => {
  it('accepts a conventional type prefix followed by the item ID', () => {
    expect(isLoopBranch('fix/LibPage-009-auth-button-token')).toBe(true)
    expect(isLoopBranch('feat/LibPage-012-translate-protocols')).toBe(true)
    expect(isLoopBranch('docs/libpage-020')).toBe(true)
  })

  it('rejects branches without that shape', () => {
    expect(isLoopBranch('master')).toBe(false)
    expect(isLoopBranch('fix/auth-button')).toBe(false)
    expect(isLoopBranch('loop/LibPage-009-x')).toBe(false)
    expect(isLoopBranch('feat/LibPage-0091x')).toBe(false)
    expect(isLoopBranch('dependabot/npm/LibPage-1')).toBe(false)
  })
})

describe('extractItemId', () => {
  it('reads the ID from a branch name', () => {
    expect(extractItemId('fix/LibPage-009-auth-control-token')).toBe('LibPage-009')
  })

  it('reads the ID from a PR title', () => {
    expect(extractItemId('fix(auth): use the primary token in AuthControl (LibPage-009)')).toBe('LibPage-009')
  })

  it('normalises case', () => {
    expect(extractItemId('loop/libpage-012-x')).toBe('LibPage-012')
  })

  it('returns null when there is no ID', () => {
    expect(extractItemId('fix/some-branch')).toBeNull()
    expect(extractItemId('')).toBeNull()
  })

  it('does not match a longer number as a shorter ID', () => {
    expect(extractItemId('loop/LibPage-0091-x')).toBe('LibPage-0091')
  })
})
