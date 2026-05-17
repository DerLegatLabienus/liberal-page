/**
 * Live health checks for external APIs used in knesset-scraper.
 * These make real network requests — they catch endpoint changes, renames,
 * and schema drift that mocked unit tests cannot detect.
 *
 * Run with: npm test -- knesset-api-health
 */

const SITE_ID = 1116 // Dan Ilouz — a current MK unlikely to be removed
const KNESSET_NUM = 25

describe('Knesset Website API — GetParlamentayActivity', () => {
  let data: Record<string, unknown>

  beforeAll(async () => {
    const res = await fetch(
      `https://www.knesset.gov.il/WebSiteApi/knessetapi/MKs/GetParlamentayActivity` +
      `?mkId=${SITE_ID}&knessetId=${KNESSET_NUM}`,
      { headers: { Accept: 'application/json', Referer: 'https://main.knesset.gov.il/' } },
    )
    expect(res.ok, `API returned ${res.status} — endpoint may have moved`).toBe(true)
    data = await res.json() as Record<string, unknown>
  }, 20_000)

  it('response contains all expected top-level sections', () => {
    expect(data).toHaveProperty('PrivateBills')
    expect(data).toHaveProperty('PlenaryVotes')
    expect(data).toHaveProperty('Queries')
    expect(data).toHaveProperty('AgendaProposals')
  })

  it('PrivateBills items have Date, Name, BillLink', () => {
    const bills = data['PrivateBills'] as unknown[]
    expect(Array.isArray(bills)).toBe(true)
    expect(bills.length).toBeGreaterThan(0)
    const first = bills[0] as Record<string, unknown>
    expect(first).toHaveProperty('Date')
    expect(first).toHaveProperty('Name')
    expect(first).toHaveProperty('BillLink')
    expect(typeof first['Date']).toBe('string')
    expect((first['Date'] as string)).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('PlenaryVotes items have Date, VoteResult, VoteID', () => {
    const votes = data['PlenaryVotes'] as unknown[]
    expect(Array.isArray(votes)).toBe(true)
    expect(votes.length).toBeGreaterThan(0)
    const first = votes[0] as Record<string, unknown>
    expect(first).toHaveProperty('Date')
    expect(first).toHaveProperty('VoteResult')
    expect(first).toHaveProperty('VoteID')
    // Hebrew date format: "DD/MM/YYYY, בשעה HH:MM"
    expect((first['Date'] as string)).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('Queries items have ID, Date, Subject', () => {
    const queries = data['Queries'] as unknown[]
    expect(Array.isArray(queries)).toBe(true)
    if (queries.length > 0) {
      const first = queries[0] as Record<string, unknown>
      expect(first).toHaveProperty('ID')
      expect(first).toHaveProperty('Date')
      expect(first).toHaveProperty('Subject')
    }
  })

  it('BillLink is a relative path starting with /Activity', () => {
    const bills = data['PrivateBills'] as Array<Record<string, string>>
    const first = bills[0]
    expect(first['BillLink']).toMatch(/^\/Activity\//)
  })
})
