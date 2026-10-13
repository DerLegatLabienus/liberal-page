import { describe, it, expect } from 'vitest'
import {
  extractItemId,
  type IssueData,
  isLoopBranch,
  isLoopPullRequest,
  itemIdsOf,
  selectNextIssue,
} from '../../../scripts/loop/select-item'

const OWNER = 'DerLegatLabienus'
const none = new Set<string>()

function issue(number: number, labels: string[], overrides: Partial<IssueData> = {}): IssueData {
  return { number, title: `Issue ${number}`, labels, authorLogin: OWNER, isPullRequest: false, ...overrides }
}

describe('selectNextIssue', () => {
  it('picks a loop-safe issue and reports its number, id and title', () => {
    const picked = selectNextIssue([issue(15, ['loop-safe', 'P2'], { title: '  JoinSelector tokens ' })], OWNER, none)
    expect(picked).toEqual({ id: '#15', number: 15, title: 'JoinSelector tokens' })
  })

  it('skips issues without the loop-safe label', () => {
    expect(selectNextIssue([issue(12, ['P1']), issue(15, ['loop-safe', 'P2'])], OWNER, none)?.number).toBe(15)
  })

  it('refuses an issue labelled risky even when it is loop-safe', () => {
    expect(selectNextIssue([issue(20, ['loop-safe', 'risky', 'P0'])], OWNER, none)).toBeNull()
  })

  it('does not infer risk from the title', () => {
    const picked = selectNextIssue([issue(21, ['loop-safe'], { title: 'Rename a migration helper in the auth tests' })], OWNER, none)
    expect(picked?.number).toBe(21)
  })

  it('takes the most urgent priority first, whatever the issue numbers', () => {
    const issues = [issue(15, ['loop-safe', 'P2']), issue(40, ['loop-safe', 'P0']), issue(16, ['loop-safe', 'P1'])]
    expect(selectNextIssue(issues, OWNER, none)?.number).toBe(40)
  })

  it('takes the lowest issue number within a priority', () => {
    const issues = [issue(18, ['loop-safe', 'P2']), issue(15, ['loop-safe', 'P2']), issue(16, ['loop-safe', 'P2'])]
    expect(selectNextIssue(issues, OWNER, none)?.number).toBe(15)
  })

  it('sorts an issue with no priority label after P3', () => {
    const issues = [issue(5, ['loop-safe']), issue(30, ['loop-safe', 'P3'])]
    expect(selectNextIssue(issues, OWNER, none)?.number).toBe(30)
    expect(selectNextIssue([issue(5, ['loop-safe'])], OWNER, none)?.number).toBe(5)
  })

  it('uses the most urgent label when an issue carries two priorities', () => {
    const issues = [issue(15, ['loop-safe', 'P1']), issue(16, ['loop-safe', 'P3', 'P0'])]
    expect(selectNextIssue(issues, OWNER, none)?.number).toBe(16)
  })

  it('skips an excluded issue and moves on to the next', () => {
    const issues = [issue(15, ['loop-safe', 'P2']), issue(16, ['loop-safe', 'P2'])]
    expect(selectNextIssue(issues, OWNER, new Set(['#15']))?.number).toBe(16)
  })

  it('returns null when every eligible issue is excluded, and for no issues at all', () => {
    expect(selectNextIssue([issue(15, ['loop-safe'])], OWNER, new Set(['#15']))).toBeNull()
    expect(selectNextIssue([], OWNER, none)).toBeNull()
  })

  it('ignores an issue written by anyone but the repository owner, even if labelled', () => {
    const issues = [issue(50, ['loop-safe', 'P0'], { authorLogin: 'someone-else' }), issue(15, ['loop-safe', 'P2'])]
    expect(selectNextIssue(issues, OWNER, none)?.number).toBe(15)
    expect(selectNextIssue([issues[0]], OWNER, none)).toBeNull()
  })

  it('matches the owner and the labels without regard to case', () => {
    const picked = selectNextIssue([issue(15, ['Loop-Safe', 'p1'], { authorLogin: 'derlegatlabienus' })], OWNER, none)
    expect(picked?.number).toBe(15)
  })

  it('never takes a pull request, which the issues endpoint also returns', () => {
    expect(selectNextIssue([issue(11, ['loop-safe', 'loop'], { isPullRequest: true })], OWNER, none)).toBeNull()
  })

  it('does not treat the legacy ID of another item as an exclusion for an issue', () => {
    // An open PR from before the move excludes "LibPage-027", which is not issue #27.
    expect(selectNextIssue([issue(27, ['loop-safe'])], OWNER, new Set(['LibPage-027']))?.number).toBe(27)
  })

  it('excludes a migrated issue whose old ID had a loop PR before the move', () => {
    const migrated = issue(14, ['loop-safe'], { title: 'MkCard: replace hardcoded colours with tokens (LibPage-026)' })
    expect(selectNextIssue([migrated], OWNER, new Set(['LibPage-026']))).toBeNull()
    expect(selectNextIssue([migrated], OWNER, new Set(['LibPage-027']))?.number).toBe(14)
  })

  it('refuses the risky label in any case', () => {
    expect(selectNextIssue([issue(20, ['loop-safe', 'Risky'])], OWNER, none)).toBeNull()
  })

  it('refuses an issue labelled needs-developer, even if loop-safe was not removed', () => {
    expect(selectNextIssue([issue(15, ['loop-safe', 'needs-developer', 'P0'])], OWNER, none)).toBeNull()
    const issues = [issue(15, ['loop-safe', 'Needs-Developer']), issue(16, ['loop-safe'])]
    expect(selectNextIssue(issues, OWNER, none)?.number).toBe(16)
  })
})

