import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letters, letterChannels, letterContacts } from '../../server/db/schema'
import { backfillChannels } from '../../scripts/backfill-channels'

describe('backfillChannels', () => {
  beforeEach(async () => {
    await db.delete(letterChannels)
    await db.delete(letters)
    await db.delete(letterContacts)
  })

  it('creates one email channel per legacy letter, find-or-creating contacts, idempotently', async () => {
    await db.insert(letters).values({
      title: 'Legacy', status: 'published', priority: 'normal',
      subject: 'S', bodyHtml: '<p>hi</p>', bodyPlain: 'hi',
      toAddresses: [{ email: 'mk@knesset.gov.il', display_name: 'MK' }],
      ccAddresses: [], bccAddresses: [],
    })

    const first = await backfillChannels()
    expect(first.migrated).toBe(1)

    const chans = await db.select().from(letterChannels)
    expect(chans).toHaveLength(1)
    expect(chans[0].kind).toBe('email')
    const contacts = await db.select().from(letterContacts)
    expect(contacts).toHaveLength(1)
    expect(chans[0].recipientIds).toEqual([contacts[0].id])

    // Re-run: no new channels, no new contacts.
    const second = await backfillChannels()
    expect(second.migrated).toBe(0)
    expect(await db.select().from(letterChannels)).toHaveLength(1)
    expect(await db.select().from(letterContacts)).toHaveLength(1)
  })
})
