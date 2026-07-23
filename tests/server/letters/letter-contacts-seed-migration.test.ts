import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letterContacts } from '../../server/db/schema'
import { eq } from 'drizzle-orm'

// Verifies migration 0020_seed_letter_contacts.sql populates the address book on a
// from-scratch DB (migrations run via setupTestDb). Deliberately does NOT clear
// letter_contacts, so it asserts the migration-seeded defaults are present.
describe('default letter contacts (migration 0020)', () => {
  beforeAll(async () => { await setupTestDb() })

  it('seeds the 12 ministry role mailboxes', async () => {
    const ministries = await db.select().from(letterContacts).where(eq(letterContacts.category, 'ministry'))
    expect(ministries).toHaveLength(12)
    expect(ministries.map((c) => c.email)).toContain('dover@mod.gov.il')
  })

  it('seeds the baseline MK mailboxes', async () => {
    const mks = await db.select().from(letterContacts).where(eq(letterContacts.category, 'mk'))
    expect(mks).toHaveLength(4)
    expect(mks.map((c) => c.email)).toContain('okatz@knesset.gov.il')
  })
})
