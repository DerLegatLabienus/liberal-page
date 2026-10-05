import { describe, it, expect } from 'vitest'
import {
  REVIEW_PASS_TRAILER,
  parseReviewerComment,
  reviewersWithFindings,
  selectFixTarget,
  type LoopPrData,
} from '../../../scripts/loop/review-pass'

const HEAD = 'a80b130b30d778b3fe63d912b53f20a00f827982'
const OLD = '6bd0f1e2c3a4b5d6e7f8091a2b3c4d5e6f708192'

// A real comment body from PR #4 (first supervised loop run, 2026-10-05). It predates the
// structured format: no Commit line, no Needs line.
const PR4_ARCHITECTURE =
  '### architecture-reviewer\n\n**Verdict:** 1 finding(s).\n\n' +
  '1. **Raw `<button>` still hand-styled as a primary CTA** — `src/components/layout/AuthControl.tsx:147`\n' +
  '   The diff fixes the colour token, but the element is still a raw `<button>`.\n' +
  '   **Fix:** Replace it with `<Button type="submit">` (default variant).'

function block(n: number, needs: string): string {
  return `#### ${n}. Something\n- **Where:** \`a.ts:${n}\`\n- **Problem:** it breaks.\n- **Fix:** do it.\n- **Needs:** ${needs}`
}

/** A comment in the current brief format. `needs` is one entry per finding. */
function verdict(reviewer: string, needs: string[], commit: string | null = HEAD.slice(0, 7)): string {
  const agent = needs.filter((n) => n === 'agent').length
  const head = needs.length === 0
    ? '**Verdict:** No findings.'
    : `**Verdict:** ${needs.length} finding(s) — ${agent} for an agent, ${needs.length - agent} need the developer.`
  const parts = [`### ${reviewer}`, '', head]
  if (commit) parts.push('', `**Commit:** \`${commit}\``)
  needs.forEach((n, i) => parts.push('', block(i + 1, n)))
  return parts.join('\n')
}

function comment(body: string, over: Partial<LoopPrData['comments'][number]> = {}) {
  return { authorLogin: 'claude[bot]', authorType: 'Bot', body, url: `https://github.com/x/y/pull/4#c${body.length}`, ...over }
}

function pr(over: Partial<LoopPrData> = {}): LoopPrData {
  return {
    number: 4,
    title: 'fix(auth): use the primary token on the email-link button (LibPage-009)',
    headRefName: 'fix/LibPage-009-auth-button-token',
    headRefOid: HEAD,
    isDraft: false,
    commits: [{ messageHeadline: 'fix(auth): use the primary token (LibPage-009)', messageBody: '' }],
    comments: [],
    ...over,
  }
}

