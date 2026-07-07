import { Router } from 'express'
import { AuthRepository } from '../repositories/auth-repository'
import { requireAuth } from '../middleware/auth'
import {
  verifyGoogleIdToken, loginWithIdentity, AuthError, rotateRefreshToken, revokeRefreshToken,
  type ProviderIdentity,
} from '../services/auth-service'
import { requestMagicLink, verifyMagicLink } from '../services/auth-providers/magic-link'
import { verifyMicrosoftIdToken } from '../services/auth-providers/microsoft'
import { SlidingWindowLimiter } from '../services/rate-limit'

const router = Router()
const authRepo = new AuthRepository()

// Per (IP, email) — bounds both a single attacker hammering one email and a script trying
// many emails from one IP, without letting one noisy IP block a different email's requests.
let magicLinkLimiter = new SlidingWindowLimiter(5, 15 * 60_000)
/** Test-only: fresh limiter window. */
export function _resetMagicLinkLimiter(): void { magicLinkLimiter = new SlidingWindowLimiter(5, 15 * 60_000) }

function publicUser(u: { id: number; email: string | null; name: string | null; role: string; emailAlerts: boolean }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailAlerts: u.emailAlerts }
}

// NOTE: these fixed-path routes must be registered before the `/:provider` catch-all
// below — Express matches in registration order, and `/:provider` would otherwise
// shadow `/refresh` and `/logout` (e.g. POST /refresh matching provider="refresh").

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string }
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' })
  const result = await rotateRefreshToken(refreshToken)
  if (!result.ok) return res.status(401).json({ error: result.reason })
  res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: publicUser(result.user) })
})

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string }
  if (refreshToken) await revokeRefreshToken(refreshToken)
  res.json({ ok: true })
})

router.get('/me', requireAuth, async (req, res) => {
  const user = await authRepo.findUserById(req.user!.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: publicUser(user) })
})

router.patch('/me', requireAuth, async (req, res) => {
  const { emailAlerts } = req.body as { emailAlerts?: unknown }
  if (typeof emailAlerts !== 'boolean') return res.status(400).json({ error: 'emailAlerts must be boolean' })
  await authRepo.setEmailAlerts(req.user!.id, emailAlerts)
  const user = await authRepo.findUserById(req.user!.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: publicUser(user) })
})

// Request a magic sign-in link. Always 200 — neutral response, never reveals whether the
// email is invited/registered (see requestMagicLink). Rate-limited per (IP, email) so it
// can't be used to spam an inbox or brute-force-probe the allowlist.
//
// The lookup + insert + email send happen AFTER the response is sent (via setImmediate),
// not before it. This closes a timing side-channel: previously an invited email did a DB
// lookup, a DB insert, and an awaited Resend network call before responding, while an
// unknown email returned immediately — the response latency itself revealed whether the
// email was known. Responding first and doing the work off the response path makes the
// response time independent of which branch `requestMagicLink` takes internally.
router.post('/magic-link/request', async (req, res) => {
  const { email } = req.body as { email?: string }
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' })

  const key = `${req.ip ?? 'unknown'}:${email.trim().toLowerCase()}`
  if (!magicLinkLimiter.allow(key)) return res.status(429).json({ error: 'rate_limited' })

  res.json({ ok: true })
  setImmediate(() => {
    requestMagicLink(email).catch((err) => {
      // Never let a send/storage failure leak through as a distinguishable response —
      // the response has already been sent by the time this runs.
      console.error('[magic-link] request failed:', err)
    })
  })
})

// Verify a magic-link token and log in. Single-use (verifyMagicLink deletes the row);
// missing/expired/reused tokens all surface as the same invalid_token error.
router.post('/magic-link/verify', async (req, res) => {
  const { token } = req.body as { token?: string }
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' })

  try {
    const { email } = await verifyMagicLink(token)
    // Magic-link's "verified email" proof is the delivery itself: only the inbox that
    // received the link can present this single-use token, so ownership is already
    // established by the time we get here.
    const { user, accessToken, refreshToken } = await loginWithIdentity({
      provider: 'magic-link', sub: email, email, name: null, emailVerified: true,
    })
    res.json({ accessToken, refreshToken, user: publicUser(user) })
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'not_invited') return res.status(403).json({ error: 'This email is not invited' })
      if (err.code === 'invalid_token') return res.status(401).json({ error: 'Invalid or expired link' })
      if (err.code === 'no_email') return res.status(403).json({ error: 'Identity has no email' })
      if (err.code === 'email_not_verified') return res.status(403).json({ error: 'Your email is not verified' })
    }
    throw err
  }
})

// One verifier per supported provider, each resolving to a `ProviderIdentity` or throwing
// `AuthError`. A registry (rather than an if-chain) keeps adding a provider to a one-line
// addition here plus its own adapter module.
const verifiers: Record<string, (idToken: string) => Promise<ProviderIdentity>> = {
  google: async (idToken) => {
    try {
      const g = await verifyGoogleIdToken(idToken)
      return { provider: 'google', sub: g.sub, email: g.email, name: g.name, emailVerified: g.emailVerified }
    } catch {
      throw new AuthError('invalid_token')
    }
  },
  microsoft: verifyMicrosoftIdToken,
}

// Exchange a verified provider ID token for our session tokens. Gated by the invite
// allowlist via loginWithIdentity — the single choke point for every provider.
router.post('/:provider', async (req, res) => {
  const { provider } = req.params
  const { idToken } = req.body as { idToken?: string }
  if (!idToken) return res.status(400).json({ error: 'idToken required' })

  const verify = verifiers[provider]
  if (!verify) return res.status(400).json({ error: `Unknown provider: ${provider}` })

  try {
    const identity = await verify(idToken)
    const { user, accessToken, refreshToken } = await loginWithIdentity(identity)
    res.json({ accessToken, refreshToken, user: publicUser(user) })
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'not_invited') return res.status(403).json({ error: 'This email is not invited' })
      if (err.code === 'invalid_token') return res.status(401).json({ error: 'Invalid token' })
      if (err.code === 'provider_unconfigured') return res.status(503).json({ error: 'Provider not configured' })
      if (err.code === 'no_email') return res.status(403).json({ error: 'Identity has no email' })
      if (err.code === 'email_not_verified') {
        return res.status(403).json({ error: `Your ${provider} account's email is not verified` })
      }
    }
    throw err
  }
})

export default router
