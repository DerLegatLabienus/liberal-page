import { Router } from 'express'
import { getCurrentKnesset } from '../services/knesset-config'
import { fetchRecentBills, fetchPolicyAlignedBills, getTrendingBills, searchBills } from '../services/knesset-bills'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { BillsRepository } from '../repositories/bills-repository'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { requireAuth } from '../middleware/auth'
import { resolveWriteScope } from '../services/tracking-scope'

const router = Router()
const billsRepo = new BillsRepository()
const trackedBills = new TrackedBillsRepository()

router.get('/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim() ?? ''
  if (q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' })

  try {
    res.json(await searchBills(q, getCurrentKnesset()))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', requireAuth, async (req, res) => {
  const { billId, name, knessetUrl } = req.body as { billId?: number; name?: string; knessetUrl?: string }
  if (!billId || !name) return res.status(400).json({ error: 'billId and name required' })
  const scope = await resolveWriteScope(req)
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error })
  const userId = scope.userId
  const k = getCurrentKnesset()
  const existing = (await billsRepo.getAll(k)).find(
    (b) => b.number === String(billId) || b.title?.trim() === name.trim()
  )
  let id: number
  if (existing?.id) {
    id = existing.id
  } else {
    id = await billsRepo.upsert({
      oknessetId: String(billId), number: String(billId), title: name.trim(), status: 'בוועדה',
      committee: '', sourceUrl: knessetUrl ?? '', documentUrl: null, knessetUrl: knessetUrl ?? null,
      knessetNumber: k, hasNewData: false, lastPolledAt: null,
    })
  }
  if (await trackedBills.isTracked(userId, id)) return res.json({ ok: true, duplicate: true })
  await trackedBills.track(userId, id, 'עוקבים', '')
  res.json({ ok: true })
})

function parseLimit(q: unknown): number {
  const n = Number(q)
  return Number.isFinite(n) && n > 0 && n <= 50 ? Math.floor(n) : 10
}

router.get('/recent', async (req, res) => {
  try {
    const flags = await new FeatureFlagsRepository().getAll()
    const ranking = flags['recentRanking']?.value ?? 'newest'
    res.json(await fetchRecentBills(parseLimit(req.query.limit), ranking))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/trending', async (_req, res) => {
  try {
    res.json(await getTrendingBills())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/policy-aligned', async (req, res) => {
  try {
    const flags = await new FeatureFlagsRepository().getAll()
    if (!(flags['policyFilter']?.enabled)) return res.status(404).json({ error: 'Policy filter disabled' })
    res.json(await fetchPolicyAlignedBills(parseLimit(req.query.limit)))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
