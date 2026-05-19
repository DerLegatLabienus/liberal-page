import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { Committee, CommitteeListItem } from '../../src/types'
import { CommitteeListRepository } from '../repositories/committee-list-repository'

const router = Router()
const DATA_PATH = path.join(process.cwd(), 'src/data/committees.json')
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const repo = new CommitteeListRepository()

async function odataFetchAll<T>(startPath: string): Promise<T[]> {
  const results: T[] = []
  let nextPath: string | null = startPath
  while (nextPath) {
    const res = await fetch(`${ODATA_BASE}/${nextPath}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`OData error ${res.status}`)
    const data = await res.json() as { value?: T[]; 'odata.nextLink'?: string }
    results.push(...(data.value ?? []))
    nextPath = data['odata.nextLink'] ?? null
  }
  return results
}

async function readCommittees(): Promise<Committee[]> {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8')
    return JSON.parse(raw as string) as Committee[]
  } catch { return [] }
}

router.get('/list', async (_req, res) => {
  try {
    const cached = await repo.get()
    if (cached && repo.getAgeMs() < CACHE_TTL_MS) return res.json(cached)

    // Fetch committees and site code mappings in parallel
    const [raw, siteCodes] = await Promise.all([
      odataFetchAll<{ CommitteeID: number; Name: string }>(
        `KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%2025&$select=CommitteeID,Name&$top=200&$format=json`
      ),
      odataFetchAll<{ KnsID: number; SiteId: number }>(
        `KNS_CmtSiteCode?$select=KnsID,SiteId&$top=500&$format=json`
      ),
    ])

    // Build KnsID → SiteId map
    const siteIdMap = new Map(siteCodes.map((sc) => [sc.KnsID, sc.SiteId]))

    const committees: CommitteeListItem[] = raw
      .filter((c) => siteIdMap.has(c.CommitteeID))
      .map((c) => ({
        committeeId: c.CommitteeID,
        name: c.Name.trim(),
        knessetUrl: `https://main.knesset.gov.il/apps/committees/${siteIdMap.get(c.CommitteeID)}`,
      }))

    await repo.set(committees)
    res.json(committees)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', async (req, res) => {
  const { committeeId, name, knessetUrl } = req.body as { committeeId?: number; name?: string; knessetUrl?: string }
  if (!committeeId || !name) return res.status(400).json({ error: 'committeeId and name required' })
  const committees = await readCommittees()
  const alreadyTracked = committees.some((c) => c.oknesset_id === String(committeeId))
  if (alreadyTracked) return res.json({ ok: true, duplicate: true })
  const sourceUrl = knessetUrl ?? ''
  const nextId = Math.max(0, ...committees.map((c) => c.id)) + 1
  const newCommittee: Committee = {
    id: nextId, oknesset_id: '', name: name.trim(),
    chair: '', lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null,
    sourceUrl, hasNewData: false, lastPolledAt: null,
  }
  committees.push(newCommittee)
  await writeFile(DATA_PATH, JSON.stringify(committees, null, 2), 'utf-8')
  res.json({ ok: true, item: newCommittee })
})

export default router
