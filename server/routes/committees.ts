import { Router } from 'express'
import { CommitteesRepository } from '../repositories/committees-repository'
import { TrackedCommitteesRepository } from '../repositories/tracked-committees-repository'
import { enrichCommitteeSessions } from '../services/committee-session-enricher'
import { refreshCommitteeListIfStale } from '../services/committee-list-refresh'
import { fetchCommitteeDetail } from '../services/knesset-committees'
import { requireAuth } from '../middleware/auth'
import { resolveWriteScope } from '../services/tracking-scope'

const router = Router()
const committeesRepo = new CommitteesRepository()
const trackedCommittees = new TrackedCommitteesRepository()

router.get('/list', async (_req, res) => {
  try {
    res.json(await refreshCommitteeListIfStale())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', requireAuth, async (req, res) => {
  const { committeeId, name, knessetUrl } = req.body as { committeeId?: number; name?: string; knessetUrl?: string }
  if (!committeeId || !name) return res.status(400).json({ error: 'committeeId and name required' })
  const scope = await resolveWriteScope(req)
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error })
  const userId = scope.userId
  const all = await committeesRepo.getAll()
  const entity = all.find((c) => c.oknesset_id === String(committeeId) || c.name.trim() === name.trim())
  let id: number
  const sourceUrl = knessetUrl ?? ''
  if (entity?.id) {
    id = entity.id
    // Update sourceUrl if the URL has changed (e.g. after mapping fix)
    if (sourceUrl && sourceUrl !== entity.sourceUrl) {
      await committeesRepo.upsert({
        oknesset_id: entity.oknesset_id, name: entity.name, chair: entity.chair,
        lastSessionDate: entity.lastSessionDate, lastSessionSummary: entity.lastSessionSummary,
        lastSessionDocumentUrl: entity.lastSessionDocumentUrl, sourceUrl,
        hasNewData: entity.hasNewData, lastPolledAt: entity.lastPolledAt,
        recentSessions: entity.recentSessions ?? [],
      }, id)
    }
  } else {
    id = await committeesRepo.upsert({
      oknesset_id: String(committeeId), name: name.trim(), chair: '',
      lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null,
      sourceUrl, hasNewData: false, lastPolledAt: null, recentSessions: [],
    })
  }
  const already = await trackedCommittees.isTracked(userId, id)
  await trackedCommittees.track(userId, id)

  // Enrich immediately in background — don't block the response
  const aiEnabled = process.env.COMMITTEE_AI === 'true'
  enrichCommitteeSessions(name.trim(), [], aiEnabled)
    .then(async (sessions) => {
      if (!sessions.length) return
      const c = await committeesRepo.getById(id)
      if (!c) return
      await committeesRepo.upsert({
        oknesset_id: c.oknesset_id, name: c.name, chair: c.chair,
        lastSessionDate: sessions[0].date, lastSessionSummary: c.lastSessionSummary,
        lastSessionDocumentUrl: c.lastSessionDocumentUrl, sourceUrl: c.sourceUrl,
        hasNewData: c.hasNewData, lastPolledAt: c.lastPolledAt, recentSessions: sessions,
      }, id)
    })
    .catch(() => { /* non-critical */ })

  res.json({ ok: true, duplicate: already })
})

export default router

router.get('/info/:committeeId', async (req, res) => {
  const committeeId = parseInt(req.params.committeeId, 10)
  if (!committeeId) return res.status(400).send('<h1>Invalid committee ID</h1>')

  try {
    const detail = await fetchCommitteeDetail(committeeId)
    if (!detail) return res.status(404).send('<h1>Committee not found</h1>')
    const { committee, sessions } = detail

    const sessionsHtml = sessions.map(s => {
      const date = new Date(s.StartDate).toLocaleDateString('he-IL')
      const link = s.SessionUrl?.replace('http://', 'https://') ?? ''
      return `<li>${date} — ${s.TypeDesc} (${s.StatusDesc})${link ? ` — <a href="${link}" target="_blank">צפה בישיבה ↗</a>` : ''}</li>`
    }).join('')

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
