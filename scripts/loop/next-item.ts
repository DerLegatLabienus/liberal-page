// CLI for the weekly loop: prints the next eligible backlog item as JSON, or "none".
// Usage: npm run loop:next
// Exit codes: 0 = printed an item or "none"; 2 = too many loop PRs already open; 1 = gh failed.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractItemId, isLoopBranch, selectNextItem } from './select-item'

const LOOP_LABEL = 'loop'
// Parallel loop PRs are allowed, but not without bound: past this many open ones the loop
// waits, so an unattended month cannot leave a pile of PRs that conflict with each other.
const MAX_OPEN = Number(process.env.LOOP_MAX_OPEN ?? 3)

interface LoopPr {
  number: number
  title: string
  headRefName: string
  mergedAt: string | null
  labels: { name: string }[]
}

// The only place that talks to GitHub; everything else in the loop is pure and tested.
function listLoopPrs(state: 'open' | 'closed'): LoopPr[] {
  const out = execFileSync(
    'gh',
    ['pr', 'list', '--state', state, '--limit', '200',
      '--json', 'number,title,headRefName,mergedAt,labels'],
    { encoding: 'utf8' },
  )
  // A loop PR is recognised by its branch shape or its label, so a PR that lost (or never
  // got) the label is still counted.
  return (JSON.parse(out) as LoopPr[]).filter(
    (pr) => isLoopBranch(pr.headRefName) || pr.labels.some((l) => l.name === LOOP_LABEL),
  )
}

function itemIdOf(pr: LoopPr): string | null {
  return extractItemId(pr.headRefName) ?? extractItemId(pr.title)
}

function main(): void {
  const open = listLoopPrs('open')
  if (open.length >= MAX_OPEN) {
    const list = open.map((pr) => `#${pr.number} ${pr.title}`).join('; ')
    console.error(`${open.length} loop PRs are open (limit ${MAX_OPEN}) — nothing to do until one is merged or closed: ${list}`)
    process.exit(2)
  }

  // Skip items already in flight (open PR) and items already rejected (closed, never merged).
  const excluded = new Set<string>()
  for (const pr of open) {
    const id = itemIdOf(pr)
    if (id) excluded.add(id)
  }
  for (const pr of listLoopPrs('closed')) {
    if (pr.mergedAt) continue
    const id = itemIdOf(pr)
    if (id) excluded.add(id)
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const item = selectNextItem(readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), excluded)
  // `openPrs` lets the agent check its change against work already in flight.
  console.log(item ? JSON.stringify({ ...item, openPrs: open.map((pr) => pr.number) }) : 'none')
}

try {
  main()
} catch (err) {
  console.error(`loop:next failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
