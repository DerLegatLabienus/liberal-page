import { eq, lt, ne, count } from 'drizzle-orm'
import { db } from '../db/client'
import { users, allowedEmails, refreshTokens } from '../db/schema'

export interface AuthUser {
  id: number
  email: string | null
  name: string | null
  role: string
  emailAlerts: boolean
}

function toUser(row: typeof users.$inferSelect): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, emailAlerts: row.emailAlerts }
}

export class AuthRepository {
  /** The allowlist entry for an email, or null if not invited. */
  async getAllowedEmail(email: string): Promise<{ email: string; role: string } | null> {
    const rows = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email))
    return rows[0] ? { email: rows[0].email, role: rows[0].role } : null
  }

  /**
   * Insert or update a user from a verified Google identity. On first insert the given
   * `role` is applied; on a returning login the role is NOT changed here (admins manage
   * roles explicitly), only profile fields + lastLoginAt refresh.
   */
  async upsertUserFromGoogle(input: {
    email: string; googleSub: string; name: string | null; role: string
  }): Promise<AuthUser> {
    const now = new Date()
    const [row] = await db
      .insert(users)
      .values({
        label: input.email, email: input.email, googleSub: input.googleSub,
        name: input.name, role: input.role, createdAt: now, lastLoginAt: now,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { googleSub: input.googleSub, name: input.name, lastLoginAt: now },
      })
      .returning()
    return toUser(row)
  }

  async findUserById(id: number): Promise<AuthUser | null> {
    const rows = await db.select().from(users).where(eq(users.id, id))
    return rows[0] ? toUser(rows[0]) : null
  }

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const rows = await db.select().from(users).where(eq(users.email, email))
    return rows[0] ? toUser(rows[0]) : null
  }

  async createRefreshToken(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    await db.insert(refreshTokens).values({ userId, tokenHash, expiresAt, createdAt: new Date() })
  }

  async findRefreshToken(tokenHash: string): Promise<{ userId: number; expiresAt: Date } | null> {
    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
    return rows[0] ? { userId: rows[0].userId, expiresAt: rows[0].expiresAt } : null
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
  }

  /** Revoke every session for a user (logout-all / reuse detection). */
  async deleteUserRefreshTokens(userId: number): Promise<void> {
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  }

  /** Hygiene: drop expired rows so the table holds only currently-valid sessions. */
  async deleteExpired(now: Date): Promise<number> {
    const deleted = await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now)).returning({ id: refreshTokens.id })
    return deleted.length
  }

  // --- Admin: invites (allowlist) -------------------------------------------------------

  async listInvites(): Promise<{ email: string; role: string; createdAt: string }[]> {
    const rows = await db.select().from(allowedEmails)
    return rows.map((r) => ({ email: r.email, role: r.role, createdAt: r.createdAt.toISOString() }))
  }

  async addInvite(email: string, role: string, invitedBy: number | null): Promise<void> {
    await db.insert(allowedEmails)
      .values({ email, role, invitedBy, createdAt: new Date() })
      .onConflictDoUpdate({ target: allowedEmails.email, set: { role } })
  }

  async removeInvite(email: string): Promise<void> {
    await db.delete(allowedEmails).where(eq(allowedEmails.email, email))
  }

  // --- Admin: users + roles -------------------------------------------------------------

  /** Real accounts (excludes the internal `group` list-owner row). */
  async listUsers(): Promise<AuthUser[]> {
    const rows = await db.select().from(users).where(ne(users.role, 'group'))
    return rows.map(toUser)
  }

  async countAdmins(): Promise<number> {
    const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, 'admin'))
    return row?.n ?? 0
  }

  async setUserRole(id: number, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id))
  }

  async setEmailAlerts(id: number, value: boolean): Promise<void> {
    await db.update(users).set({ emailAlerts: value }).where(eq(users.id, id))
  }
}
