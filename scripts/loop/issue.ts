// CLI for the loop: prints one issue as the loop is allowed to read it — the body, then the
// developer's own comments. Everything else on the issue is left out.
// Usage: npm run -s loop:issue -- 123
// Exit codes: 0 = printed; 1 = bad usage, or gh failed.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.LOOP_REPO ?? 'DerLegatLabienus/liberal-page'

export interface IssueComment {
  authorLogin: string
  body: string
  /** GitHub's `performed_via_github_app.slug`: set when the comment was posted through an app. */
  appSlug?: string | null
}

/** A comment with everything plan approval needs. All fields come from GitHub's REST API. */
export interface PlanComment extends IssueComment {
  appSlug: string | null
  /** GitHub's `author_association`: OWNER, COLLABORATOR, MEMBER, CONTRIBUTOR, NONE, … */
  authorAssociation: string
  createdAt: string
  updatedAt: string
  url: string
}

// Every comment the loop posts carries a heading of this shape: `### loop — blocked`, with a
// dash after the word. The dash is required so that a developer's own heading such as
// `### loop-progress notes` is not mistaken for one. Any line may match, not only the first, so a
// loop comment that was posted with something above its heading is still recognised.
const LOOP_HEADING = /^\s*###\s+loop\s+[—–-]/im

/**
 * True for a comment the loop posted: it carries GitHub's app stamp (the cloud routine posts
 * through the Claude app, and an app cannot post without leaving it), or a `### loop — `
 * heading. A comment with neither is the developer's.
 */
export function isLoopComment(comment: IssueComment): boolean {
  return Boolean(comment.appSlug) || LOOP_HEADING.test(comment.body)
}

/**
 * The comments the loop may treat as the developer's words: written by the repository owner and
 * not one of the loop's own. The loop posts as the owner's account, so its comments have to be
 * recognised by their stamp or heading; without this it would read its own past output as
 * instructions. Anyone else's comment is dropped because the repository is public.
 */
export function developerComments(comments: IssueComment[], owner: string): IssueComment[] {
  return comments.filter((comment) => isOwner(comment.authorLogin, owner) && !isLoopComment(comment))
}

// A plan comment's heading: `### loop — plan` (also on a revised plan).
const PLAN_HEADING = /^\s*###\s+loop\s+[—–-]\s*plan\b/im
// Who may approve (spec, "Approving a plan"). CONTRIBUTOR only means a commit was once merged.
const APPROVERS = new Set(['OWNER', 'COLLABORATOR', 'MEMBER'])
const APPROVED = /^\s*approved\b/i

export type PlanState =
  | { state: 'needs-plan' }
  | { state: 'waiting'; plan: PlanComment }
  | { state: 'approved'; plan: PlanComment; approval: PlanComment }
  | { state: 'revise'; plan: PlanComment; feedback: PlanComment[] }

const time = (iso: string) => Date.parse(iso)

/**
 * Where an issue's plan stands, decided in code from its comments (oldest or newest first, it
 * does not matter). Spec: "Approving a plan". Fail-closed rules:
 *   - The plan is the newest comment with a `### loop — plan` heading posted from the owner's
 *     account through the app (the loop posts as the owner, always through the Claude app;
 *     verified on #18 on 2026-10-16). A typed comment with the heading is not a plan, and as a
 *     loop-looking comment it is not a reply either: it counts for nothing.
 *   - Only replies created after the plan was last edited count, so a plan edited after its
 *     approval needs a new one. A revised plan is always a new comment.
 *   - A reply counts only from an approver (OWNER, COLLABORATOR, MEMBER), typed by a person: no
 *     app stamp and no loop heading. The loop posts as the owner but always through the app,
 *     so it cannot approve its own plan. Other comments are ignored.
 *   - The newest counting reply decides. It approves only if it begins with "Approved" and was
 *     never edited (an edit could have been made by the loop's account; an edited approval
 *     leaves the plan waiting); any other reply is feedback, and the plan is revised.
 *   - Known limit: deleting a later reply would make an older "Approved" the newest again.
 *     Comment lists do not show deletions; the prompt forbids the loop to delete comments.
 */
export function planState(comments: PlanComment[], owner = REPO.split('/')[0]): PlanState {
  const sorted = [...comments].sort((a, b) => time(a.createdAt) - time(b.createdAt))
  const plans = sorted.filter((c) => isOwner(c.authorLogin, owner) && Boolean(c.appSlug) && PLAN_HEADING.test(c.body))
  const plan = plans.at(-1)
  if (!plan) return { state: 'needs-plan' }
  const replies = sorted.filter(
    (c) => time(c.createdAt) > time(plan.updatedAt) && APPROVERS.has(c.authorAssociation) && !isLoopComment(c),
  )
  const last = replies.at(-1)
  if (!last) return { state: 'waiting', plan }
  if (APPROVED.test(last.body)) {
    // An edited "Approved" does not approve (the loop's account could have edited it), and it
    // is not feedback either: the plan waits for a fresh approval.
    return last.updatedAt === last.createdAt ? { state: 'approved', plan, approval: last } : { state: 'waiting', plan }
  }
  return { state: 'revise', plan, feedback: replies }
}

export function isOwner(login: string, owner: string): boolean {
  return login !== '' && login.toLowerCase() === owner.toLowerCase()
}

/** The text handed to the loop for one issue. */
export function formatIssue(number: number, title: string, body: string, comments: IssueComment[]): string {
  const parts = [`# #${number} ${title}`, '', body.trim() === '' ? '(no description)' : body.trim()]
  comments.forEach((comment, index) => {
    parts.push('', `## Developer comment ${index + 1}`, '', comment.body.trim())
  })
  return parts.join('\n')
}

/** One issue comment as GitHub's REST API returns it (the fields the loop reads). */
export interface RestIssueComment {
  body: string | null
  html_url: string
  user: { login: string } | null
  author_association: string
  performed_via_github_app: { slug: string } | null
  created_at: string
  updated_at: string
}

export function toPlanComment(c: RestIssueComment): PlanComment {
  return {
    authorLogin: c.user?.login ?? '',
    body: c.body ?? '',
    appSlug: c.performed_via_github_app?.slug ?? null,
    authorAssociation: c.author_association ?? '',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    url: c.html_url,
  }
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function main(): void {
  const number = Number(process.argv[2]?.replace(/^#/, ''))
  if (!Number.isInteger(number) || number <= 0) throw new Error('usage: loop:issue -- <issue number>')
  const owner = REPO.split('/')[0]
  const issue = JSON.parse(gh(['api', `repos/${REPO}/issues/${number}`])) as {
    title: string
    body: string | null
    user: { login: string } | null
    pull_request?: unknown
  }
  if (issue.pull_request) throw new Error(`#${number} is a pull request, not an issue`)
  // The body is handed to the loop as instructions, so it has to be the owner's, like the
  // comments. The picker only offers the owner's issues; this covers a wrong number.
  if (!isOwner(issue.user?.login ?? '', owner)) {
    throw new Error(`#${number} was not written by ${owner}; its text is not instructions for the loop`)
  }
  const comments = gh(['api', '--paginate', `repos/${REPO}/issues/${number}/comments?per_page=100`, '--jq', '.[]'])
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RestIssueComment)
    .map(toPlanComment)
  console.log(formatIssue(number, issue.title, issue.body ?? '', developerComments(comments, owner)))
}

// Run only as a script, so the pure functions above can be imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(`loop:issue failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
