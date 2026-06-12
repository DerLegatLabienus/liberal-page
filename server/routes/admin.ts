import { Router } from 'express'
import { AuthRepository } from '../repositories/auth-repository'
import { EmailTemplatesRepository } from '../repositories/email-templates-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { requireAdmin } from '../middleware/auth'
import { sendEmail } from '../services/email'

const router = Router()
const authRepo = new AuthRepository()
const emailTemplatesRepo = new EmailTemplatesRepository()
const flagsRepo = new FeatureFlagsRepository()

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
  // Atomic: attempt the invite email FIRST and only persist the allowlist entry if the send
  // did not fail. A `skipped` result (email not configured) is not a failure; a genuine send
  // failure returns 502 and records no invite.
  const result = await sendEmail({
    to: normalized,
    template: 'invite',
    params: {
      siteUrl: process.env.PUBLIC_SITE_URL ?? '',
      roleLine: grantRole === 'admin' ? ' הוקצתה לך הרשאת מנהל.' : '',
    },
  })
  if (result.status === 'failed') {
    return res.status(502).json({ error: 'Invitation email failed to send; invite not created' })
  }
  await authRepo.addInvite(normalized, grantRole, req.user!.id)
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

// --- Email templates ---
router.get('/email-templates', async (_req, res) => {
  res.json({ templates: await emailTemplatesRepo.getAll() })
})

router.put('/email-templates/:name', async (req, res) => {
  const { subject, html } = req.body as { subject?: unknown; html?: unknown }
  if (typeof subject !== 'string' || typeof html !== 'string') {
    return res.status(400).json({ error: 'subject and html are required strings' })
  }
  await emailTemplatesRepo.update(req.params.name, { subject, html })
  res.json({ ok: true })
})

// --- Feature flags ---
router.put('/feature-flags/:name', async (req, res) => {
  const { enabled, value } = req.body as { enabled?: unknown; value?: unknown }
  if (typeof enabled !== 'boolean' || (value !== null && typeof value !== 'string')) {
    return res.status(400).json({ error: 'enabled must be boolean; value must be string or null' })
  }
  await flagsRepo.setFlag(req.params.name, enabled, value)
  res.json({ ok: true })
})

export default router
