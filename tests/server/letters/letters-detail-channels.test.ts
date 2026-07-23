import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letterContacts, letterTemplates } from '../../server/db/schema'
import { buildChannelSends } from '../../server/services/channel-send'
import { renderLetterHtml } from '../../server/services/letter-utils'

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

  it('email deep-link body is non-empty (empty mailto body regression)', async () => {
    const sends = await buildChannelSends([
      { id: 4, letterId: 1, kind: 'email', enabled: true, recipientIds: [email], ccIds: [], bccIds: [], bodyText: 'שלום עולם, זהו גוף המכתב', subject: 'S', bodyHtml: '<p>שלום עולם, זהו גוף המכתב</p>', templateId: null },
    ])
    const em = sends.find((s) => s.kind === 'email')!
    expect(em.bodyText).toBeTruthy()
    expect(em.mailtoUrl).toContain(encodeURIComponent('שלום עולם'))
    expect(em.gmailUrl).toContain(encodeURIComponent('שלום עולם').replace(/%20/g, '+'))
    // No template set: renderedHtml exercises the same call path as the templated case,
    // and equals the untemplated passthrough.
    expect(em.renderedHtml).toBe(await renderLetterHtml('<p>שלום עולם, זהו גוף המכתב</p>', null))
  })

  it('email renderedHtml applies the letter template ({{CONTENT}} placeholder) — template-never-applied regression', async () => {
    const [template] = await db.insert(letterTemplates).values({
      name: `test-template-${Date.now()}`,
      html: '<html><body><header>כותרת</header>{{CONTENT}}<footer>תחתית</footer></body></html>',
    }).returning()

    const sends = await buildChannelSends([
      { id: 5, letterId: 1, kind: 'email', enabled: true, recipientIds: [email], ccIds: [], bccIds: [], bodyText: 'גוף', subject: 'S', bodyHtml: '<p>גוף</p>', templateId: template.id },
    ])
    const em = sends.find((s) => s.kind === 'email')!
    expect(em.renderedHtml).toContain('<header>כותרת</header>')
    expect(em.renderedHtml).toContain('<p>גוף</p>')
    expect(em.renderedHtml).toContain('<footer>תחתית</footer>')
    expect(em.renderedHtml).not.toContain('{{CONTENT}}')
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
