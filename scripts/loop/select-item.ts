// Pure selection of the weekly loop's next backlog item (spec: Seam 1 in
// docs/superpowers/specs/2026-10-04-solo-dev-workflow-design.md). No I/O here —
// next-item.ts supplies the backlog text and the IDs to skip.

export interface LoopItem {
  id: string
  title: string
}

// Em dash is the convention; an en dash or plain hyphen is accepted so a hand-typed heading
// is never silently skipped.
const ITEM_HEADING = /^## (LibPage-\d+)\s+[—–-]\s+(.*)$/
const ANY_H2 = /^## /
const LOOP_SAFE = /\[loop-safe\]/i
const RISKY_TAG = /\[risky\]/i
const ITEM_ID = /libpage-(\d+)/i

/**
 * Risky detection is deliberately literal, never inferred from prose: an item is risky
 * only if its heading or body carries an explicit `[risky]` tag, or the words "risky tier"
 * appear anywhere in its body. An item that merely mentions migrations or auth is not
 * refused — tag it `[risky]` if it should be.
 */
function isRisky(heading: string, body: string[]): boolean {
  if (RISKY_TAG.test(heading)) return true
  const text = body.join(' ')
  return RISKY_TAG.test(text) || /\brisky\s+tier\b/i.test(text)
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\[(loop-safe|risky)\]/gi, '')
    .replace(/\(Priority:[^)]*\)/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The first item, in file order (which is priority order), whose `## LibPage-NNN — Title`
 * heading carries `[loop-safe]`, whose ID is not excluded, and which is not risky.
 * `excludedIds` holds both rejected items (a loop PR closed unmerged) and in-flight ones (a
 * loop PR still open), so an open PR never blocks the loop: it moves on to the next item.
 * Headings without a LibPage ID (`## Now`) and anything below level 2 are not items.
 */
export function selectNextItem(backlogText: string, excludedIds: Set<string>): LoopItem | null {
  const lines = backlogText.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const match = ITEM_HEADING.exec(lines[i])
    if (!match) continue
    const [heading, id, rawTitle] = match
    if (!LOOP_SAFE.test(heading) || excludedIds.has(id)) continue
    let end = i + 1
    while (end < lines.length && !ANY_H2.test(lines[end])) end++
    if (isRisky(heading, lines.slice(i + 1, end))) continue
    return { id, title: cleanTitle(rawTitle) }
  }
  return null
}

// Loop branches are ordinary short-lived trunk-based branches: a conventional-commit type,
// then the item ID, e.g. `fix/LibPage-009-auth-button-token`. Developer sessions never open
// PRs (trunk lane), so a PR from a branch of this shape is the loop's.
const LOOP_BRANCH = /^(feat|fix|docs|refactor|perf|test|chore|style)\/LibPage-\d+(-|$)/i

export function isLoopBranch(branch: string): boolean {
  return LOOP_BRANCH.test(branch)
}

/** The LibPage ID carried by a loop branch name or PR title, or null. */
export function extractItemId(text: string): string | null {
  const match = ITEM_ID.exec(text)
  return match ? `LibPage-${match[1]}` : null
}
