import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letterContacts } from '../../server/db/schema'
import { buildChannelSends } from '../../server/services/channel-send'

describe('buildChannelSends', () => {
  let email = 0, sms = 0
  beforeEach(async () => {
    await db.delete(letterContacts)
    const [a] = await db.insert(letterContacts).values({ displayName: 'Has both', email: 'a@x.com', phone: '+972520000001', hasWhatsapp: true }).returning()
    const [b] = await db.insert(letterContacts).values({ displayName: 'No phone', email: 'b@x.com' }).returning()
    email = a.id; sms = b.id
  })

  it('email → single mailto/gmail; sms → per-recipient links, skipping unreachable', async () => {
    const sends = await buildChannelSends([
      { id: 1, letterId: 1, kind: 'email', enabled: true, recipientIds: [email, sms], ccIds: [], bccIds: [], bodyText: 'hi', subject: 'S', bodyHtml: '<p>h</p>', templateId: null },
      { id: 2, letterId: 1, kind: 'sms', enabled: true, recipientIds: [email, sms], ccIds: [], bccIds: [], bodyText: 'קצר', subject: null, bodyHtml: null, templateId: null },
    ])
    const em = sends.find((s) => s.kind === 'email')!
    expect(em.mailtoUrl).toContain('mailto:')
    expect(em.gmailUrl).toContain('mail.google.com')

    const s = sends.find((s) => s.kind === 'sms')!
    expect(s.recipients!.map((r) => r.displayName)).toEqual(['Has both']) // 'No phone' skipped
    expect(s.recipients![0].url).toContain('sms:+972520000001')
    expect(s.unavailableCount).toBe(1)
  })
})
