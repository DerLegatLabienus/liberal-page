import { Router } from 'express'
import { AuthRepository } from '../repositories/auth-repository'
import { requireAuth } from '../middleware/auth'
import {
  verifyGoogleIdToken, issueAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken,
} from '../services/auth-service'

const router = Router()
const authRepo = new AuthRepository()

function publicUser(u: { id: number; email: string | null; name: string | null; role: string; emailAlerts: boolean }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailAlerts: u.emailAlerts }
}

// Exchange a verified Google ID token for our session tokens. Gated by the invite allowlist.
router.post('/google', async (req, res) => {
  const { idToken } = req.body as { idToken?: string }
  if (!idToken) return res.status(400).json({ error: 'idToken required' })

  let identity
  try {
    identity = await verifyGoogleIdToken(idToken)
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' })
  }

  const allowed = await authRepo.getAllowedEmail(identity.email)
  const existing = await authRepo.findUserByEmail(identity.email)
  if (!allowed && !existing) return res.status(403).json({ error: 'This email is not invited' })

  const role = existing?.role ?? allowed?.role ?? 'member'
  const user = await authRepo.upsertUserFromGoogle({
    email: identity.email, googleSub: identity.sub, name: identity.name, role,
  })
  res.json({
    accessToken: issueAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
    user: publicUser(user),
  })
})

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

export default router
