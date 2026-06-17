import { eq, ilike, or } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'

export type LetterContact = typeof letterContacts.$inferSelect

export class LetterContactsRepository {
  async list(): Promise<LetterContact[]> {
    return db.select().from(letterContacts).orderBy(letterContacts.displayName)
  }

  async search(q: string): Promise<LetterContact[]> {
    const pattern = `%${q}%`
    return db
      .select()
      .from(letterContacts)
      .where(or(ilike(letterContacts.displayName, pattern), ilike(letterContacts.email, pattern)))
      .orderBy(letterContacts.displayName)
  }

  async create(input: { displayName: string; email: string; category: string }): Promise<LetterContact> {
    const [row] = await db.insert(letterContacts).values(input).returning()
    return row
  }

  /**
   * Insert many contacts, skipping any whose email already exists. Idempotent:
   * re-running never creates duplicates (email is UNIQUE) and never clobbers
   * admin-curated rows. Used by the seed to pre-populate the address book.
   */
  async bulkUpsert(rows: { displayName: string; email: string; category: string }[]): Promise<void> {
    if (rows.length === 0) return
    await db.insert(letterContacts).values(rows).onConflictDoNothing({ target: letterContacts.email })
  }

  async update(id: number, input: { displayName: string; email: string; category: string }): Promise<void> {
    await db.update(letterContacts).set(input).where(eq(letterContacts.id, id))
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterContacts).where(eq(letterContacts.id, id))
  }
}
