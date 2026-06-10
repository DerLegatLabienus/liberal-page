import { Router } from 'express'
import { AuthRepository } from '../repositories/auth-repository'
import { requireAdmin } from '../middleware/auth'
import { sendEmail } from '../services/email'

const router = Router()
const authRepo = new AuthRepository()

// All admin endpoints require an admin bearer token.
router.use(requireAdmin)

// --- Invites (email allowlist) ---
router.get('/invites', async (_req, res) => {
  res.json({ invites: await authRepo.listInvites() })
})

router.post('/invites', async (req, res) => {
  const { email, role } = req.body as { email?: string; role?: string }
  if (!email) return res.status(400).json({ error: 'email required' })
  const grantRole = role === 'admin' ? 'admin' : 'member'
  const normalized = email.trim().toLowerCase()
  await authRepo.addInvite(normalized, grantRole, req.user!.id)
  void sendEmail({
    to: normalized,
    template: 'invite',
    params: {
      siteUrl: process.env.PUBLIC_SITE_URL ?? '',
      roleLine: grantRole === 'admin' ? ' הוקצתה לך הרשאת מנהל.' : '',
    },
  }).catch((e) => console.error('[email] invite send failed:', e))
  res.json({ ok: true })
})

router.delete('/invites/:email', async (req, res) => {
  await authRepo.removeInvite(decodeURIComponent(req.params.email).toLowerCase())
  res.json({ ok: true })
})

// --- Users + roles ---
router.get('/users', async (_req, res) => {
  res.json({ users: await authRepo.listUsers() })
})

router.patch('/users/:id/role', async (req, res) => {
  const id = Number(req.params.id)
  const { role } = req.body as { role?: string }
  if (role !== 'admin' && role !== 'member') return res.status(400).json({ error: 'role must be admin or member' })

  const target = await authRepo.findUserById(id)
  if (!target) return res.status(404).json({ error: 'User not found' })

  // Last-admin guard: never leave the system with zero admins.
  if (target.role === 'admin' && role !== 'admin' && (await authRepo.countAdmins()) <= 1) {
    return res.status(409).json({ error: 'Cannot demote the last admin' })
  }

  await authRepo.setUserRole(id, role)
  res.json({ ok: true })
})

export default router
