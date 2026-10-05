// CLI for the weekly loop: prints what this run should do, as JSON, or "none".
//   {"action":"fix","pr":N,"branch":"…","id":"LibPage-NNN","reviewers":[…],"agentFindings":A,"developerFindings":D,"comments":[url…]}
//       an open loop PR has reviewer findings an agent may fix — fix those, start nothing new
//   {"action":"new","id":"LibPage-NNN","title":"…","openPrs":[…]}             take this backlog item
// Usage: npm run loop:next
// Exit codes: 0 = printed an action or "none"; 2 = too many loop PRs already open; 1 = gh failed.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type LoopPrData, selectFixTarget } from './review-pass'
import { extractItemId, isLoopBranch, selectNextItem } from './select-item'

const LOOP_LABEL = 'loop'
// Parallel loop PRs are allowed, but not without bound: past this many open ones the loop
// waits, so an unattended month cannot leave a pile of PRs that conflict with each other.
const MAX_OPEN = Number(process.env.LOOP_MAX_OPEN ?? 3)

interface LoopPr extends LoopPrData {
  mergedAt: string | null
}

interface RawPr {
  number: number
  title: string
  headRefName: string
  headRefOid?: string
  isDraft: boolean
  mergedAt: string | null
  labels: { name: string }[]
  commits?: { messageHeadline: string; messageBody: string }[]
}

interface RestComment {
  body: string
  html_url: string
  user: { login: string; type: string } | null
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

// Comments come from the REST API, not `gh pr list --json comments`, because only REST
// reports the author's account type: the review app is `claude[bot]` / `Bot`, which a human
// account cannot imitate. One JSON object per line, every page, oldest comment first.
function listComments(pr: number): LoopPrData['comments'] {
  const out = gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`,
    '--jq', '.[] | {body, html_url, user: {login: .user.login, type: .user.type}}'])
  return out.split('\n').filter((line) => line.trim() !== '').map((line) => {
    const c = JSON.parse(line) as RestComment
    return {
      authorLogin: c.user?.login ?? '',
      authorType: c.user?.type ?? '',
      body: c.body ?? '',
      url: c.html_url,
    }
  })
}

// The only functions that talk to GitHub; everything else in the loop is pure and tested.
// Commits and comments are fetched for open PRs only: GitHub's GraphQL API rejects the
// commits query at a 200-PR page size, and closed PRs only need their merged state.
function listLoopPrs(state: 'open' | 'closed'): LoopPr[] {
  const detailed = state === 'open'
  const fields = 'number,title,headRefName,isDraft,mergedAt,labels' + (detailed ? ',headRefOid,commits' : '')
  const out = gh(['pr', 'list', '--state', state, '--limit', detailed ? '30' : '200', '--json', fields])
  // A loop PR is recognised by its branch shape or its label, so a PR that lost (or never
  // got) the label is still counted.
  return (JSON.parse(out) as RawPr[])
    .filter((pr) => isLoopBranch(pr.headRefName) || pr.labels.some((l) => l.name === LOOP_LABEL))
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      headRefOid: pr.headRefOid ?? '',
      isDraft: pr.isDraft,
      mergedAt: pr.mergedAt,
      commits: (pr.commits ?? []).map((c) => ({ messageHeadline: c.messageHeadline, messageBody: c.messageBody ?? '' })),
      comments: detailed ? listComments(pr.number) : [],
    }))
}

function itemIdOf(pr: LoopPr): string | null {
  return extractItemId(pr.headRefName) ?? extractItemId(pr.title)
}

function main(): void {
  const open = listLoopPrs('open')

  // Finishing work in flight comes before starting more: if a loop PR has reviewer findings
  // not yet addressed, this run fixes those and takes no new item. This applies even at the
  // open-PR limit, since it adds no PR.
  const fix = selectFixTarget(open)
  if (fix) {
    console.log(JSON.stringify({ action: 'fix', ...fix }))
    return
  }

  if (open.length >= MAX_OPEN) {
    const list = open.map((pr) => `#${pr.number} ${pr.title}`).join('; ')
    console.error(`${open.length} loop PRs are open (limit ${MAX_OPEN}) — nothing to do until one is merged or closed: ${list}`)
    process.exit(2)
  }

  // Skip every item that ever had a loop PR: in flight (open), rejected (closed unmerged),
  // or done (merged). A merged item is normally gone from the backlog already; excluding it
  // anyway keeps a stale checkout from redoing it, and means a blocked item whose
  // explanation PR was merged is only retried under a new ID.
  const excluded = new Set<string>()
  for (const pr of [...open, ...listLoopPrs('closed')]) {
    const id = itemIdOf(pr)
    if (id) excluded.add(id)
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const item = selectNextItem(readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), excluded)
  // `openPrs` lets the agent check its change against work already in flight.
  console.log(item ? JSON.stringify({ action: 'new', ...item, openPrs: open.map((pr) => pr.number) }) : 'none')
}

try {
  main()
} catch (err) {
  console.error(`loop:next failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