describe('isLoopPullRequest', () => {
  const REPO = 'DerLegatLabienus/liberal-page'
  const own = { branch: 'fix/15-tokens', labels: [] as string[], authorLogin: OWNER, headRepo: REPO }

  it('accepts the owner\'s PR from this repository on a loop-shaped branch', () => {
    expect(isLoopPullRequest(own, REPO)).toBe(true)
    expect(isLoopPullRequest({ ...own, branch: 'refactor/LibPage-026-mkcard-tokens' }, REPO)).toBe(true)
  })

  it('accepts the owner\'s PR carrying the loop label whatever its branch is called', () => {
    expect(isLoopPullRequest({ ...own, branch: 'claude/some-branch', labels: ['Loop'] }, REPO)).toBe(true)
  })

  it('rejects a PR on an ordinary branch without the label', () => {
    expect(isLoopPullRequest({ ...own, branch: 'worktree-backlog-to-issues' }, REPO)).toBe(false)
  })

  it('rejects a loop-shaped branch from a fork, or one whose fork was deleted', () => {
    expect(isLoopPullRequest({ ...own, headRepo: 'a-stranger/liberal-page' }, REPO)).toBe(false)
    expect(isLoopPullRequest({ ...own, headRepo: null }, REPO)).toBe(false)
  })

  it('rejects a loop-shaped or loop-labelled PR by anyone but the owner', () => {
    expect(isLoopPullRequest({ ...own, authorLogin: 'a-stranger' }, REPO)).toBe(false)
    expect(isLoopPullRequest({ ...own, authorLogin: 'a-stranger', labels: ['loop'] }, REPO)).toBe(false)
  })

  it('matches the owner and the repository without regard to case', () => {
    expect(isLoopPullRequest({ ...own, authorLogin: 'derlegatlabienus', headRepo: REPO.toLowerCase() }, REPO)).toBe(true)
  })
})

