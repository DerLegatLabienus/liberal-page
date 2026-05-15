import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { OknessetClient } from '../services/oknesset'
import type { Bill, Committee, Mk, TrackingType } from '../../src/types'

const router = Router()
const DATA_DIR = path.join(process.cwd(), 'src/data')
const oknesset = new OknessetClient()

const FILE_MAP: Record<TrackingType, string> = {
  bill: 'bills.json',
  committee: 'committees.json',
  mk: 'mks.json',
}

router.get('/:type', async (req, res) => {
  const type = req.params.type as TrackingType
  if (!FILE_MAP[type]) return res.status(400).json({ error: 'סוג לא ידוע' })

  const filePath = path.join(DATA_DIR, FILE_MAP[type])

  let items: (Bill | Committee | Mk)[]
  try {
    const raw = await readFile(filePath, 'utf-8')
    items = JSON.parse(raw) as (Bill | Committee | Mk)[]
  } catch {
    return res.status(500).json({ error: 'שגיאה בקריאת נתונים' })
  }

  const refreshed = await Promise.all(
    items.map(async (item) => {
      if (!item.oknesset_id) return item
      try {
        if (type === 'bill') {
          const fresh = await oknesset.getBill(item.oknesset_id)
          return { ...item, title: fresh.title, lastPolledAt: new Date().toISOString() }
        }
        if (type === 'committee') {
          const fresh = await oknesset.getCommittee(item.oknesset_id)
          return {
            ...item,
            name: fresh.name,
            chair: fresh.chairperson ?? (item as Committee).chair,
            lastPolledAt: new Date().toISOString(),
          }
        }
        if (type === 'mk') {
          const fresh = await oknesset.getMk(item.oknesset_id)
          return { ...item, name: fresh.name, lastPolledAt: new Date().toISOString() }
        }
      } catch {
        // serve stale data if oknesset is unreachable
      }
      return item
    })
  )

  try {
    await writeFile(filePath, JSON.stringify(refreshed, null, 2), 'utf-8')
  } catch {
    // non-fatal — still return the data
  }

  res.json(refreshed)
})

export default router
