// Pure decision logic for the loop's review-fix pass: does one of the loop's own open PRs
// carry reviewer findings an agent may fix? No I/O here — next-item.ts supplies the PR data.
// Design: docs/superpowers/specs/2026-10-04-solo-dev-workflow-design.md
// ("Who acts on a reviewer finding" and "Loop").
import { extractItemId } from './select-item'

export interface LoopPrData {
  number: number
  title: string
  headRefName: string
  /** Full SHA of the PR's current head commit. */
  headRefOid: string
  isDraft: boolean
  commits: { messageHeadline: string; messageBody: string }[]
  comments: { authorLogin: string; authorType: string; body: string; url: string }[]
}

export interface FixTarget {
  pr: number
  branch: string
  id: string
  /** Reviewers with at least one finding an agent may fix. */
  reviewers: string[]
  /** Findings marked `Needs: agent`: the loop may fix these. */
  agentFindings: number
  /** Findings marked `Needs: developer` (or not clearly marked): never touched by the loop. */
  developerFindings: number
  /** The exact reviewer comments to act on. The loop reads these and no others. */
  comments: string[]
}

export interface ReviewerVerdict {
  reviewer: string
  /** Short or full SHA the reviewer says it reviewed, lower-cased; null if not stated. */
  commit: string | null
  findings: number
  agent: number
  developer: number
}

// The four PR-lane reviewers, in the order their names are reported.
export const REVIEWERS = ['code-reviewer', 'security-reviewer', 'architecture-reviewer', 'domain-reviewer']

// Only verdicts posted by the review action's own GitHub App count. The repo is public and
// anyone can comment, so a comment merely shaped like a verdict must not steer the loop. The
// REST API reports the app as login `claude[bot]`, type `Bot`; a human account named
// `claude` is type `User` and does not match.
export const TRUSTED_REVIEW_AUTHOR = { login: 'claude[bot]', type: 'Bot' }

// A review-fix pass is recorded by this trailer in the commit body. (The subject also says
// "(review pass)" for humans, but GitHub truncates long subjects, so it is not relied on.)
export const REVIEW_PASS_TRAILER = 'Loop-Review-Pass: true'
export const MAX_REVIEW_PASSES = 1

const HEADING = /^### ([a-z]+-reviewer)\s*$/
const VERDICT = /^\*\*Verdict:\*\*\s*(?:(No findings)|(\d+) finding(?:\(s\)|s)?(?:\s*[—–-]\s*(\d+) for an agent)?)/im
const COMMIT = /^\*\*Commit:\*\*\s*`?([0-9a-f]{7,40})`?\s*$/im
const BLOCK = /^#### \d+\./
const NEEDS = /^- \*\*Needs:\*\*\s*(.*)$/
// `agent`, optionally followed by a full stop, and nothing else. "agent — but the developer
// must decide" is not an agent finding.
const NEEDS_AGENT = /^agent\.?\s*$/i

/** Lines of a comment with fenced code blocks removed, so quoted text is never parsed. */
function linesOutsideFences(body: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (!fenced) out.push(line)
  }
  return out
}

/** How many `#### N.` finding blocks carry exactly one `Needs` line and it says `agent`. */
function countAgentBlocks(lines: string[]): number {
  let agent = 0
  let needs: string[] | null = null
  const close = () => {
    if (needs && needs.length === 1 && NEEDS_AGENT.test(needs[0])) agent++
  }
  for (const line of lines) {
    if (BLOCK.test(line)) {
      close()
      needs = []
      continue
    }
    const m = NEEDS.exec(line)
    if (m && needs) needs.push(m[1].trim())
  }
  close()
  return agent
}

/**
 * A signed reviewer comment, parsed; null if the comment is not one. The
 * `### <name>-reviewer` heading must be the comment's first line.
 *
 * A finding counts as the agent's only when three things agree: the verdict line declares
 * it ("N finding(s) — A for an agent"), a finding block carries a single top-level
 * `- **Needs:** agent` line, and the total does not exceed N. Anything else — an older
 * comment format, a quoted `Needs` line, a mismatch between verdict and blocks — is the
 * developer's. The unsafe mistake is developer→agent, so every doubt resolves the other way.
 */
