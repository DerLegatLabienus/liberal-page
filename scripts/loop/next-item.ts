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
// Named outright rather than left to gh's `{owner}/{repo}` placeholder, so the picker does not
// depend on how gh resolves the current repository in the cloud environment.
const REPO = process.env.LOOP_REPO ?? 'DerLegatLabienus/liberal-page'
// Parallel loop PRs are allowed, but not without bound: past this many open ones the loop
// waits, so an unattended month cannot leave a pile of PRs that conflict with each other.
const MAX_OPEN = Number(process.env.LOOP_MAX_OPEN ?? 3)

interface LoopPr extends LoopPrData {
  mergedAt: string | null
}

// Everything here uses GitHub's REST API through `gh api`. `gh pr list` and the other
// `gh pr …` subcommands use GraphQL, which Claude Code cloud sessions (where the loop runs)
// are not allowed to call.
interface RestPr {
  number: number
  title: string
  draft: boolean
  merged_at: string | null
  head: { ref: string; sha: string }
  labels: { name: string }[]
}

interface RestComment {
  body: string | null
  html_url: string
  user: { login: string; type: string } | null
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Every page of a REST list endpoint, as one array. `--jq '.[]'` prints one item per line. */
function restList<T>(endpoint: string): T[] {
  const out = gh(['api', '--paginate', endpoint, '--jq', '.[]'])
  return out.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T)
}

// Only REST reports a comment author's account type: the review app is `claude[bot]` /
// `Bot`, which a human account cannot imitate. Oldest comment first.
function listComments(pr: number): LoopPrData['comments'] {
  return restList<RestComment>(`repos/${REPO}/issues/${pr}/comments?per_page=100`).map((c) => ({
    authorLogin: c.user?.login ?? '',
    authorType: c.user?.type ?? '',
    body: c.body ?? '',
    url: c.html_url,
  }))
}

function listCommits(pr: number): LoopPrData['commits'] {
  return restList<{ commit: { message: string } }>(`repos/${REPO}/pulls/${pr}/commits?per_page=100`).map((c) => {
    const [headline, ...rest] = c.commit.message.split('\n')
    return { messageHeadline: headline, messageBody: rest.join('\n') }
  })
}

// The only functions that talk to GitHub; everything else in the loop is pure and tested.
// Commits and comments are fetched for open PRs only; closed PRs only need their ID.
function listLoopPrs(state: 'open' | 'closed'): LoopPr[] {
  // A loop PR is recognised by its branch shape or its label, so a PR that lost (or never
  // got) the label is still counted.
  return restList<RestPr>(`repos/${REPO}/pulls?state=${state}&per_page=100`)
    .filter((pr) => isLoopBranch(pr.head.ref) || pr.labels.some((l) => l.name === LOOP_LABEL))
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.head.ref,
      headRefOid: pr.head.sha,
      isDraft: pr.draft,
      mergedAt: pr.merged_at,
      commits: state === 'open' ? listCommits(pr.number) : [],
      comments: state === 'open' ? listComments(pr.number) : [],
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
