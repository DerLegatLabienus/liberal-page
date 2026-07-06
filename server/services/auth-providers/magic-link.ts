import { randomBytes, createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { magicLinkTokens } from '../../db/schema'
import { AuthRepository } from '../../repositories/auth-repository'
import { sendEmail } from '../email'
import { AuthError } from '../auth-service'

const authRepo = new AuthRepository()

const TOKEN_TTL_MS = 15 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function appPublicUrl(): string {
  return process.env.APP_PUBLIC_URL ?? 'http://localhost:5173'
}

/**
 * Requests a magic sign-in link for `email`. Always resolves (never throws, never signals
 * whether the email is known) — this is the anti-enumeration boundary: a caller cannot
 * distinguish "invited, link sent" from "unknown email, nothing happened" by the return value
 * or timing-sensitive branches. Only an allowlisted or already-registered email actually gets
 * a token stored + an email sent; every other input is a silent no-op.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return

  const [allowed, existing] = await Promise.all([
    authRepo.getAllowedEmail(normalized),
    authRepo.findUserByEmail(normalized),
  ])
  if (!allowed && !existing) return

  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await db.insert(magicLinkTokens).values({ email: normalized, tokenHash, expiresAt, createdAt: new Date() })

  const link = `${appPublicUrl()}/auth/magic-link?token=${token}`
  await sendEmail({ to: normalized, template: 'magic_link', params: { link } })
}

/**
 * Verifies a magic-link token: hashes it, then atomically deletes-and-returns the matching row
 * (single-use). Using a single DELETE ... RETURNING instead of SELECT-then-DELETE closes the
 * replay window where two concurrent verifies could both read the row before either deleted it —
 * here at most one caller can ever receive the row; the other gets zero rows back. Throws
 * `AuthError('invalid_token')` for a missing, already-used, or expired token; the caller cannot
 * tell which case it was (same anti-enumeration reasoning as `requestMagicLink`).
 */
export async function verifyMagicLink(token: string): Promise<{ email: string }> {
  const tokenHash = hashToken(token)
  // Delete regardless of expiry so a stale row can never be replayed twice.
  const [row] = await db.delete(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash)).returning()

  if (!row) throw new AuthError('invalid_token')
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('invalid_token')

  return { email: row.email }
}
