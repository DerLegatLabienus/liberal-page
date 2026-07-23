import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letterContacts } from '../../../server/db/schema'
import { LetterContactsRepository } from '../../../server/repositories/letter-contacts-repository'

const contactsRepo = new LetterContactsRepository()

describe('LetterContactsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterContacts) })

  it('creates and lists contacts', async () => {
    await contactsRepo.create({ displayName: 'חיים כץ', email: 'haim@knesset.gov.il', category: 'mk' })
    const contacts = await contactsRepo.list()
    expect(contacts).toHaveLength(1)
    expect(contacts[0].displayName).toBe('חיים כץ')
  })

  it('searches contacts by query string', async () => {
    await contactsRepo.create({ displayName: 'חיים כץ', email: 'haim@knesset.gov.il', category: 'mk' })
    await contactsRepo.create({ displayName: 'אורי מקלב', email: 'uri@knesset.gov.il', category: 'mk' })
    const results = await contactsRepo.search('חיים')
    expect(results).toHaveLength(1)
    expect(results[0].displayName).toBe('חיים כץ')
  })

  it('deletes a contact', async () => {
    const c = await contactsRepo.create({ displayName: 'temp', email: 'temp@example.com', category: 'custom' })
    await contactsRepo.delete(c.id)
    expect(await contactsRepo.list()).toHaveLength(0)
  })

  it('bulkUpsert is idempotent: seeding twice yields no duplicates, preserves categories', async () => {
    const seed = [
      { displayName: 'אבי דיכטר', email: 'davraham@knesset.gov.il', category: 'mk' },
      { displayName: 'משרד הביטחון', email: 'dover@mod.gov.il', category: 'ministry' },
      { displayName: 'משרד הבריאות', email: 'dover@moh.gov.il', category: 'ministry' },
    ]
    await contactsRepo.bulkUpsert(seed)
    await contactsRepo.bulkUpsert(seed) // re-run must not duplicate

    const all = await contactsRepo.list()
    expect(all).toHaveLength(3)
    expect(all.filter((c) => c.category === 'mk')).toHaveLength(1)
    expect(all.filter((c) => c.category === 'ministry')).toHaveLength(2)
    // unique email is the conflict key
    expect(new Set(all.map((c) => c.email)).size).toBe(3)
  })

  it('bulkUpsert does not clobber an existing manually-created contact on conflict', async () => {
    await contactsRepo.create({ displayName: 'Custom Name', email: 'dover@mod.gov.il', category: 'custom' })
    await contactsRepo.bulkUpsert([{ displayName: 'משרד הביטחון', email: 'dover@mod.gov.il', category: 'ministry' }])

    const all = await contactsRepo.list()
    expect(all).toHaveLength(1)
    expect(all[0].displayName).toBe('Custom Name')
    expect(all[0].category).toBe('custom')
  })

  it('bulkUpsert is a no-op on empty input', async () => {
    await contactsRepo.bulkUpsert([])
    expect(await contactsRepo.list()).toHaveLength(0)
  })
})
