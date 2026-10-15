// Shared by the loop's proof commands (`loop:gate`, `loop:proof`, `loop:guard`): the fixed
// evidence-block format and the git facts every block carries.
//
// Each command prints one block that starts with a marker comment, so a later check (the PR
// body, the review pass) can find the block without parsing prose. The marker names the
// command; the verdict line says whether it passed.
import { execFileSync } from 'node:child_process'

export type EvidenceCommand = 'gate' | 'proof' | 'guard'
export type Verdict = 'pass' | 'fail'

/** The first line of every block, e.g. `<!-- loop:gate -->`. */
export function evidenceMarker(command: EvidenceCommand): string {
  return `<!-- loop:${command} -->`
}

export interface EvidenceBlock {
  command: EvidenceCommand
  verdict: Verdict
  /** The commit the command ran at (short or full SHA). */
  commit: string
  /** Whether the working tree had uncommitted changes when the command ran. */
  dirty: boolean
  /** One line per check or finding, already formatted by the command. */
  lines: string[]
}

/**
 * The block as Markdown: marker, a heading line with the verdict, the commit and tree state,
 * then the command's own lines. Lines are printed as given, so each command owns its detail.
 */
export function formatEvidenceBlock(block: EvidenceBlock): string {
  return [
    evidenceMarker(block.command),
    `**loop:${block.command}: ${block.verdict.toUpperCase()}**`,
    `- commit: \`${block.commit}\`${block.dirty ? ' (uncommitted changes present)' : ''}`,
    ...block.lines,
  ].join('\n')
}

/** Finds a command's block in a larger text (a PR body). The block runs to the next blank line. */
export function findEvidenceBlock(text: string, command: EvidenceCommand): string | null {
  const start = text.indexOf(evidenceMarker(command))
  if (start === -1) return null
  const end = text.indexOf('\n\n', start)
  return text.slice(start, end === -1 ? undefined : end)
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** HEAD's short SHA and whether the tree has uncommitted changes (untracked files count). */
export function treeState(cwd?: string): { commit: string; dirty: boolean } {
  return {
    commit: git(['rev-parse', '--short', 'HEAD'], cwd),
    dirty: git(['status', '--porcelain'], cwd) !== '',
  }
}

/**
 * The commit the branch is compared against: its merge base with `origin/master`, or with
 * `master` when there is no remote ref. `base` overrides it (a ref or SHA).
 */
export function resolveBase(base?: string, cwd?: string): string {
  if (base) return git(['rev-parse', base], cwd)
  for (const ref of ['origin/master', 'master']) {
    try {
      return git(['merge-base', 'HEAD', ref], cwd)
    } catch {
      // try the next ref
    }
  }
  throw new Error('no base: neither origin/master nor master is reachable from HEAD')
}

/** Paths the branch changed since `base` (added, modified, renamed, deleted), committed only. */
export function changedPaths(base: string, cwd?: string): string[] {
  const out = git(['diff', '--name-only', `${base}...HEAD`], cwd)
  return out === '' ? [] : out.split('\n')
}
