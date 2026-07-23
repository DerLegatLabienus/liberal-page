import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letterContacts, letterChannels, letters } from '../../server/db/schema'
import { LetterContactsRepository } from '../../server/repositories/letter-contacts-repository'

const repo = new LetterContactsRepository()

describe('LetterContactsRepository (widened)', () => {
  beforeEach(async () => {
    await db.delete(letterChannels)
    await db.delete(letters)
    await db.delete(letterContacts)
  })

  it('creates a phone-only contact (no email)', async () => {
    const c = await repo.create({ displayName: 'MK Phone', phone: '+972521234567' })
    expect(c.email).toBeNull()
    expect(c.phone).toBe('+972521234567')
    expect(c.hasWhatsapp).toBe(false)
  })

  it('persists photoUrl + mkSiteId + hasWhatsapp on update', async () => {
    const c = await repo.create({ displayName: 'X', email: 'x@e.com' })
    await repo.update(c.id, { displayName: 'X', email: 'x@e.com', photoUrl: 'https://p/x.jpg', mkSiteId: 1116, hasWhatsapp: true })
    const [row] = await repo.search('X')
    expect(row).toMatchObject({ photoUrl: 'https://p/x.jpg', mkSiteId: 1116, hasWhatsapp: true })
  })

  it('isReferenced reflects channel membership', async () => {
    const c = await repo.create({ displayName: 'Ref', email: 'r@e.com' })
    expect(await repo.isReferenced(c.id)).toBe(false)
    const [l] = await db.insert(letters).values({ title: 'T', status: 'draft', priority: 'normal' }).returning()
    await db.insert(letterChannels).values({ letterId: l.id, kind: 'email', recipientIds: [c.id], subject: 'S', bodyHtml: '<p>x</p>' })
    expect(await repo.isReferenced(c.id)).toBe(true)
  })
})
