import { Router } from 'express'
import { JoinAnalyticsRepository } from '../repositories/join-analytics-repository'

const router = Router()
const repo = new JoinAnalyticsRepository()

// Record a Join-section click-through. Fire-and-forget from the client; the join flow
// never depends on the response. No GET route — data is DB-only for now (backlog #16).
router.post('/join', async (req, res) => {
  const { status, mode } = req.body as { status?: string; mode?: string }
  try {
    const ok = await repo.record(String(status), String(mode))
    if (!ok) return res.status(400).json({ error: 'invalid status or mode' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
