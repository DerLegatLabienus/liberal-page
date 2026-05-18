import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { Bill, BillSearchResult } from '../../src/types'

const router = Router()
const DATA_PATH = path.join(process.cwd(), 'src/data/bills.json')
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const CURRENT_KNESSET = 25

async function readBills(): Promise<Bill[]> {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8')
    return JSON.parse(raw as string) as Bill[]
  } catch {
    return []
  }
}

async function writeBills(bills: Bill[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(bills, null, 2), 'utf-8')
}

router.get('/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim() ?? ''
  if (q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' })

  try {
    const encoded = encodeURIComponent(q)
    const url = `${ODATA_BASE}/KNS_Bill?$filter=KnessetNum%20eq%20${CURRENT_KNESSET}%20and%20substringof('${encoded}',Name)&$top=20&$select=BillID,Name,StatusID&$format=json`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`OData error ${response.status}`)
    const data = await response.json() as { value: Array<{ BillID: number; Name: string; StatusID: number }> }

    const results: BillSearchResult[] = (data.value ?? []).map((b) => ({
      billId: b.BillID,
      name: b.Name.trim(),
      knessetUrl: '',
    }))
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', async (req, res) => {
  const { billId, name, knessetUrl } = req.body as { billId?: number; name?: string; knessetUrl?: string }
  if (!billId || !name) return res.status(400).json({ error: 'billId and name required' })

  const bills = await readBills()
  const alreadyTracked = bills.some((b) => b.knessetUrl?.includes(`hql_id=${billId}`))
  if (alreadyTracked) return res.json({ ok: true, duplicate: true })

  const nextId = Math.max(0, ...bills.map((b) => b.id)) + 1
  const newBill: Bill = {
    id: nextId,
    oknesset_id: '',
    number: String(billId),
    title: name.trim(),
    status: 'בוועדה',
    position: 'עוקבים',
    notes: '',
    committee: '',
    sourceUrl: '',
    documentUrl: null,
    hasNewData: false,
    lastPolledAt: null,
  }
  bills.push(newBill)
  await writeBills(bills)
  res.json({ ok: true, item: newBill })
})

export default router
