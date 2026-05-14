import type { ParsedUrl } from '../../src/types'

const PATTERNS: Array<{ pattern: RegExp; type: ParsedUrl['type']; idGroup: number }> = [
  { pattern: /oknesset\.org\/bill\/(\d+)/i, type: 'bill', idGroup: 1 },
  { pattern: /oknesset\.org\/member\/(\d+)/i, type: 'mk', idGroup: 1 },
  { pattern: /oknesset\.org\/committee\/(\d+)/i, type: 'committee', idGroup: 1 },
  { pattern: /[?&]CommitteeId=(\d+)/i, type: 'committee', idGroup: 1 },
  { pattern: /knesset\.gov\.il.*BillId=(\d+)/i, type: 'bill', idGroup: 1 },
]

export function parseKnessetUrl(url: string): ParsedUrl | null {
  if (!url) return null
  for (const { pattern, type, idGroup } of PATTERNS) {
    const match = url.match(pattern)
    if (match) return { type, id: match[idGroup] }
  }
  return null
}
