import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { users } from '../db/schema'

const GROUP_ROLE = 'group'

export class UsersRepository {
  private cachedId: number | null = null

  /**
   * The id of the single `group` account that owns the public/default tracking list
   * (admins curate it; everyone reads it). Created on demand if absent.
   */
  async getGroupUserId(): Promise<number> {
    if (this.cachedId !== null) return this.cachedId
    const existing = await db.select().from(users).where(eq(users.role, GROUP_ROLE))
    if (existing[0]) {
      this.cachedId = existing[0].id
      return this.cachedId
    }
    const [row] = await db
      .insert(users)
      .values({ label: 'group', role: GROUP_ROLE, createdAt: new Date() })
      .returning({ id: users.id })
    this.cachedId = row.id
    return row.id
  }
}
