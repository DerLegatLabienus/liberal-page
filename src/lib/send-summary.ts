/** Text shown under a Letter with how many Sends it has. */
export function sendSummary(sends: number, contacts: string[]): string {
  const count = sends > 1000 ? '1000+ sends' : `${sends} sends`
  const first = contacts[0]?.trim()
  if (!first) return count
  // TODO: should a send made by a visitor from a share page count here, or only members' sends?
  // The letters spec does not say. For now everything is counted.
  return sends > 1000 ? `${first} and others: ${count}` : `${first}: ${count}`
}
