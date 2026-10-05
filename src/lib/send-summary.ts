/** Text shown under a campaign with how many supporters delivered it. */
export function sendSummary(sends: number, contacts: string[]): string {
  const first = contacts[0].trim()
  // TODO: should a send made by a visitor from a share page count here, or only members' sends?
  // The letters spec does not say. For now everything is counted.
  if (sends > 1000) return `${first} and others: 1000+ deliveries`
  return `${first}: ${sends} deliveries`
}
