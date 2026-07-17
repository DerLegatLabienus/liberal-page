import { Router } from 'express'
import { requireAdmin } from '../middleware/auth'
import { LettersRepository, attachChannels } from '../repositories/letters-repository'
import { LetterChannelsRepository } from '../repositories/letter-channels-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { beautifyLetterHtml } from '../services/letter-beautifier'
import { syncShareForLetter, removeShareForLetter } from '../services/share-publisher'
import type { LetterChannelInput } from '../../src/types'

const router = Router()
const lettersRepo = new LettersRepository()
const channelsRepo = new LetterChannelsRepository()
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
      title: string; issueTagIds?: number[]; status?: string; priority?: string
      channels?: LetterChannelInput[]
    }
    if (!body.title) {
      return res.status(400).json({ error: 'title is required' })
    }
    const { title, status, priority, issueTagIds, channels } = body
    const letter = await lettersRepo.createCore({ title, status, priority, issueTagIds, createdBy: req.user?.id ?? null })
    await channelsRepo.replaceForLetter(letter.id, channels ?? [])
    setImmediate(() => { syncShareForLetter(letter.id) })
    res.status(201).json({ letter: (await attachChannels([letter]))[0] })
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
      title: string; issueTagIds: number[]; status: string; priority: string
      channels: LetterChannelInput[]
    }>
    const { channels, ...core } = body
    await lettersRepo.updateCore(id, core)
    if (channels) await channelsRepo.replaceForLetter(id, channels)
    const letter = await lettersRepo.getById(id)
    setImmediate(() => { syncShareForLetter(id) })
    res.json({ letter: letter ? (await attachChannels([letter]))[0] : null })
  } catch (err) {
    console.error('[admin/letters] update failed:', err)
    res.status(500).json({ error: 'Failed to update letter' })
  }
})

// DELETE /api/admin/letters/:id — delete letter
router.delete('/:id', async (req, res) => {
  try {
    await lettersRepo.delete(Number(req.params.id))
    setImmediate(() => { removeShareForLetter(Number(req.params.id)) })
    res.json({ ok: true })
  } catch (err) {
    console.error('[admin/letters] delete failed:', err)
    res.status(500).json({ error: 'Failed to delete letter' })
  }
})

// POST /api/admin/letters/regenerate-shares — rebuild the R2 public share page for
// every published letter. Per-letter no-op when R2 is unconfigured or publicSharePages
// is off. Used to roll share-page template changes (e.g. the Turnstile interstitial)
// onto existing letters without editing them. Literal path — no collision with /:id.
router.post('/regenerate-shares', async (_req, res) => {
  try {
    const published = await lettersRepo.listPublished()
    for (const l of published) await syncShareForLetter(l.id)
    res.json({ regenerated: published.length })
  } catch (err) {
    console.error('[admin/letters] regenerate-shares failed:', err)
    res.status(500).json({ error: 'Failed to regenerate shares' })
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
