import { describe, it, expect } from 'vitest'
import * as client from '../../src/lib/letter-urls'
import { buildMailtoUrl, buildGmailComposeUrl } from '../../server/services/letter-utils'

const to = [{ email: 'mk@knesset.gov.il', display_name: 'ח"כ' }]
const cc = [{ email: 'cc@gov.il', display_name: 'דובר' }]

describe('URL builder parity (client module === server re-export)', () => {
  it('mailto is identical', () => {
    expect(buildMailtoUrl(to, cc, [], 'נושא חשוב', 'שלום רב'))
      .toBe(client.buildMailtoUrl(to, cc, [], 'נושא חשוב', 'שלום רב'))
  })
  it('gmail is identical', () => {
    expect(buildGmailComposeUrl(to, cc, [], 'נושא', 'גוף'))
      .toBe(client.buildGmailComposeUrl(to, cc, [], 'נושא', 'גוף'))
  })
})
