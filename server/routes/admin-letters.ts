import { Router } from 'express'
import { requireAdmin } from '../middleware/auth'
import { LettersRepository } from '../repositories/letters-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { stripHtml } from '../services/letter-utils'
import type { LetterAddress } from '../db/schema'

const router = Router()
const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()

router.use(requireAdmin)

// GET /api/admin/letters — all letters with analytics
router.get('/', async (_req, res) => {
  try {
    const allLetters = await lettersRepo.listAll()
    const withStats = await Promise.all(
      allLetters.map(async (letter) => {
        const stats = await analyticsRepo.getForLetter(letter.id)
        return { ...letter, totalSends: stats.lifetime?.total ?? 0, breakdown: stats.lifetime?.breakdown ?? {} }
      }),
    )
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
    const letter = await lettersRepo.create({ ...body, bodyPlain: stripHtml(body.bodyHtml) })
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
    if (body.bodyHtml) update.bodyPlain = stripHtml(body.bodyHtml)
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

export default router
