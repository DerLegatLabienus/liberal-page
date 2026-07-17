import express, { Router } from 'express'
import { LettersRepository } from '../repositories/letters-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { verifyTurnstile } from '../services/turnstile'

const router = Router()
const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flagsRepo = new FeatureFlagsRepository()

// Public page actions → their dedicated analytics buckets (never the member buckets).
const BUCKET = {
  mailto: 'public_mailto', gmail: 'public_gmail', copy: 'public_copy',
  sms: 'public_sms', whatsapp: 'public_whatsapp',
} as const
type PublicAction = keyof typeof BUCKET
// sms/whatsapp are per-recipient channel sends: recorded via recordChannel into a fixed literal
// bucket broken down by contact id, instead of record()'s day/lifetime pair keyed by action name.
const CHANNEL_ACTIONS = new Set<PublicAction>(['sms', 'whatsapp'])

// Light anti-noise throttle: ignore a repeat (ip, letter, action) within the window.
const WINDOW_MS = 10_000
const seen = new Map<string, number>()
function throttled(key: string): boolean {
  const now = Date.now()
  const prev = seen.get(key)
  if (prev && now - prev < WINDOW_MS) return true
  seen.set(key, now)
  if (seen.size > 5000) for (const [k, t] of seen) if (now - t > WINDOW_MS) seen.delete(k)
  return false
}

// POST /api/public/letters/:id/send?action=mailto|gmail|copy|sms|whatsapp&contactId=123
// No auth. Fire-and-forget: always 204; records only for a published letter when lettersEnabled.
router.post('/:id/send', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
  const id = Number(req.params.id)
  const action = String(req.query.action || '') as PublicAction
  const contactIdRaw = req.query.contactId
  const contactId = typeof contactIdRaw === 'string' && /^\d+$/.test(contactIdRaw) ? Number(contactIdRaw) : undefined
  if (!Number.isInteger(id) || id <= 0 || !(action in BUCKET)) return res.status(204).end()
  try {
    if (!(await flagsRepo.isEnabled('lettersEnabled'))) return res.status(204).end()
    const letter = await lettersRepo.getById(id)
    if (!letter || letter.status !== 'published') return res.status(204).end()
    const ip = ((req.headers['x-forwarded-for'] as string) || req.ip || '').split(',')[0].trim()
    if (throttled(`${ip}:${id}:${action}:${contactId ?? ''}`)) return res.status(204).end()
    const enforce = await flagsRepo.isEnabled('publicSendTurnstile')
    const token = typeof req.body === 'string' ? req.body : ''
    setImmediate(async () => {
      try {
        if (enforce) {
          const result = await verifyTurnstile(token, ip)
          if (result === 'rejected') return // human not confirmed → do not count
        }
        // Always roll the send into the lifetime/day buckets, same as mailto/gmail/copy, so
        // sms/whatsapp are visible in the admin letters list's totalSends. Additionally, when a
        // contactId is present, also record it into the fixed public_sms/public_whatsapp bucket
        // broken down by recipient, so the per-official breakdown survives alongside lifetime.
        await analyticsRepo.record(id, BUCKET[action])
        if (CHANNEL_ACTIONS.has(action) && contactId != null) {
          await analyticsRepo.recordChannel(id, BUCKET[action], String(contactId))
        }
        await lettersRepo.incrementActivityScore(id)
      } catch (err) {
        console.error('[public-letters] record failed:', err)
      }
    })
    res.status(204).end()
  } catch (err) {
    console.error('[public-letters] send failed:', err)
    res.status(204).end()
  }
})

export default router
