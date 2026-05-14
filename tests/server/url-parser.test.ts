import { parseKnessetUrl } from '../../server/services/url-parser'

describe('parseKnessetUrl', () => {
  it('parses oknesset bill URL', () => {
    expect(parseKnessetUrl('https://oknesset.org/bill/12345/')).toEqual({
      type: 'bill',
      id: '12345',
    })
  })

  it('parses oknesset MK URL', () => {
    expect(parseKnessetUrl('https://oknesset.org/member/42/')).toEqual({
      type: 'mk',
      id: '42',
    })
  })

  it('parses oknesset committee URL', () => {
    expect(parseKnessetUrl('https://oknesset.org/committee/7/')).toEqual({
      type: 'committee',
      id: '7',
    })
  })

  it('parses knesset.gov.il committee URL with CommitteeId param', () => {
    const url = 'https://main.knesset.gov.il/Activity/committees/Pages/allcommittees.aspx?CommitteeId=10'
    expect(parseKnessetUrl(url)).toEqual({ type: 'committee', id: '10' })
  })

  it('returns null for unsupported URL', () => {
    expect(parseKnessetUrl('https://example.com/foo')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseKnessetUrl('')).toBeNull()
  })
})