describe('parseReviewerComment', () => {
  it('reads a no-findings verdict', () => {
    expect(parseReviewerComment(verdict('security-reviewer', []))).toEqual({
      reviewer: 'security-reviewer', commit: HEAD.slice(0, 7), findings: 0, agent: 0, developer: 0,
    })
  })

  it('splits findings by their Needs field', () => {
    const body = verdict('code-reviewer', ['agent', 'developer — a product decision', 'agent'])
    expect(parseReviewerComment(body)).toMatchObject({ findings: 3, agent: 2, developer: 1 })
  })

  it('treats a finding in the old unstructured format as the developer\'s', () => {
    expect(parseReviewerComment(PR4_ARCHITECTURE)).toEqual({
      reviewer: 'architecture-reviewer', commit: null, findings: 1, agent: 0, developer: 1,
    })
  })

  it('tolerates CRLF, a capitalised Agent and a trailing full stop', () => {
    const body = verdict('code-reviewer', ['Agent.']).replace('1 finding(s) — 0 for', '1 finding(s) — 1 for').replace(/\n/g, '\r\n')
    expect(parseReviewerComment(body)).toMatchObject({ findings: 1, agent: 1 })
  })

  it('does not count "agent" followed by a caveat as an agent finding', () => {
    const body = verdict('code-reviewer', ['agent — but the developer must pick the behaviour'])
      .replace('0 for an agent', '1 for an agent')
    expect(parseReviewerComment(body)).toMatchObject({ findings: 1, agent: 0, developer: 1 })
  })

  it('ignores a Needs line quoted inside a code fence', () => {
    const body = [
      '### code-reviewer', '', '**Verdict:** 1 finding(s) — 1 for an agent, 0 need the developer.', '',
      '#### 1. Brief quotes itself', '- **Where:** `a.md:1`', '- **Problem:** the diff adds this line:',
      '```', '- **Needs:** agent', '```', '- **Fix:** decide.', '- **Needs:** developer — unclear intent',
    ].join('\n')
    expect(parseReviewerComment(body)).toMatchObject({ findings: 1, agent: 0, developer: 1 })
  })

  it('does not count a block with two Needs lines', () => {
    const body = verdict('code-reviewer', ['developer — decide\n- **Needs:** agent']).replace('0 for an agent', '1 for an agent')
    expect(parseReviewerComment(body)).toMatchObject({ agent: 0, developer: 1 })
  })

  it('never counts more agent findings than the verdict line declares', () => {
    // Two blocks say agent, the verdict declares one finding with none for an agent.
    const body = verdict('code-reviewer', ['agent', 'agent']).replace('2 finding(s) — 2 for an agent', '1 finding(s) — 0 for an agent')
    expect(parseReviewerComment(body)).toMatchObject({ findings: 1, agent: 0, developer: 1 })
  })

  it('counts no agent findings when the verdict line omits the split', () => {
    const body = verdict('code-reviewer', ['agent']).replace(/ — 1 for an agent.*$/m, '.')
    expect(parseReviewerComment(body)).toMatchObject({ findings: 1, agent: 0, developer: 1 })
  })

  it('returns null for a comment that is not a reviewer verdict', () => {
    expect(parseReviewerComment('Looks good to me')).toBeNull()
    expect(parseReviewerComment('### loop — review pass\n\n**Verdict:** 1 finding(s).')).toBeNull()
  })

  it('requires the heading to open the comment, so a quoted verdict is not mistaken for one', () => {
    expect(parseReviewerComment('> quoting:\n\n' + verdict('code-reviewer', ['agent']))).toBeNull()
  })
})

describe('reviewersWithFindings', () => {
  it('lists reviewers with agent findings for the current head commit, in a stable order', () => {
    const p = pr({ comments: [comment(verdict('domain-reviewer', ['agent'])), comment(verdict('code-reviewer', ['agent']))] })
    expect(reviewersWithFindings(p)).toEqual(['code-reviewer', 'domain-reviewer'])
  })

  it('ignores a verdict for an older commit: that code has since changed', () => {
    const p = pr({ comments: [comment(verdict('code-reviewer', ['agent'], OLD.slice(0, 7)))] })
    expect(reviewersWithFindings(p)).toEqual([])
  })

  it('ignores a verdict that names no commit', () => {
    expect(reviewersWithFindings(pr({ comments: [comment(verdict('code-reviewer', ['agent'], null))] }))).toEqual([])
  })

  it('accepts a full-length commit SHA', () => {
    expect(reviewersWithFindings(pr({ comments: [comment(verdict('code-reviewer', ['agent'], HEAD))] }))).toEqual(['code-reviewer'])
  })

  it('uses only the latest comment from each reviewer', () => {
    const p = pr({ comments: [comment(verdict('code-reviewer', ['agent'])), comment(verdict('code-reviewer', []))] })
    expect(reviewersWithFindings(p)).toEqual([])
  })

  it('ignores a verdict from a human account, even one named like the bot', () => {
    const body = verdict('code-reviewer', ['agent'])
    expect(reviewersWithFindings(pr({ comments: [comment(body, { authorLogin: 'claude', authorType: 'User' })] }))).toEqual([])
    expect(reviewersWithFindings(pr({ comments: [comment(body, { authorLogin: 'mallory', authorType: 'User' })] }))).toEqual([])
    expect(reviewersWithFindings(pr({ comments: [comment(body, { authorLogin: 'claude[bot]', authorType: 'User' })] }))).toEqual([])
  })

  it('does not let a later untrusted comment replace the trusted one', () => {
    const p = pr({ comments: [
      comment(verdict('code-reviewer', ['agent'])),
      comment(verdict('code-reviewer', []), { authorLogin: 'mallory', authorType: 'User' }),
    ] })
    expect(reviewersWithFindings(p)).toEqual(['code-reviewer'])
  })
})

