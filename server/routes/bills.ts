import { Router } from 'express'
import type { BillSearchResult } from '../../src/types'
import { getCurrentKnesset } from '../services/knesset-config'
import { fetchRecentBills, fetchPolicyAlignedBills, getTrendingBills, getBillsFlags } from '../services/knesset-bills'
import { UsersRepository } from '../repositories/users-repository'
import { BillsRepository } from '../repositories/bills-repository'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'

const router = Router()
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const users = new UsersRepository()
const billsRepo = new BillsRepository()
const trackedBills = new TrackedBillsRepository()

router.get('/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim() ?? ''
  if (q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' })

  try {
    const encoded = encodeURIComponent(q)
    const url = `${ODATA_BASE}/KNS_Bill?$filter=KnessetNum%20eq%20${getCurrentKnesset()}%20and%20substringof('${encoded}',Name)&$top=20&$select=BillID,Name,StatusID&$format=json`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`OData error ${response.status}`)
    const data = await response.json() as { value: Array<{ BillID: number; Name: string; StatusID: number }> }

    const results: BillSearchResult[] = (data.value ?? []).map((b) => ({
      billId: b.BillID,
      name: b.Name.trim(),
      knessetUrl: `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=${b.BillID}`,
    }))
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', async (req, res) => {
  const { billId, name, knessetUrl } = req.body as { billId?: number; name?: string; knessetUrl?: string }
  if (!billId || !name) return res.status(400).json({ error: 'billId and name required' })
  const userId = await users.getSharedUserId()
  const k = getCurrentKnesset()
  const existing = (await billsRepo.getAll(k)).find(
    (b) => b.number === String(billId) || b.title?.trim() === name.trim()
  )
  let id: number
  if (existing?.id) {
    id = existing.id
  } else {
    id = await billsRepo.upsert({
      oknessetId: '', number: String(billId), title: name.trim(), status: 'בוועדה',
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
    res.json(await fetchRecentBills(parseLimit(req.query.limit)))
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
    const flags = await getBillsFlags()
    if (!flags.policyFilterEnabled) return res.status(404).json({ error: 'Policy filter disabled' })
    res.json(await fetchPolicyAlignedBills(parseLimit(req.query.limit)))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