export function parseReviewerComment(body: string): ReviewerVerdict | null {
  const lines = body.split(/\r?\n/)
  const heading = HEADING.exec(lines[0] ?? '')
  if (!heading || !REVIEWERS.includes(heading[1])) return null
  const plain = linesOutsideFences(body)
  const text = plain.slice(1).join('\n')
  const verdict = VERDICT.exec(text)
  if (!verdict) return null
  const findings = verdict[1] ? 0 : Number(verdict[2])
  const declaredAgent = verdict[3] ? Number(verdict[3]) : 0
  const agent = Math.min(findings, declaredAgent, countAgentBlocks(plain))
  const commit = COMMIT.exec(text)
  return {
    reviewer: heading[1],
    commit: commit ? commit[1].toLowerCase() : null,
    findings,
    agent,
    developer: findings - agent,
  }
}

function isTrusted(c: LoopPrData['comments'][number]): boolean {
  return c.authorLogin === TRUSTED_REVIEW_AUTHOR.login && c.authorType === TRUSTED_REVIEW_AUTHOR.type
}

/**
 * For each reviewer, its latest trusted comment, kept only if it reports findings AND says
 * it reviewed the PR's current head commit. A verdict for an older commit describes code
 * that has since changed, and one that names no commit cannot be placed, so neither is
 * acted on. `comments` must be in the order GitHub returns them (oldest first).
 */
export function freshVerdicts(pr: LoopPrData): (ReviewerVerdict & { url: string })[] {
  const latest = new Map<string, ReviewerVerdict & { url: string }>()
  for (const c of pr.comments) {
    if (!isTrusted(c)) continue
    const parsed = parseReviewerComment(c.body)
    if (parsed) latest.set(parsed.reviewer, { ...parsed, url: c.url })
  }
  const head = pr.headRefOid.toLowerCase()
  const fresh: (ReviewerVerdict & { url: string })[] = []
  for (const name of REVIEWERS) {
    const v = latest.get(name)
    if (v && v.findings > 0 && v.commit !== null && head.startsWith(v.commit)) fresh.push(v)
  }
  return fresh
}

/** Reviewers with fresh findings an agent may fix. */
export function reviewersWithFindings(pr: LoopPrData): string[] {
  return freshVerdicts(pr).filter((v) => v.agent > 0).map((v) => v.reviewer)
}

function reviewPassCount(pr: LoopPrData): number {
  return pr.commits.filter((c) => c.messageBody.includes(REVIEW_PASS_TRAILER)).length
}

function isBlockedBranch(branch: string): boolean {
  return /-blocked$/i.test(branch)
}

/**
 * The oldest open loop PR that still has agent-fixable reviewer findings, or null. Drafts,
 * blocked-item PRs and PRs that already had their review pass are never targets, and a PR
 * whose only findings need the developer is left for the developer.
 */
export function selectFixTarget(openLoopPrs: LoopPrData[]): FixTarget | null {
  const oldestFirst = [...openLoopPrs].sort((a, b) => a.number - b.number)
  for (const pr of oldestFirst) {
    if (pr.isDraft || isBlockedBranch(pr.headRefName)) continue
    if (reviewPassCount(pr) >= MAX_REVIEW_PASSES) continue
    const id = extractItemId(pr.headRefName) ?? extractItemId(pr.title)
    if (!id) continue
    const verdicts = freshVerdicts(pr)
    const actionable = verdicts.filter((v) => v.agent > 0)
    if (actionable.length === 0) continue
    return {
      pr: pr.number,
      branch: pr.headRefName,
      id,
      reviewers: actionable.map((v) => v.reviewer),
      agentFindings: verdicts.reduce((n, v) => n + v.agent, 0),
      developerFindings: verdicts.reduce((n, v) => n + v.developer, 0),
      comments: actionable.map((v) => v.url),
    }
  }
  return null
}
