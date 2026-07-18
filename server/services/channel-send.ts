import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'
import type { ChannelSend, LetterChannel, RecipientSendLink } from '../../src/types'
import { reachableOn } from './channel-availability'
import { buildMailtoUrl, buildGmailComposeUrl, buildWhatsappUrl, buildSmsUrl, renderLetterHtml } from './letter-utils'

/** Resolve a letter's channels + recipient ids into ready-to-use send links. */
export async function buildChannelSends(channels: LetterChannel[]): Promise<ChannelSend[]> {
  const ids = [...new Set(channels.flatMap((c) => [...c.recipientIds, ...c.ccIds, ...c.bccIds]))]
  const contacts = ids.length ? await db.select().from(letterContacts).where(inArray(letterContacts.id, ids)) : []
  const byId = new Map(contacts.map((c) => [c.id, c]))

  return Promise.all(channels.map(async (ch): Promise<ChannelSend> => {
    if (ch.kind === 'email') {
      const resolve = (list: number[]) =>
        list.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && reachableOn('email', c))
          .map((c) => ({ email: c.email!, display_name: c.displayName, contact_id: c.id }))
      const to = resolve(ch.recipientIds), cc = resolve(ch.ccIds), bcc = resolve(ch.bccIds)
      const unavailable = ch.recipientIds.length - to.length
      return {
        kind: 'email', enabled: ch.enabled, bodyText: ch.bodyText, unavailableCount: unavailable,
        mailtoUrl: buildMailtoUrl(to, cc, bcc, ch.subject ?? '', ch.bodyText),
        gmailUrl: buildGmailComposeUrl(to, cc, bcc, ch.subject ?? '', ch.bodyText),
        renderedHtml: await renderLetterHtml(ch.bodyHtml ?? '', ch.templateId),
      }
    }
    // sms / whatsapp: one link per reachable recipient
    const recipients: RecipientSendLink[] = []
    let unavailable = 0
    for (const id of ch.recipientIds) {
      const c = byId.get(id)
      if (!c || !reachableOn(ch.kind, c)) { unavailable++; continue }
      recipients.push({
        contactId: c.id, displayName: c.displayName, photoUrl: c.photoUrl,
        url: ch.kind === 'whatsapp' ? buildWhatsappUrl(c.phone!, ch.bodyText) : buildSmsUrl(c.phone!, ch.bodyText),
      })
    }
    return { kind: ch.kind, enabled: ch.enabled, bodyText: ch.bodyText, unavailableCount: unavailable, recipients }
  }))
}