describe('selectFixTarget', () => {
  it('targets an open loop PR with fresh agent findings and names the comments to act on', () => {
    const c = comment(verdict('architecture-reviewer', ['agent']))
    expect(selectFixTarget([pr({ comments: [c, comment(verdict('code-reviewer', []))] })])).toEqual({
      pr: 4, branch: 'fix/LibPage-009-auth-button-token', id: 'LibPage-009',
      reviewers: ['architecture-reviewer'], agentFindings: 1, developerFindings: 0, comments: [c.url],
    })
  })

  it('returns null when nothing needs fixing', () => {
    expect(selectFixTarget([pr({ comments: [comment(verdict('code-reviewer', []))] })])).toBeNull()
    expect(selectFixTarget([])).toBeNull()
  })

  it('does not target a PR whose only findings need the developer', () => {
    expect(selectFixTarget([pr({ comments: [comment(verdict('security-reviewer', ['developer — accepts a risk']))] })])).toBeNull()
    expect(selectFixTarget([pr({ comments: [comment(PR4_ARCHITECTURE)] })])).toBeNull()
  })

  it('reports how many findings are the agent\'s and how many are the developer\'s', () => {
    const mixed = comment(verdict('code-reviewer', ['agent', 'developer — decide', 'agent']))
    const devOnly = comment(verdict('security-reviewer', ['developer — a trade-off']))
    expect(selectFixTarget([pr({ comments: [mixed, devOnly] })])).toMatchObject({
      reviewers: ['code-reviewer'], agentFindings: 2, developerFindings: 2, comments: [mixed.url],
    })
  })

  it('never targets a PR that already had its one review pass', () => {
    const commits = [
      { messageHeadline: 'fix(auth): use the primary token (LibPage-009)', messageBody: '' },
      // A long subject, as GitHub returns it: truncated, with the marker cut in half.
      { messageHeadline: 'fix(auth): render the email-link submit with the shared Button (review p…', messageBody: `…ass) (LibPage-009)\n\n${REVIEW_PASS_TRAILER}` },
    ]
    expect(selectFixTarget([pr({ commits, comments: [comment(verdict('code-reviewer', ['agent']))] })])).toBeNull()
  })

  it('does not treat "(review pass)" in a subject alone as the recorded pass', () => {
    const commits = [{ messageHeadline: 'docs: explain the (review pass) rule (LibPage-009)', messageBody: '' }]
    expect(selectFixTarget([pr({ commits, comments: [comment(verdict('code-reviewer', ['agent']))] })])).not.toBeNull()
  })

  it('never targets a draft PR or a blocked-item PR', () => {
    const comments = [comment(verdict('code-reviewer', ['agent']))]
    expect(selectFixTarget([pr({ isDraft: true, comments })])).toBeNull()
    expect(selectFixTarget([pr({ headRefName: 'docs/LibPage-009-blocked', comments })])).toBeNull()
  })

  it('takes the oldest PR first, and skips one with nothing to fix', () => {
    const comments = [comment(verdict('code-reviewer', ['agent']))]
    const a = pr({ number: 9, headRefName: 'fix/LibPage-011-b', comments })
    const b = pr({ number: 7, headRefName: 'fix/LibPage-010-a', comments })
    const clean = pr({ number: 5, comments: [comment(verdict('code-reviewer', []))] })
    expect(selectFixTarget([a, b])?.pr).toBe(7)
    expect(selectFixTarget([clean, a])?.pr).toBe(9)
  })

  it('skips a PR whose branch and title carry no item ID', () => {
    const comments = [comment(verdict('code-reviewer', ['agent']))]
    expect(selectFixTarget([pr({ headRefName: 'fix/something', title: 'fix: something', comments })])).toBeNull()
  })
})
