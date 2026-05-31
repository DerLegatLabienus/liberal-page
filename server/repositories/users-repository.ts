import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { users } from '../db/schema'

const SHARED_LABEL = 'shared'

export class UsersRepository {
  private cachedId: number | null = null

  async getSharedUserId(): Promise<number> {
    if (this.cachedId !== null) return this.cachedId
    const existing = await db.select().from(users).where(eq(users.label, SHARED_LABEL))
    if (existing[0]) {
      this.cachedId = existing[0].id
      return this.cachedId
    }
    const [row] = await db
      .insert(users)
      .values({ label: SHARED_LABEL, createdAt: new Date() })
      .returning({ id: users.id })
    this.cachedId = row.id
    return row.id
  }
}
