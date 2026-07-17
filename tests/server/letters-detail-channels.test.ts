import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letterContacts } from '../../server/db/schema'
import { buildChannelSends } from '../../server/services/channel-send'

describe('buildChannelSends', () => {
  let email = 0, sms = 0, smsOnly = 0
  beforeEach(async () => {
    await db.delete(letterContacts)
    const [a] = await db.insert(letterContacts).values({ displayName: 'Has both', email: 'a@x.com', phone: '+972520000001', hasWhatsapp: true }).returning()
    const [b] = await db.insert(letterContacts).values({ displayName: 'No phone', email: 'b@x.com' }).returning()
    const [c] = await db.insert(letterContacts).values({ displayName: 'SMS only', phone: '+972520000002', hasWhatsapp: false }).returning()
    email = a.id; sms = b.id; smsOnly = c.id
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

  it('whatsapp → per-recipient links, skipping SMS-only contacts', async () => {
    const sends = await buildChannelSends([
      { id: 3, letterId: 1, kind: 'whatsapp', enabled: true, recipientIds: [email, smsOnly], ccIds: [], bccIds: [], bodyText: 'הודעה', subject: null, bodyHtml: null, templateId: null },
    ])
    const w = sends.find((s) => s.kind === 'whatsapp')!
    expect(w.recipients!.map((r) => r.displayName)).toEqual(['Has both']) // SMS-only contact skipped
    expect(w.recipients![0].url).toContain('https://wa.me/')
    expect(w.recipients![0].url).toContain('972520000001') // no '+' prefix
    expect(w.unavailableCount).toBe(1)
  })
})
