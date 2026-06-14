import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { LettersRepository } from '../repositories/letters-repository'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { renderLetterHtml, buildMailtoUrl } from '../services/letter-utils'
import type { LetterAddress } from '../db/schema'

const router = Router()
const lettersRepo = new LettersRepository()
const tagsRepo = new LetterIssueTagsRepository()
const analyticsRepo = new LetterAnalyticsRepository()

router.use(requireAuth)

// GET /api/letters/tags — all issue tags for filter UI
router.get('/tags', async (_req, res) => {
  try {
    const tags = await tagsRepo.list()
    res.json({ tags })
  } catch (err) {
    console.error('[letters] tags failed:', err)
    res.status(500).json({ error: 'Failed to load tags' })
  }
})

// GET /api/letters — published letters with optional tag filter
router.get('/', async (req, res) => {
  try {
    const tagParam = req.query.tags as string | undefined
    const tagIds = tagParam ? tagParam.split(',').map(Number).filter(Boolean) : undefined
    const letterList = await lettersRepo.listPublished(tagIds)
    res.json({ letters: letterList })
  } catch (err) {
    console.error('[letters] list failed:', err)
    res.status(500).json({ error: 'Failed to load letters' })
  }
})

// GET /api/letters/:id — letter detail with rendered HTML and mailto URL
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const letter = await lettersRepo.getById(id)
    if (!letter || letter.status !== 'published') return res.status(404).json({ error: 'Not found' })

    const renderedHtml = await renderLetterHtml(letter.bodyHtml, letter.templateId)
    const mailtoUrl = buildMailtoUrl(
      letter.toAddresses as LetterAddress[],
      letter.ccAddresses as LetterAddress[],
      letter.bccAddresses as LetterAddress[],
      letter.subject,
      letter.bodyPlain,
    )
    res.json({ letter, renderedHtml, mailtoUrl })
  } catch (err) {
    console.error('[letters] detail failed:', err)
    res.status(500).json({ error: 'Failed to load letter' })
  }
})

// POST /api/letters/:id/send — fire-and-forget analytics event
router.post('/:id/send', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { action } = req.body as { action?: string }
    if (action !== 'mailto' && action !== 'copy') return res.status(400).json({ error: 'action must be mailto or copy' })

    const letter = await lettersRepo.getById(id)
    if (!letter || letter.status !== 'published') return res.status(404).json({ error: 'Not found' })

    setImmediate(async () => {
      try {
        await analyticsRepo.record(id, action)
        await lettersRepo.incrementActivityScore(id)
      } catch (err) {
        console.error('[letters] analytics record failed:', err)
      }
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[letters] send failed:', err)
    res.status(500).json({ error: 'Failed to record send' })
  }
})

export default router
