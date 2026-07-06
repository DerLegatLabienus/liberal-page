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
const BUCKET = { mailto: 'public_mailto', gmail: 'public_gmail', copy: 'public_copy' } as const
type PublicAction = keyof typeof BUCKET

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

// POST /api/public/letters/:id/send?action=mailto|gmail|copy
// No auth. Fire-and-forget: always 204; records only for a published letter when lettersEnabled.
router.post('/:id/send', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
  const id = Number(req.params.id)
  const action = String(req.query.action || '') as PublicAction
  if (!Number.isInteger(id) || id <= 0 || !(action in BUCKET)) return res.status(204).end()
  try {
    if (!(await flagsRepo.isEnabled('lettersEnabled'))) return res.status(204).end()
    const letter = await lettersRepo.getById(id)
    if (!letter || letter.status !== 'published') return res.status(204).end()
    const ip = ((req.headers['x-forwarded-for'] as string) || req.ip || '').split(',')[0].trim()
    if (throttled(`${ip}:${id}:${action}`)) return res.status(204).end()
    const enforce = await flagsRepo.isEnabled('publicSendTurnstile')
    const token = typeof req.body === 'string' ? req.body : ''
    setImmediate(async () => {
      try {
        if (enforce) {
          const result = await verifyTurnstile(token, ip)
          if (result === 'rejected') return // human not confirmed → do not count
        }
        await analyticsRepo.record(id, BUCKET[action])
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
