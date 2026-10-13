// Pure selection of the loop's next issue (spec:
// docs/superpowers/specs/2026-10-13-backlog-to-github-issues-design.md). No I/O here —
// next-item.ts supplies the issues and the IDs to skip.

export interface LoopItem {
  /** The issue as it is written in branch names, titles and `Closes` lines: `#123`. */
  id: string
  number: number
  title: string
}

/** What the picker needs to know about one GitHub issue. */
export interface IssueData {
  number: number
  title: string
  labels: string[]
  authorLogin: string
  /** GitHub's issues endpoint also returns pull requests; those are never items. */
  isPullRequest: boolean
}

const LOOP_SAFE = 'loop-safe'
const RISKY = 'risky'
const NEEDS_DEVELOPER = 'needs-developer'
const LOOP_LABEL = 'loop'
// A migrated issue keeps its old backlog ID at the end of its title: `… (LibPage-027)`.
const LEGACY_TITLE_ID = /\(libpage-(\d+)\)/i
// P0 is the most urgent. An issue with no priority label sorts after P3.
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

function priorityRank(labels: string[]): number {
  const ranks = labels.map((label) => PRIORITIES.indexOf(label.toUpperCase())).filter((rank) => rank >= 0)
  return ranks.length > 0 ? Math.min(...ranks) : PRIORITIES.length
}

function hasLabel(labels: string[], name: string): boolean {
  return labels.some((label) => label.toLowerCase() === name)
}

function isExcluded(issue: IssueData, excludedIds: Set<string>): boolean {
  if (excludedIds.has(`#${issue.number}`)) return true
  // A PR opened before the move to issues names the old backlog ID, not the issue number.
  const legacy = LEGACY_TITLE_ID.exec(issue.title)
  return legacy !== null && excludedIds.has(`LibPage-${legacy[1]}`)
}

/**
 * The issue the loop takes next: written by the repository owner, labelled `loop-safe`, not
 * labelled `risky` or `needs-developer`, and not excluded. Most urgent priority first, then the
 * lowest issue number.
 *
 * Risk is never inferred from an issue's wording: only the `risky` label refuses it.
 * `needs-developer` refuses it too, so that an issue the loop handed back stays out of the queue
 * even if removing `loop-safe` failed. `excludedIds` holds every item that ever had a loop PR
 * (open, rejected or merged), so no issue is taken twice. Only the owner's issues count because
 * the repository is public: anyone can open an issue, and a maintainer adding a label to it
 * must not make its text instructions.
 */
export function selectNextIssue(issues: IssueData[], owner: string, excludedIds: Set<string>): LoopItem | null {
  const eligible = issues.filter(
    (issue) =>
      !issue.isPullRequest &&
      issue.authorLogin.toLowerCase() === owner.toLowerCase() &&
      hasLabel(issue.labels, LOOP_SAFE) &&
      !hasLabel(issue.labels, RISKY) &&
      !hasLabel(issue.labels, NEEDS_DEVELOPER) &&
      !isExcluded(issue, excludedIds),
  )
  eligible.sort((a, b) => priorityRank(a.labels) - priorityRank(b.labels) || a.number - b.number)
  const next = eligible[0]
  return next ? { id: `#${next.number}`, number: next.number, title: next.title.trim() } : null
}

// Loop branches are ordinary short-lived trunk-based branches: a conventional-commit type,
// then the issue number, e.g. `fix/123-auth-button-token`. Developer sessions never open PRs
// (trunk lane), so a PR from a branch of this shape is the loop's. Branches from before the
// backlog moved to issues carry a `LibPage-NNN` ID instead and are still recognised.
const LOOP_BRANCH = /^(feat|fix|docs|refactor|perf|test|chore|style)\/(LibPage-\d+|\d+)(-|$)/i

export function isLoopBranch(branch: string): boolean {
  return LOOP_BRANCH.test(branch)
}

/** Where a pull request came from, as far as recognising the loop's own PRs needs. */
export interface PrOrigin {
  branch: string
  labels: string[]
  authorLogin: string
  /** `owner/name` of the repository the branch lives in; null when that fork was deleted. */
  headRepo: string | null
}

/**
 * True for a pull request the loop opened: a loop-shaped branch or the `loop` label, AND
 * authored by the repository owner from a branch in this repository. The loop posts as the
 * owner. Without the second half, anyone could open PRs from a fork with loop-shaped branch
 * names and so fill the open-PR limit or get issues excluded.
 */
export function isLoopPullRequest(pr: PrOrigin, repo: string): boolean {
  const owner = repo.split('/')[0]
  return (
    pr.authorLogin.toLowerCase() === owner.toLowerCase() &&
    pr.headRepo?.toLowerCase() === repo.toLowerCase() &&
    (isLoopBranch(pr.branch) || hasLabel(pr.labels, LOOP_LABEL))
  )
}

const LEGACY_ID = /libpage-(\d+)/i
const BRANCH_NUMBER = /^[a-z]+\/(\d+)(?:-|$)/i
// Only at the end of the title: `fix: follow up to (#12) tokens (#15)` is about issue 15.
const TITLE_NUMBER = /\(#(\d+)\)\s*$/
const BODY_REFS = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)/gi

/**
 * The item a loop branch name or PR title refers to, or null: `#123` for an issue (from a
 * branch `fix/123-slug` or a title ending `(#123)`), or `LibPage-NNN` for a PR opened before
 * the backlog moved to issues.
 */
export function extractItemId(text: string): string | null {
  // The issue number wins when both appear: a migrated issue keeps its old `LibPage-NNN` in its
  // title, and a PR title may quote it next to the `(#123)` that actually identifies the issue.
  const issue = BRANCH_NUMBER.exec(text) ?? TITLE_NUMBER.exec(text)
  if (issue) return `#${issue[1]}`
  const legacy = LEGACY_ID.exec(text)
  return legacy ? `LibPage-${legacy[1]}` : null
}

/**
 * Every item a loop PR refers to: the ID in its branch name, the ID in its title, and each
 * issue its body closes or refers to (`Closes #123`, `Refs #123`). All of them, not the first
 * found, because they can differ: a branch may carry a legacy `LibPage-NNN` while the title
 * ends `(#15)`, and a PR opened before the move to issues names its issue only in its body.
 */
export function itemIdsOf(pr: { branch: string; title: string; body: string }): string[] {
  const ids = new Set<string>()
  for (const id of [extractItemId(pr.branch), extractItemId(pr.title)]) {
    if (id) ids.add(id)
  }
  for (const match of pr.body.matchAll(BODY_REFS)) ids.add(`#${match[1]}`)
  return [...ids]
}
