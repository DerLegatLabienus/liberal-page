import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { parseKnessetUrl, isKnessetSiteUrl } from '../services/url-parser'
import { OknessetClient } from '../services/oknesset'
import { getMkBySiteId } from '../services/knesset-api'
import type { Bill, Committee, Mk, TrackingType } from '../../src/types'

const router = Router()
const DATA_DIR = path.join(process.cwd(), 'src/data')
const oknesset = new OknessetClient()

const FILE_MAP: Record<TrackingType, string> = {
  bill: 'bills.json',
  committee: 'committees.json',
  mk: 'mks.json',
}

async function readItems<T>(type: TrackingType): Promise<T[]> {
  const raw = await readFile(path.join(DATA_DIR, FILE_MAP[type]), 'utf-8')
  return JSON.parse(raw) as T[]
}

async function writeItems<T>(type: TrackingType, items: T[]): Promise<void> {
  await writeFile(path.join(DATA_DIR, FILE_MAP[type]), JSON.stringify(items, null, 2), 'utf-8')
}

router.post('/add', async (req, res) => {
  try {
    const { url, rawId, type: rawType } = req.body as {
      url?: string
      rawId?: string
      type?: TrackingType
    }

    let parsed = url ? parseKnessetUrl(url) : null
    if (!parsed && rawId && rawType) parsed = { type: rawType, id: rawId }
    if (!parsed) return res.status(400).json({ error: 'הקישור אינו נתמך' })

    const { type, id } = parsed

    if (type === 'bill') {
      const data = await oknesset.getBill(id)
      const items = await readItems<Bill>('bill')
      const nextId = Math.max(0, ...items.map((i) => i.id)) + 1
      const newItem: Bill = {
        id: nextId,
        oknesset_id: id,
        number: String(data.law_id ?? ''),
        title: data.title,
        status: 'בוועדה',
        position: 'עוקבים',
        notes: '',
        committee: data.committee ?? '',
        sourceUrl: url ?? '',
        documentUrl: null,
        hasNewData: false,
        lastPolledAt: null,
      }
      items.push(newItem)
      await writeItems('bill', items)
      return res.json({ ok: true, item: newItem })
    }

    if (type === 'committee') {
      const data = await oknesset.getCommittee(id)
      const items = await readItems<Committee>('committee')
      const nextId = Math.max(0, ...items.map((i) => i.id)) + 1
      const newItem: Committee = {
        id: nextId,
        oknesset_id: id,
        name: data.name,
        chair: data.chairperson ?? '',
        lastSessionDate: null,
        lastSessionSummary: null,
        lastSessionDocumentUrl: null,
        sourceUrl: url ?? '',
        hasNewData: false,
        lastPolledAt: null,
      }
      items.push(newItem)
      await writeItems('committee', items)
      return res.json({ ok: true, item: newItem })
    }

    if (type === 'mk') {
      const items = await readItems<Mk>('mk')
      const nextId = Math.max(0, ...items.map((i) => i.id)) + 1
      let newItem: Mk

      // knesset.gov.il MK URLs use a SiteId — resolve via Knesset OData API
      if (url && isKnessetSiteUrl(url)) {
        const siteId = parseInt(id, 10)
        const data = await getMkBySiteId(siteId)
        newItem = {
          id: nextId,
          oknesset_id: String(data.knsId),
          name: data.name,
          party: data.faction ?? 'ליכוד',
          recentVotes: [],
          votingSummary: null,
          sourceUrl: url,
          hasNewData: false,
          lastPolledAt: null,
        }
      } else {
        // oknesset.org MK URL — use oknesset API
        const data = await oknesset.getMk(id)
        newItem = {
          id: nextId,
          oknesset_id: id,
          name: data.name,
          party: data.party ?? 'ליכוד',
          recentVotes: [],
          votingSummary: null,
          sourceUrl: url ?? '',
          hasNewData: false,
          lastPolledAt: null,
        }
      }

      items.push(newItem)
      await writeItems('mk', items)
      return res.json({ ok: true, item: newItem })
    }

    return res.status(400).json({ error: 'סוג לא ידוע' })
  } catch (err) {
    console.error('tracking/add error:', err)
    res.status(500).json({ error: 'שגיאת שרת' })
  }
})

router.delete('/:type/:id', async (req, res) => {
  try {
    const type = req.params.type as TrackingType
    if (!FILE_MAP[type]) return res.status(400).json({ error: 'סוג לא ידוע' })
    const id = Number(req.params.id)
    const items = await readItems<{ id: number }>(type)
    const filtered = items.filter((i) => i.id !== id)
    await writeItems(type, filtered)
    res.json({ ok: true })
  } catch (err) {
    console.error('tracking/delete error:', err)
    res.status(500).json({ error: 'שגיאת שרת' })
  }
})

export default router
