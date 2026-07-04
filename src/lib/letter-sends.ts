/** Split a letter's send breakdown into member (in-app) vs public (shared-page) totals. */
export function splitSends(breakdown: Record<string, number>): { member: number; public: number; total: number } {
  const n = (k: string) => breakdown[k] ?? 0
  const member = n('mailto') + n('copy')
  const pub = n('public_mailto') + n('public_gmail') + n('public_copy')
  return { member, public: pub, total: member + pub }
}
