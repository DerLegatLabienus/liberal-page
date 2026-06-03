import { Router } from 'express'
import { parseKnessetUrl, isKnessetSiteUrl } from '../services/url-parser'
import { OknessetClient } from '../services/oknesset'
import { getMkBySiteId } from '../services/knesset-api'
import { fetchMkActivity } from '../services/knesset-scraper'
import { BillsRepository } from '../repositories/bills-repository'
import { CommitteesRepository } from '../repositories/committees-repository'
import { MksRepository } from '../repositories/mks-repository'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { TrackedCommitteesRepository } from '../repositories/tracked-committees-repository'
import { TrackedMksRepository } from '../repositories/tracked-mks-repository'
import { getCurrentKnesset } from '../services/knesset-config'
import { requireAuth } from '../middleware/auth'
import { resolveWriteScope } from '../services/tracking-scope'
import type { TrackingType } from '../../src/types'

const router = Router()
const oknesset = new OknessetClient()
const billsRepo = new BillsRepository()
const committeesRepo = new CommitteesRepository()
const mksRepo = new MksRepository()
const trackedBills = new TrackedBillsRepository()
const trackedCommittees = new TrackedCommitteesRepository()
const trackedMks = new TrackedMksRepository()

router.post('/add', requireAuth, async (req, res) => {
  try {
    const { url, rawId, type: rawType } = req.body as {
      url?: string
      rawId?: string
      type?: TrackingType
    }

    let parsed = url ? parseKnessetUrl(url) : null
    if (!parsed && rawId && rawType) parsed = { type: rawType, id: rawId }
    if (!parsed) return res.status(400).json({ error: 'הקישור אינו נתמך' })

    const scope = await resolveWriteScope(req)
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error })
    const userId = scope.userId

    const { type, id } = parsed

    if (type === 'bill') {
      const data = await oknesset.getBill(id)
      const k = getCurrentKnesset()
      const existingBill = (await billsRepo.getAll(k)).find((b) => b.oknesset_id === id)
      const billId = existingBill?.id ?? await billsRepo.upsert({
        oknessetId: id,
        number: String(data.law_id ?? ''),
        title: data.title,
        status: 'בוועדה',
        committee: data.committee ?? '',
        sourceUrl: url ?? '',
        documentUrl: null,
        knessetUrl: null,
        knessetNumber: k,
        hasNewData: false,
        lastPolledAt: null,
      })
      await trackedBills.track(userId, billId, 'עוקבים', '')
      return res.json({ ok: true })
    }

    if (type === 'committee') {
      const data = await oknesset.getCommittee(id)
      const existingCommittee = (await committeesRepo.getAll()).find((c) => c.oknesset_id === id)
      const committeeId = existingCommittee?.id ?? await committeesRepo.upsert({
        oknesset_id: id,
        name: data.name,
        chair: data.chairperson ?? '',
        lastSessionDate: null,
        lastSessionSummary: null,
        lastSessionDocumentUrl: null,
        sourceUrl: url ?? '',
        hasNewData: false,
        lastPolledAt: null,
        recentSessions: [],
      })
      await trackedCommittees.track(userId, committeeId)
      return res.json({ ok: true })
    }

    if (type === 'mk') {
      let mkInput

      if (url && isKnessetSiteUrl(url)) {
        const siteId = parseInt(id, 10)
        const identity = await getMkBySiteId(siteId)
        const activity = await fetchMkActivity(siteId, 10).catch(() => [])
        mkInput = {
          oknesset_id: String(identity.knsId),
          knesset_site_id: id,
          name: identity.name,
          email: identity.email ?? null,
          photoUrl: `https://main.knesset.gov.il/mk/members/${id}/photo`,
          votingSummary: null as string | null,
          sourceUrl: url,
          hasNewData: false,
          lastPolledAt: new Date().toISOString(),
          terms: [{ knessetNumber: getCurrentKnesset(), faction: identity.faction ?? '' }],
          currentRoles: identity.positions.map((p) => ({
            positionId: p.positionId,
            description: 'חבר כנסת',
            isCurrent: p.isCurrent,
            startDate: p.startDate,
          })),
          activity,
          recentVotes: [] as [],
        }
      } else {
        const data = await oknesset.getMk(id)
        mkInput = {
          oknesset_id: id,
          knesset_site_id: undefined as string | undefined,
          name: data.name,
          email: null as string | null,
          photoUrl: null as string | null,
          votingSummary: null as string | null,
          sourceUrl: url ?? '',
          hasNewData: false,
          lastPolledAt: null as string | null,
          terms: [{ knessetNumber: getCurrentKnesset(), faction: data.party ?? '' }],
          currentRoles: [] as [],
          activity: [] as [],
          recentVotes: [] as [],
        }
      }

      const allMks = await mksRepo.getAll(getCurrentKnesset())
      const existingMk = allMks.find((m) =>
        (mkInput.knesset_site_id && m.knesset_site_id === mkInput.knesset_site_id) ||
        m.oknesset_id === mkInput.oknesset_id
      )
      const mkId = existingMk?.id ?? await mksRepo.upsert(mkInput)
      await trackedMks.track(userId, mkId)
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: 'סוג לא ידוע' })
  } catch (err) {
    console.error('tracking/add error:', err)
    res.status(500).json({ error: 'שגיאת שרת' })
  }
})

router.delete('/:type/:id', requireAuth, async (req, res) => {
  try {
    const type = req.params.type as TrackingType
    const scope = await resolveWriteScope(req)
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error })
    const userId = scope.userId
    const entityId = Number(req.params.id)
    if (type === 'bill') await trackedBills.untrack(userId, entityId)
    else if (type === 'committee') await trackedCommittees.untrack(userId, entityId)
    else if (type === 'mk') await trackedMks.untrack(userId, entityId)
    else return res.status(400).json({ error: 'סוג לא ידוע' })
    res.json({ ok: true })
  } catch (err) {
    console.error('tracking/delete error:', err)
    res.status(500).json({ error: 'שגיאת שרת' })
  }
})

export default router
