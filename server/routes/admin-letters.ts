import { Router } from 'express'
import { requireAdmin } from '../middleware/auth'
import { LettersRepository } from '../repositories/letters-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { stripHtml } from '../services/letter-utils'
import { sanitizeLetterHtml } from '../services/html-sanitizer'
import { beautifyLetterHtml } from '../services/letter-beautifier'
import type { LetterAddress } from '../db/schema'

const router = Router()
const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flagsRepo = new FeatureFlagsRepository()

router.use(requireAdmin)

// GET /api/admin/letters — all letters with analytics
router.get('/', async (_req, res) => {
  try {
    const allLetters = await lettersRepo.listAll()
    const statsById = await analyticsRepo.getLifetimeForLetters(allLetters.map((l) => l.id))
    const withStats = allLetters.map((letter) => {
      const stats = statsById.get(letter.id)
      return { ...letter, totalSends: stats?.total ?? 0, breakdown: stats?.breakdown ?? {} }
    })
    res.json({ letters: withStats })
  } catch (err) {
    console.error('[admin/letters] list failed:', err)
    res.status(500).json({ error: 'Failed to load letters' })
  }
})

// POST /api/admin/letters — create letter
router.post('/', async (req, res) => {
  try {
    const body = req.body as {
      title: string; subject: string; bodyHtml: string
      toAddresses: LetterAddress[]; ccAddresses?: LetterAddress[]; bccAddresses?: LetterAddress[]
      issueTagIds?: number[]; templateId?: number | null; status?: string; priority?: string
    }
    if (!body.title || !body.subject || !body.bodyHtml || !Array.isArray(body.toAddresses) || body.toAddresses.length === 0) {
      return res.status(400).json({ error: 'title, subject, bodyHtml, and at least one toAddress are required' })
    }
    const bodyHtml = sanitizeLetterHtml(body.bodyHtml)
    const letter = await lettersRepo.create({ ...body, bodyHtml, bodyPlain: stripHtml(bodyHtml) })
    res.status(201).json({ letter })
  } catch (err) {
    console.error('[admin/letters] create failed:', err)
    res.status(500).json({ error: 'Failed to create letter' })
  }
})

// PUT /api/admin/letters/:id — update letter
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const body = req.body as Partial<{
      title: string; subject: string; bodyHtml: string; toAddresses: LetterAddress[]
      ccAddresses: LetterAddress[]; bccAddresses: LetterAddress[]; issueTagIds: number[]
      templateId: number | null; status: string; priority: string
    }>
    const update: Parameters<typeof lettersRepo.update>[1] = { ...body }
    if (body.bodyHtml) {
      const bodyHtml = sanitizeLetterHtml(body.bodyHtml)
      update.bodyHtml = bodyHtml
      update.bodyPlain = stripHtml(bodyHtml)
    }
    await lettersRepo.update(id, update)
    const letter = await lettersRepo.getById(id)
    res.json({ letter })
  } catch (err) {
    console.error('[admin/letters] update failed:', err)
    res.status(500).json({ error: 'Failed to update letter' })
  }
})

// DELETE /api/admin/letters/:id — delete letter
router.delete('/:id', async (req, res) => {
  try {
    await lettersRepo.delete(Number(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    console.error('[admin/letters] delete failed:', err)
    res.status(500).json({ error: 'Failed to delete letter' })
  }
})

// PATCH /api/admin/letters/:id/pin — toggle pin
router.patch('/:id/pin', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { pinned } = req.body as { pinned: boolean }
    await lettersRepo.setPinned(id, pinned)
    const letter = await lettersRepo.getById(id)
    res.json({ letter })
  } catch (err) {
    console.error('[admin/letters] pin failed:', err)
    res.status(500).json({ error: 'Failed to toggle pin' })
  }
})

// POST /api/admin/letters/beautify — AI clean + improve letter body HTML.
// Gated by the lettersBeautifyEnabled flag (off by default → 404, capability stays dark).
router.post('/beautify', async (req, res) => {
  try {
    if (!(await flagsRepo.isEnabled('lettersBeautifyEnabled'))) {
      return res.status(404).json({ error: 'Not found' })
    }
    const { html } = req.body as { html?: string }
    if (!html || !html.trim()) return res.status(400).json({ error: 'html is required' })

    const beautified = await beautifyLetterHtml(html)
    res.json({ html: beautified })
  } catch (err) {
    console.error('[admin/letters] beautify failed:', err)
    const msg = err instanceof Error && err.message === 'beautify_unavailable'
      ? 'AI service is not configured'
      : 'Failed to beautify'
    res.status(err instanceof Error && err.message === 'beautify_unavailable' ? 503 : 500).json({ error: msg })
  }
})

export default router
