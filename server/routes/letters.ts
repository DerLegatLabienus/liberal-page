import { Router, type Request, type Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { LettersRepository } from '../repositories/letters-repository'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { LetterContactsRepository } from '../repositories/letter-contacts-repository'
import { renderLetterHtml, buildMailtoUrl, buildGmailComposeUrl } from '../services/letter-utils'
import { reachableOn } from '../services/channel-availability'
import type { LetterAddress } from '../db/schema'
import type { ChannelKind } from '../../src/types'

const router = Router()
const lettersRepo = new LettersRepository()
const tagsRepo = new LetterIssueTagsRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flagsRepo = new FeatureFlagsRepository()
const contactsRepo = new LetterContactsRepository()

router.use(requireAuth)

// Honor the lettersEnabled kill-switch on the API too, not just in the frontend.
router.use(async (_req, res, next) => {
  try {
    if (!(await flagsRepo.isEnabled('lettersEnabled'))) {
      return res.status(404).json({ error: 'Not found' })
    }
    next()
  } catch (err) {
    console.error('[letters] flag check failed:', err)
    res.status(500).json({ error: 'Failed to load letters' })
  }
})

/** Parse a numeric route id, sending 400 instead of letting NaN reach the repo. */
function parseId(req: Request, res: Response): number | null {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

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

// GET /api/letters/contacts — read-only address book for the member recipient picker.
// MUST be declared before `/:id` so Express doesn't treat "contacts" as an id.
router.get('/contacts', async (req, res) => {
  try {
    const q = req.query.q as string | undefined
    const channelRaw = req.query.channel as string | undefined

    // Validate channel param if present
    const validChannels: ChannelKind[] = ['email', 'sms', 'whatsapp']
    if (channelRaw && !validChannels.includes(channelRaw as ChannelKind)) {
      return res.status(400).json({ error: 'invalid channel' })
    }
    const channel = channelRaw as ChannelKind | undefined

    let contacts = q ? await contactsRepo.search(q) : await contactsRepo.list()
    if (channel) contacts = contacts.filter((c) => reachableOn(channel, c))
    res.json({ contacts })
  } catch (err) {
    console.error('[letters] contacts failed:', err)
    res.status(500).json({ error: 'Failed to load contacts' })
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
    const id = parseId(req, res)
    if (id === null) return
    const letter = await lettersRepo.getById(id)
    if (!letter || letter.status !== 'published') return res.status(404).json({ error: 'Not found' })

    const renderedHtml = await renderLetterHtml(letter.bodyHtml, letter.templateId)
    const addrs = [
      letter.toAddresses as LetterAddress[],
      letter.ccAddresses as LetterAddress[],
      letter.bccAddresses as LetterAddress[],
    ] as const
    const mailtoUrl = buildMailtoUrl(...addrs, letter.subject, letter.bodyPlain)
    const gmailUrl = buildGmailComposeUrl(...addrs, letter.subject, letter.bodyPlain)
    res.json({ letter, renderedHtml, mailtoUrl, gmailUrl })
  } catch (err) {
    console.error('[letters] detail failed:', err)
    res.status(500).json({ error: 'Failed to load letter' })
  }
})

// POST /api/letters/:id/send — fire-and-forget analytics event
router.post('/:id/send', async (req, res) => {
  try {
    const id = parseId(req, res)
    if (id === null) return
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
