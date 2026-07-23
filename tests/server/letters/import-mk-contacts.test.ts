import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letterContacts, knessetMembersCache, letters, letterChannels } from '../../server/db/schema'

// The importer resolves each MK's email over the network — mock it.
vi.mock('../../server/services/knesset-scraper', () => ({ fetchMkEmail: vi.fn() }))
import { fetchMkEmail } from '../../server/services/knesset-scraper'
import { run } from '../../scripts/import-mk-contacts'

const emailFor = vi.mocked(fetchMkEmail)

async function seedMk(siteId: number, name: string, photoUrl: string | null) {
  await db.insert(knessetMembersCache).values({
    siteId, name, party: 'X', photoUrl, isLiberal: false, isSupporter: false, cachedAt: new Date(),
  })
}

async function contactsBySite(siteId: number) {
  return (await db.select().from(letterContacts)).filter((c) => c.mkSiteId === siteId)
}

/** Make `contactId` referenced by a letter so the importer must not delete it. */
async function referenceContact(contactId: number) {
  const [l] = await db.insert(letters).values({ title: 'T', status: 'draft', priority: 'normal' }).returning()
  await db.insert(letterChannels).values({ letterId: l.id, kind: 'email', recipientIds: [contactId], subject: 'S', bodyHtml: '<p>x</p>' })
}

describe('import-mk-contacts', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterChannels); await db.delete(letters)
    await db.delete(letterContacts); await db.delete(knessetMembersCache)
    emailFor.mockReset()
    emailFor.mockResolvedValue(null)
  })

  it('inserts a new MK as an email contact with photo, Site ID and category mk', async () => {
    await seedMk(500, 'טסט', 'https://p/500.jpg')
    emailFor.mockResolvedValue('a@knesset.gov.il')

    await run(false)

    const rows = await contactsBySite(500)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      displayName: 'טסט', email: 'a@knesset.gov.il', phone: null,
      photoUrl: 'https://p/500.jpg', mkSiteId: 500, category: 'mk',
    })
  })

  it('inserts a Norwegian-Law minister as photo-only (null email)', async () => {
    await seedMk(831, 'מירי רגב', 'https://p/831.jpg')
    emailFor.mockResolvedValue(null) // minister → no email

    await run(false)

    const rows = await contactsBySite(831)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: null, photoUrl: 'https://p/831.jpg', mkSiteId: 831, category: 'mk' })
  })

  it('enriches a seeded email-only MK row in place (no duplicate)', async () => {
    const [seed] = await db.insert(letterContacts).values({
      displayName: 'דן אילוז', email: 'stale@knesset.gov.il', category: 'mk',
    }).returning()
    await seedMk(1116, 'דן אילוז', 'https://p/1116.jpg')
    emailFor.mockResolvedValue('danillouz@knesset.gov.il')

    await run(false)

    const rows = await contactsBySite(1116)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(seed.id) // same row, enriched — not a new one
    expect(rows[0]).toMatchObject({ email: 'danillouz@knesset.gov.il', photoUrl: 'https://p/1116.jpg', mkSiteId: 1116 })
    expect(await db.select().from(letterContacts)).toHaveLength(1)
  })

  it('collapses duplicates to one, deleting the unreferenced dup and preserving a manual phone', async () => {
    const [emailRow] = await db.insert(letterContacts).values({
      displayName: 'אופיר כץ', email: 'okatz@knesset.gov.il', category: 'mk',
    }).returning()
    const [phoneRow] = await db.insert(letterContacts).values({
      displayName: 'אופיר כץ', phone: '+972506231238', mkSiteId: 976, category: 'mk',
    }).returning()
    await seedMk(976, 'אופיר כץ', 'https://p/976.jpg')
    emailFor.mockResolvedValue('okatz@knesset.gov.il')

    await run(false)

    const rows = await contactsBySite(976)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(phoneRow.id) // canonical = the one carrying the Site ID
    expect(rows[0]).toMatchObject({
      email: 'okatz@knesset.gov.il', phone: '+972506231238', photoUrl: 'https://p/976.jpg',
    })
    // the unreferenced email-only dup was deleted
    expect((await db.select().from(letterContacts)).find((c) => c.id === emailRow.id)).toBeUndefined()
  })

  it('never deletes a referenced duplicate (keeps it, logs a collision)', async () => {
    const [refRow] = await db.insert(letterContacts).values({
      displayName: 'אופיר כץ', email: 'okatz@knesset.gov.il', category: 'mk',
    }).returning()
    const [siteRow] = await db.insert(letterContacts).values({
      displayName: 'אופיר כץ', mkSiteId: 976, category: 'mk',
    }).returning()
    await referenceContact(refRow.id)
    await referenceContact(siteRow.id)
    await seedMk(976, 'אופיר כץ', 'https://p/976.jpg')
    emailFor.mockResolvedValue('okatz@knesset.gov.il')

    const plan = await run(false)

    const all = await db.select().from(letterContacts)
    // both referenced rows survive — nothing deleted
    expect(all.find((c) => c.id === refRow.id)).toBeDefined()
    expect(all.find((c) => c.id === siteRow.id)).toBeDefined()
    expect(plan.deletes).toHaveLength(0)
    expect(plan.collisions.length).toBeGreaterThan(0)
  })

  it('is idempotent — a second run inserts and deletes nothing', async () => {
    await seedMk(500, 'טסט', 'https://p/500.jpg')
    await seedMk(831, 'מירי רגב', 'https://p/831.jpg')
    emailFor.mockImplementation(async (id: number) => (id === 500 ? 'a@knesset.gov.il' : null))

    await run(false)
    const afterFirst = (await db.select().from(letterContacts)).length

    const plan = await run(false)
    expect(plan.inserts).toHaveLength(0)
    expect(plan.deletes).toHaveLength(0)
    expect((await db.select().from(letterContacts)).length).toBe(afterFirst)
  })
})
