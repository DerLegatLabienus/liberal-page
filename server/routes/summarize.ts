import { Router } from 'express'
import { Summarizer } from '../services/summarizer'
import { assertAllowedDocumentUrl, UrlNotAllowedError } from '../services/url-guard'
import { SlidingWindowLimiter } from '../services/rate-limit'
import { requireAuth } from '../middleware/auth'

const router = Router()
const summarizer = new Summarizer()

let ipLimiter = new SlidingWindowLimiter(10, 60_000)
/** Test-only: fresh limiter window. */
export function _resetSummarizeLimiter(): void { ipLimiter = new SlidingWindowLimiter(10, 60_000) }

// Locked down: members only (the endpoint has no public/UI caller), per-IP rate limited, and
// the URL is SSRF-validated before the server fetches it.
router.post('/', requireAuth, async (req, res) => {
  if (!ipLimiter.allow(req.ip ?? 'unknown')) return res.status(429).json({ error: 'rate_limited' })

  const { url } = req.body as { url?: string }
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url נדרש' })

  // Reject disallowed/SSRF URLs up front so we can return 400 (vs. 422 for "couldn't summarize").
  try {
    await assertAllowedDocumentUrl(url)
  } catch (err) {
    if (err instanceof UrlNotAllowedError) {
      console.warn('[summarize] rejected url=%s ip=%s reason=%s', url, req.ip, err.reason)
      return res.status(400).json({ error: 'כתובת לא מורשית' })
    }
    console.error('[summarize] url validation error url=%s', url, err)
    return res.status(400).json({ error: 'כתובת לא תקינה' })
  }

  console.info('[summarize] request user=%s ip=%s url=%s', req.user?.id, req.ip, url)
  try {
    const summary = await summarizer.summarizeUrl(url)
    if (!summary) return res.status(422).json({ error: 'לא ניתן לסכם את הקובץ' })
    res.json({ summary })
  } catch (err) {
    // ANTHROPIC_API_KEY unset → SDK throws; surface as 503 (config), everything else 500.
    const msg = String(err)
    if (msg.includes('ANTHROPIC_API_KEY') || msg.includes('apiKey')) {
      return res.status(503).json({ error: 'שירות הסיכום אינו זמין' })
    }
    console.error('[summarize] error url=%s', url, err)
    res.status(500).json({ error: 'שגיאת שרת' })
  }
})

export default router
