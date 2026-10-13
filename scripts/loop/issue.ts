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
}

// Every comment the loop posts carries a heading of this shape: `### loop — blocked`, with a
// dash after the word. The dash is required so that a developer's own heading such as
// `### loop-safe again` is not mistaken for one. Any line may match, not only the first, so a
// loop comment that was posted with something above its heading is still recognised.
const LOOP_HEADING = /^\s*###\s+loop\s+[—–-]/im

/**
 * The comments the loop may treat as the developer's words: written by the repository owner and
 * not one of the loop's own. The loop posts as the owner's account, so its comments have to be
 * recognised by their heading; without this it would read its own past output as instructions.
 * Anyone else's comment is dropped because the repository is public.
 */
export function developerComments(comments: IssueComment[], owner: string): IssueComment[] {
  return comments.filter((comment) => isOwner(comment.authorLogin, owner) && !LOOP_HEADING.test(comment.body))
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
    .map((line) => JSON.parse(line) as { body: string | null; user: { login: string } | null })
    .map((c) => ({ authorLogin: c.user?.login ?? '', body: c.body ?? '' }))
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
