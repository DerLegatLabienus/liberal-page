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

    // Step 1: fetch all Knesset 25 current committees
    const raw = await odataFetchAll<{ CommitteeID: number; Name: string }>(
      `KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%2025&$select=CommitteeID,Name&$top=200&$format=json`
    )

    // Step 2: batch-fetch site codes for only these committee IDs (avoids loading all 720 entries)
    const BATCH = 40
    const committeeIds = raw.map((c) => c.CommitteeID)
    const allSiteCodes: Array<{ KnsID: number; SiteId: number }> = []
    for (let i = 0; i < committeeIds.length; i += BATCH) {
      const batch = committeeIds.slice(i, i + BATCH)
      const filter = batch.map((id) => `KnsID%20eq%20${id}`).join('%20or%20')
      const page = await odataFetchAll<{ KnsID: number; SiteId: number }>(
        `KNS_CmtSiteCode?$filter=${filter}&$select=KnsID,SiteId&$top=100&$format=json`
      )
      allSiteCodes.push(...page)
    }

    // Build KnsID → SiteId map
    const siteIdMap = new Map(allSiteCodes.map((sc) => [sc.KnsID, sc.SiteId]))

    const committees: CommitteeListItem[] = raw.map((c) => {
      const siteId = siteIdMap.get(c.CommitteeID)
      return {
        committeeId: c.CommitteeID,
        name: c.Name.trim(),
        knessetUrl: siteId
          ? `https://main.knesset.gov.il/apps/committees/${siteId}`
          : `https://main.knesset.gov.il/apps/committees`,
      }
    })

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
  // Look up SiteId for /apps/committees/{siteId} URL format
  let sourceUrl = `https://main.knesset.gov.il/apps/committees`
  try {
    const scRes = await fetch(`${ODATA_BASE}/KNS_CmtSiteCode?$filter=KnsID%20eq%20${committeeId}&$select=SiteId&$format=json`, { headers: { Accept: 'application/json' } })
    if (scRes.ok) {
      const scData = await scRes.json() as { value: Array<{ SiteId: number }> }
      const siteId = scData.value?.[0]?.SiteId
      if (siteId) sourceUrl = `https://main.knesset.gov.il/apps/committees/${siteId}`
    }
  } catch { /* use fallback */ }
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

router.get('/info/:committeeId', async (req, res) => {
  const committeeId = parseInt(req.params.committeeId, 10)
  if (!committeeId) return res.status(400).send('<h1>Invalid committee ID</h1>')

  try {
    // Fetch committee info and recent sessions from Knesset OData
    const [committees, sessions] = await Promise.all([
      fetch(`${ODATA_BASE}/KNS_Committee?$filter=CommitteeID%20eq%20${committeeId}&$format=json`, { headers: { Accept: 'application/json' } })
        .then(r => r.json() as Promise<{ value: Array<{ CommitteeID: number; Name: string; KnessetNum: number; CommitteeTypeDesc: string; Email: string | null }> }>),
      fetch(`${ODATA_BASE}/KNS_CommitteeSession?$filter=CommitteeID%20eq%20${committeeId}&$orderby=StartDate%20desc&$top=5&$select=CommitteeSessionID,StartDate,StatusDesc,TypeDesc,SessionUrl&$format=json`, { headers: { Accept: 'application/json' } })
        .then(r => r.json() as Promise<{ value: Array<{ CommitteeSessionID: number; StartDate: string; StatusDesc: string; TypeDesc: string; SessionUrl: string }> }>),
    ])

    const committee = committees.value?.[0]
    if (!committee) return res.status(404).send('<h1>Committee not found</h1>')

    const sessionsHtml = sessions.value?.map(s => {
      const date = new Date(s.StartDate).toLocaleDateString('he-IL')
      const link = s.SessionUrl?.replace('http://', 'https://') ?? ''
      return `<li>${date} — ${s.TypeDesc} (${s.StatusDesc})${link ? ` — <a href="${link}" target="_blank">צפה בישיבה ↗</a>` : ''}</li>`
    }).join('') ?? ''

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><title>${committee.Name}</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:2rem auto;padding:1rem;direction:rtl}
h1{color:#1d4ed8}li{margin:.5rem 0}a{color:#1d4ed8}</style></head>
<body>
<h1>${committee.Name}</h1>
<p><strong>כנסת:</strong> ${committee.KnessetNum} | <strong>סוג:</strong> ${committee.CommitteeTypeDesc}${committee.Email ? ` | <strong>דוא"ל:</strong> ${committee.Email}` : ''}</p>
<h2>ישיבות אחרונות</h2>
${sessionsHtml ? `<ul>${sessionsHtml}</ul>` : '<p>אין ישיבות רשומות</p>'}
<p><small>מקור: מאגר נתוני הכנסת (OData)</small></p>
</body></html>`)
  } catch (err) {
    res.status(500).send(`<h1>Error</h1><p>${err instanceof Error ? err.message : 'Server error'}</p>`)
  }
})
