// CLI for the weekly loop: prints what this run should do, as JSON, or "none".
//   {"action":"fix","pr":N,"branch":"…","id":"#123","reviewers":[…],"agentFindings":A,"developerFindings":D,"comments":[url…]}
//       an open loop PR has reviewer findings an agent may fix — fix those, start nothing new
//   {"action":"new","id":"#123","number":123,"title":"…","openPrs":[…]}       build this issue
//       (+ "plan":{url,body},"approval":{url,body} when it is built from an approved plan)
//   {"action":"plan","id":"#123","number":123,"title":"…","openPrs":[…]}      write a plan
//       (+ "revise":{"plan":{url,body},"feedback":[{url,body}…]} when the developer answered it)
// The backlog is the repository's GitHub issues; `id` is the issue number as written in branch
// names and PR titles. A PR opened before the move to issues carries a `LibPage-NNN` id instead.
// Usage: npm run loop:next
// Exit codes: 0 = printed an action or "none"; 2 = too many loop PRs open and no plan to write;
//             1 = gh failed.
import { execFileSync } from 'node:child_process'
import { type RestIssueComment, toPlanComment } from './issue'
import { type LoopPrData, selectFixTarget } from './review-pass'
import {
  actionPayload,
  eligibleIssues,
  type IssueData,
  isLoopPullRequest,
  itemIdsOf,
  needsPlan,
  selectNextAction,
} from './select-item'

// Named outright rather than left to gh's `{owner}/{repo}` placeholder, so the picker does not
// depend on how gh resolves the current repository in the cloud environment.
const REPO = process.env.LOOP_REPO ?? 'DerLegatLabienus/liberal-page'
// Parallel loop PRs are allowed, but not without bound: past this many open ones the loop
// waits, so an unattended month cannot leave a pile of PRs that conflict with each other.
const MAX_OPEN = Number(process.env.LOOP_MAX_OPEN ?? 3)

interface LoopPr extends LoopPrData {
  mergedAt: string | null
  body: string
}

// Everything here uses GitHub's REST API through `gh api`. `gh pr list` and the other
// `gh pr …` subcommands use GraphQL, which Claude Code cloud sessions (where the loop runs)
// are not allowed to call.
interface RestPr {
  number: number
  title: string
  draft: boolean
  merged_at: string | null
  body: string | null
  user: { login: string } | null
  head: { ref: string; sha: string; repo: { full_name: string } | null }
  labels: { name: string }[]
}

interface RestIssue {
  number: number
  title: string
  labels: { name: string }[]
  user: { login: string } | null
  pull_request?: unknown
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
  // got) the label is still counted — but only when the owner opened it from this repository.
  return restList<RestPr>(`repos/${REPO}/pulls?state=${state}&per_page=100`)
    .filter((pr) =>
      isLoopPullRequest(
        {
          branch: pr.head.ref,
          labels: pr.labels.map((l) => l.name),
          authorLogin: pr.user?.login ?? '',
          headRepo: pr.head.repo?.full_name ?? null,
        },
        REPO,
      ),
    )
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      headRefName: pr.head.ref,
      headRefOid: pr.head.sha,
      isDraft: pr.draft,
      mergedAt: pr.merged_at,
      commits: state === 'open' ? listCommits(pr.number) : [],
      comments: state === 'open' ? listComments(pr.number) : [],
    }))
}

// Open issues carrying the `ready-for-agent` label. The endpoint returns pull requests too, and
// issues from any author; selectNextIssue filters both.
function listCandidateIssues(): IssueData[] {
  return restList<RestIssue>(`repos/${REPO}/issues?state=open&labels=ready-for-agent&per_page=100`).map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map((l) => l.name),
    authorLogin: issue.user?.login ?? '',
    isPullRequest: issue.pull_request !== undefined,
  }))
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

  // Skip every issue that ever had a loop PR: in flight (open), rejected (closed unmerged),
  // or done (merged). A merged PR normally closed its issue already; excluding it anyway
  // covers a PR that only referred to the issue, so a part-done issue is not taken again
  // until the developer files a new one.
  const excluded = new Set<string>()
  for (const pr of [...open, ...listLoopPrs('closed')]) {
    for (const id of itemIdsOf({ branch: pr.headRefName, title: pr.title, body: pr.body })) excluded.add(id)
  }

  // Only the repository owner's issues are instructions; see selectNextIssue. Comments are
  // fetched only for the eligible issues that need a plan: plan approval is read from them.
  const owner = REPO.split('/')[0]
  const issues = eligibleIssues(listCandidateIssues(), owner, excluded)
  for (const issue of issues) {
    if (needsPlan(issue.labels)) issue.comments = listIssueComments(issue.number)
  }

  // The open-PR limit stops new builds only; a run at the limit may still write a plan.
  const atLimit = open.length >= MAX_OPEN
  const next = selectNextAction(issues, owner, excluded, { canBuild: !atLimit })
  if (!next && atLimit) {
    const list = open.map((pr) => `#${pr.number} ${pr.title}`).join('; ')
    console.error(`${open.length} loop PRs are open (limit ${MAX_OPEN}) and no plan is due — nothing to do until one is merged or closed: ${list}`)
    process.exit(2)
  }
  // `openPrs` lets the agent check its change against work already in flight.
  console.log(next ? JSON.stringify(actionPayload(next, open.map((pr) => pr.number))) : 'none')
}

// Every comment on one issue, oldest first, with the fields plan approval needs (app stamp,
// author association, created and edited times).
function listIssueComments(issue: number): NonNullable<IssueData['comments']> {
  return restList<RestIssueComment>(`repos/${REPO}/issues/${issue}/comments?per_page=100`).map(toPlanComment)
}

try {
  main()
} catch (err) {
  console.error(`loop:next failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
