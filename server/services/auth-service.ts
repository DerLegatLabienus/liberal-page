import { createHash, randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { AuthRepository, type AuthUser } from '../repositories/auth-repository'

const authRepo = new AuthRepository()

const isTest = process.env.NODE_ENV === 'test'

function jwtSecret(): string {
  const s = process.env.JWT_SECRET
  if (s) return s
  if (isTest) return 'test-jwt-secret'
  throw new Error('JWT_SECRET is not set')
}

function googleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID
  if (id) return id
  if (isTest) return 'test-google-client-id'
  throw new Error('GOOGLE_CLIENT_ID is not set')
}

const ACCESS_TTL_S = Number(process.env.ACCESS_TOKEN_TTL ?? 900)        // 15 min
const REFRESH_TTL_S = Number(process.env.REFRESH_TOKEN_TTL ?? 2_592_000) // 30 days

export interface AccessClaims { userId: number; role: string }

// --- Google ID token verification -------------------------------------------------------

// Lazily constructed so an unset GOOGLE_CLIENT_ID never crashes server boot — only an
// actual login attempt needs the config. The public site + group list work without it.
let googleClient: OAuth2Client | null = null
function getGoogleClient(): OAuth2Client {
  return (googleClient ??= new OAuth2Client(googleClientId()))
}

export interface GoogleIdentity { email: string; sub: string; name: string | null }

/** Verifies a Google ID token and extracts identity. Throws if invalid. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const ticket = await getGoogleClient().verifyIdToken({ idToken, audience: googleClientId() })
  const payload = ticket.getPayload()
  if (!payload?.email) throw new Error('Google token has no email')
  return { email: payload.email, sub: payload.sub, name: payload.name ?? null }
}

// --- Access tokens (JWT) ----------------------------------------------------------------

export function issueAccessToken(user: AuthUser): string {
  return jwt.sign({ userId: user.id, role: user.role }, jwtSecret(), { expiresIn: ACCESS_TTL_S })
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, jwtSecret()) as { userId?: number; role?: string }
    if (typeof decoded.userId !== 'number' || typeof decoded.role !== 'string') return null
    return { userId: decoded.userId, role: decoded.role }
  } catch {
    return null
  }
}

// --- Refresh tokens (opaque, self-identifying, hash-stored) ------------------------------

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Mints a refresh token `${userId}.${randomHex}`, stores only its hash, returns the raw. */
export async function issueRefreshToken(userId: number): Promise<string> {
  const raw = `${userId}.${randomBytes(32).toString('hex')}`
  const expiresAt = new Date(Date.now() + REFRESH_TTL_S * 1000)
  await authRepo.createRefreshToken(userId, hashToken(raw), expiresAt)
  return raw
}

export type RotateResult =
  | { ok: true; user: AuthUser; accessToken: string; refreshToken: string }
  | { ok: false; reason: 'invalid' | 'reuse' }

/**
 * Rotates a refresh token: validates, deletes the used row, issues a fresh pair.
 * On a hash miss the token was already rotated away or replayed → revoke all of that
 * user's sessions (reuse detection, using the userId prefix).
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  const hash = hashToken(rawToken)
  const row = await authRepo.findRefreshToken(hash)

  if (!row) {
    const userId = Number(rawToken.split('.')[0])
    if (Number.isInteger(userId) && userId > 0) await authRepo.deleteUserRefreshTokens(userId)
    return { ok: false, reason: 'reuse' }
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await authRepo.deleteRefreshToken(hash)
    return { ok: false, reason: 'invalid' }
  }

  await authRepo.deleteRefreshToken(hash) // rotate: one-time use
  const user = await authRepo.findUserById(row.userId)
  if (!user) return { ok: false, reason: 'invalid' }

  return {
    ok: true,
    user,
    accessToken: issueAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
  }
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await authRepo.deleteRefreshToken(hashToken(rawToken))
}
