import { Router } from 'express'
import { verifyGoogleIdToken } from '../services/auth-service'
import { isConfigured, findActiveMeeting, createSingleUseLink } from '../services/calendly'
import { SlidingWindowLimiter } from '../services/rate-limit'

// Public endpoint (no requireAuth): external visitors verify a Google identity per request.
// No allowlist, no user row, no session — the identity is used once and discarded.
const router = Router()

let ipLimiter = new SlidingWindowLimiter(10, 60_000)
let emailLimiter = new SlidingWindowLimiter(5, 60_000)

/** Test-only: fresh limiter windows. */
export function _resetMeetingLimiters(): void {
  ipLimiter = new SlidingWindowLimiter(10, 60_000)
  emailLimiter = new SlidingWindowLimiter(5, 60_000)
}

router.post('/booking-link', async (req, res) => {
  if (!ipLimiter.allow(req.ip ?? 'unknown')) return res.status(429).json({ error: 'rate_limited' })

  const { idToken } = req.body as { idToken?: string }
  if (!idToken) return res.status(400).json({ error: 'idToken required' })

  let identity
  try {
    identity = await verifyGoogleIdToken(idToken)
  } catch {
    return res.status(401).json({ error: 'invalid Google token' })
  }

  if (!emailLimiter.allow(identity.email)) return res.status(429).json({ error: 'rate_limited' })

  if (!(await isConfigured())) return res.status(409).json({ error: 'not_configured' })

  try {
    // Live gate: Calendly is the source of truth for "one active booking per email".
    const meeting = await findActiveMeeting(identity.email)
    if (meeting) return res.status(409).json({ error: 'active_meeting', meeting })

    const bookingUrl = await createSingleUseLink()
    res.json({ bookingUrl, name: identity.name ?? '', email: identity.email })
  } catch (err) {
    console.error('[meetus] booking-link failed:', err)
    res.status(502).json({ error: 'calendly_unavailable' })
  }
})

export default router
