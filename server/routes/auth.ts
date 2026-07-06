import { Router } from 'express'
import { AuthRepository } from '../repositories/auth-repository'
import { requireAuth } from '../middleware/auth'
import {
  verifyGoogleIdToken, loginWithIdentity, AuthError, rotateRefreshToken, revokeRefreshToken,
  type ProviderIdentity,
} from '../services/auth-service'

const router = Router()
const authRepo = new AuthRepository()

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

// Exchange a verified provider ID token for our session tokens. Gated by the invite
// allowlist via loginWithIdentity — the single choke point for every provider.
router.post('/:provider', async (req, res) => {
  const { provider } = req.params
  const { idToken } = req.body as { idToken?: string }
  if (!idToken) return res.status(400).json({ error: 'idToken required' })

  let identity: ProviderIdentity
  if (provider === 'google') {
    try {
      const g = await verifyGoogleIdToken(idToken)
      identity = { provider: 'google', sub: g.sub, email: g.email, name: g.name }
    } catch {
      return res.status(401).json({ error: 'Invalid Google token' })
    }
  } else {
    return res.status(400).json({ error: `Unknown provider: ${provider}` })
  }

  try {
    const { user, accessToken, refreshToken } = await loginWithIdentity(identity)
    res.json({ accessToken, refreshToken, user: publicUser(user) })
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'not_invited') return res.status(403).json({ error: 'This email is not invited' })
      if (err.code === 'invalid_token') return res.status(401).json({ error: 'Invalid token' })
      if (err.code === 'provider_unconfigured') return res.status(503).json({ error: 'Provider not configured' })
      if (err.code === 'no_email') return res.status(403).json({ error: 'Identity has no email' })
    }
    throw err
  }
})

export default router
