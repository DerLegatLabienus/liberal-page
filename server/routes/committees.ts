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

    // Fetch all Knesset 25 current committees
    const raw = await odataFetchAll<{ CommitteeID: number; Name: string }>(
      `KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%2025&$select=CommitteeID,Name&$top=200&$format=json`
    )

    // For each committee, get the most recent session URL from OData (authoritative link)
    const BATCH = 20
    const sessionUrlMap = new Map<number, string>()
    for (let i = 0; i < raw.length; i += BATCH) {
      const batch = raw.slice(i, i + BATCH)
      const filter = batch.map((c) => `CommitteeID%20eq%20${c.CommitteeID}`).join('%20or%20')
      const sessions = await odataFetchAll<{ CommitteeID: number; SessionUrl?: string }>(
        `KNS_CommitteeSession?$filter=(${filter})&$orderby=StartDate%20desc&$top=${BATCH * 2}&$select=CommitteeID,SessionUrl&$format=json`
      )
      for (const s of sessions) {
        if (!sessionUrlMap.has(s.CommitteeID) && s.SessionUrl) {
          sessionUrlMap.set(s.CommitteeID, s.SessionUrl.replace('http://', 'https://'))
        }
      }
    }

    const committees: CommitteeListItem[] = raw.map((c) => ({
      committeeId: c.CommitteeID,
      name: c.Name.trim(),
      knessetUrl: sessionUrlMap.get(c.CommitteeID) ?? '',
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
  // Deduplicate by name AND by committeeId stored in oknesset_id
  const alreadyTracked = committees.some(
    (c) => c.oknesset_id === String(committeeId) || c.name.trim() === name.trim()
  )
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
