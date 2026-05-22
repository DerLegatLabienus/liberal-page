import { Router } from 'express'
import { readFile } from 'fs/promises'
import path from 'path'
import type { Bill, Committee, Mk, TrackingType } from '../../src/types'

const router = Router()
const DATA_DIR = path.join(process.cwd(), 'src/data')

const FILE_MAP: Record<TrackingType, string> = {
  bill: 'bills.json',
  committee: 'committees.json',
  mk: 'mks.json',
}

router.get('/:type', async (req, res) => {
  const type = req.params.type as TrackingType
  if (!FILE_MAP[type]) return res.status(400).json({ error: 'סוג לא ידוע' })

  try {
    const raw = await readFile(path.join(DATA_DIR, FILE_MAP[type]), 'utf-8')
    const items = JSON.parse(raw) as (Bill | Committee | Mk)[]
    // Serve directly from file — oknesset.org is defunct.
    // All enrichment happens via the background poller (Knesset OData + scraper).
    res.json(items)
  } catch {
    res.status(500).json({ error: 'שגיאה בקריאת נתונים' })
  }
})

export default router
