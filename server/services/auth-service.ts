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

export interface GoogleIdentity { email: string; sub: string; name: string | null; emailVerified: boolean }

/** Verifies a Google ID token and extracts identity. Throws if invalid. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const ticket = await getGoogleClient().verifyIdToken({ idToken, audience: googleClientId() })
  const payload = ticket.getPayload()
  if (!payload?.email) throw new Error('Google token has no email')
  // Google always emits `email_verified`; treat anything other than a literal `true` as
  // unverified rather than assuming absence means verified (see nOAuth: a provider that
  // lets the caller set an unverified email must never be trusted to assert ownership).
  return { email: payload.email, sub: payload.sub, name: payload.name ?? null, emailVerified: payload.email_verified === true }
}

// --- Provider-agnostic login choke point -------------------------------------------------

/**
 * A verified identity from any auth provider, ready to be logged in.
 *
 * `emailVerified` must reflect the PROVIDER's own proof that the caller controls this
 * mailbox, not merely that the provider issued a validly-signed token. A validly-signed
 * token only proves the caller authenticated with that provider — under a multi-tenant
 * identity provider (e.g. Microsoft Entra `common`), an attacker can self-register a tenant
 * and set the `email` claim to an arbitrary address, including one already invited here.
 * Trusting `email` without a verified-ownership signal lets that attacker's token merge into
 * the victim's account (nOAuth-style account takeover). See each adapter for how it derives
 * this flag.
 */
export interface ProviderIdentity { provider: string; sub: string; email: string; name: string | null; emailVerified: boolean }

export class AuthError extends Error {
  constructor(public code: 'not_invited' | 'no_email' | 'invalid_token' | 'provider_unconfigured' | 'email_not_verified') {
    super(code)
  }
}

/**
 * The single gate every provider's login flows through: enforces the invite-only
 * allowlist (or grandfathers an existing user), then upserts the user + identity link
 * and issues session tokens. Identical semantics to the previous Google-only handler.
 */
export async function loginWithIdentity(id: ProviderIdentity) {
  const email = id.email?.trim().toLowerCase()
  if (!email) throw new AuthError('no_email')
  // Defense against nOAuth account takeover: a provider-signed token proves the caller
  // authenticated, not that they own `email`. Reject before any allowlist lookup or upsert
  // so an unverified-email token can never merge into (or create) an account.
  if (!id.emailVerified) throw new AuthError('email_not_verified')

  const allowed = await authRepo.getAllowedEmail(email)
  const existing = await authRepo.findUserByEmail(email)
  if (!allowed && !existing) throw new AuthError('not_invited')

  const role = existing?.role ?? allowed?.role ?? 'member'
  const user = await authRepo.upsertUserFromIdentity({ email, provider: id.provider, sub: id.sub, name: id.name, role })
  return { user, accessToken: issueAccessToken(user), refreshToken: await issueRefreshToken(user.id) }
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