describe('itemIdsOf', () => {
  it('reads the issue from the branch, the title and the body alike', () => {
    expect(itemIdsOf({ branch: 'fix/15-tokens', title: 'fix: tokens (#15)', body: 'Closes #15\n\nDetails.' })).toEqual(['#15'])
  })

  it('returns both IDs when the branch carries a legacy ID and the title the issue number', () => {
    const ids = itemIdsOf({ branch: 'refactor/LibPage-027-joinselector', title: 'refactor: tokens (#15)', body: '' })
    expect(ids.sort()).toEqual(['#15', 'LibPage-027'])
  })

  it('reads Closes and Refs lines from the body of a PR opened before the move', () => {
    const ids = itemIdsOf({
      branch: 'refactor/LibPage-026-mkcard-tokens',
      title: 'refactor(parliament): use design tokens in MkCard (LibPage-026)',
      body: 'LibPage-026 — MkCard\n\nCloses #14\n\nrefs #35 for the colours left in place.',
    })
    expect(ids.sort()).toEqual(['#14', '#35', 'LibPage-026'])
  })

  it('does not read a bare issue or PR number in the body as the PR\'s issue', () => {
    expect(itemIdsOf({ branch: 'fix/15-tokens', title: 'fix: tokens (#15)', body: 'Overlaps: #10, #11. See #12.' })).toEqual(['#15'])
  })

  it('returns nothing for a PR that names no item', () => {
    expect(itemIdsOf({ branch: 'claude/some-branch', title: 'chore: tidy', body: '' })).toEqual([])
  })
})

describe('isLoopBranch', () => {
  it('accepts a conventional type prefix followed by the issue number', () => {
    expect(isLoopBranch('fix/123-auth-button-token')).toBe(true)
    expect(isLoopBranch('feat/7-short-slug')).toBe(true)
    expect(isLoopBranch('docs/45')).toBe(true)
  })

  it('still accepts a branch from before the move to issues', () => {
    expect(isLoopBranch('fix/LibPage-009-auth-button-token')).toBe(true)
    expect(isLoopBranch('refactor/LibPage-026-mkcard-tokens')).toBe(true)
  })

  it('rejects branches without that shape', () => {
    expect(isLoopBranch('master')).toBe(false)
    expect(isLoopBranch('fix/auth-button-token')).toBe(false)
    expect(isLoopBranch('loop/123-thing')).toBe(false)
    expect(isLoopBranch('fix/123abc')).toBe(false)
    expect(isLoopBranch('worktree-backlog-to-issues')).toBe(false)
  })
})

describe('extractItemId', () => {
  it('reads the issue number from a branch name', () => {
    expect(extractItemId('fix/123-auth-button-token')).toBe('#123')
    expect(extractItemId('docs/45')).toBe('#45')
  })

  it('reads the issue number from a PR title', () => {
    expect(extractItemId('fix(auth): use the primary token (#123)')).toBe('#123')
  })

  it('reads a legacy ID from a branch or a title, normalising case', () => {
    expect(extractItemId('fix/LibPage-009-auth-button-token')).toBe('LibPage-009')
    expect(extractItemId('fix(auth): use the primary token (LibPage-009)')).toBe('LibPage-009')
    expect(extractItemId('fix/libpage-009-x')).toBe('LibPage-009')
  })

  it('prefers the issue number when a title quotes a legacy ID as well', () => {
    expect(extractItemId('refactor: JoinSelector tokens (LibPage-027) (#15)')).toBe('#15')
  })

  it('takes the number at the end of a title, not one mentioned earlier', () => {
    expect(extractItemId('fix: follow up to (#12) tokens (#15)')).toBe('#15')
    expect(extractItemId('fix: follow up to (#12) tokens')).toBeNull()
  })

  it('returns null when there is no ID', () => {
    expect(extractItemId('master')).toBeNull()
    expect(extractItemId('fix(auth): use the primary token')).toBeNull()
  })

  it('does not read a number that is not in the ID position', () => {
    expect(extractItemId('fix/auth-2-factor')).toBeNull()
    expect(extractItemId('chore: bump to 1.2.3 #456')).toBeNull()
  })
})
