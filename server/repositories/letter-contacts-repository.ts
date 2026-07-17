import { eq, ilike, or } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'
import { LetterChannelsRepository } from './letter-channels-repository'

export type LetterContact = typeof letterContacts.$inferSelect

export interface ContactInput {
  displayName: string
  email?: string | null
  phone?: string | null
  hasWhatsapp?: boolean
  photoUrl?: string | null
  mkSiteId?: number | null
  category?: string
}

const channelsRepo = new LetterChannelsRepository()

function values(input: ContactInput) {
  return {
    displayName: input.displayName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    hasWhatsapp: input.hasWhatsapp ?? false,
    photoUrl: input.photoUrl ?? null,
    mkSiteId: input.mkSiteId ?? null,
    category: input.category ?? 'custom',
  }
}

export class LetterContactsRepository {
  async list(): Promise<LetterContact[]> {
    return db.select().from(letterContacts).orderBy(letterContacts.displayName)
  }

  async search(q: string): Promise<LetterContact[]> {
    const pattern = `%${q}%`
    return db
      .select()
      .from(letterContacts)
      .where(or(
        ilike(letterContacts.displayName, pattern),
        ilike(letterContacts.email, pattern),
        ilike(letterContacts.phone, pattern),
      ))
      .orderBy(letterContacts.displayName)
  }

  async create(input: ContactInput): Promise<LetterContact> {
    const [row] = await db.insert(letterContacts).values(values(input)).returning()
    return row
  }

  /**
   * Insert many contacts, skipping any whose email already exists. Idempotent:
   * re-running never creates duplicates (email is UNIQUE) and never clobbers
   * admin-curated rows. Used by the seed to pre-populate the address book.
   */
  async bulkUpsert(rows: ContactInput[]): Promise<void> {
    if (rows.length === 0) return
    await db.insert(letterContacts).values(rows.map(values)).onConflictDoNothing({ target: letterContacts.email })
  }

  async update(id: number, input: ContactInput): Promise<void> {
    await db.update(letterContacts).set(values(input)).where(eq(letterContacts.id, id))
  }

  /** True if the contact is referenced by any letter channel (recipient/cc/bcc). */
  async isReferenced(id: number): Promise<boolean> {
    return channelsRepo.contactReferenced(id)
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterContacts).where(eq(letterContacts.id, id))
  }
}
