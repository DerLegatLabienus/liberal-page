import { OknessetClient } from './oknesset'
import { Summarizer } from './summarizer'
import { fetchMkActivity } from './knesset-scraper'
import { BillsRepository } from '../repositories/bills-repository'
import { CommitteesRepository } from '../repositories/committees-repository'
import { MksRepository } from '../repositories/mks-repository'
import { getCurrentKnesset } from './knesset-config'
import { refreshCommitteeListIfStale } from './committee-list-refresh'
import { purgeOrphansIfNeeded } from './storage-manager'
import { getDatabaseSizeBytes } from '../db/size'
import { AuthRepository } from '../repositories/auth-repository'
import type { Bill, CommitteeSession } from '../../src/types'

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 21_600_000)
const BACKOFF_INITIAL_MS = 60_000   // 1 minute minimum on failure
const BACKOFF_MAX_MS = 600_000      // 10 minutes maximum on failure

let currentDelayMs = INTERVAL_MS

const oknesset = new OknessetClient()
const summarizer = new Summarizer()
const billsRepo = new BillsRepository()
const committeesRepo = new CommitteesRepository()
const mksRepo = new MksRepository()

async function pollBills(): Promise<boolean> {
  const bills = await billsRepo.getAll(getCurrentKnesset())
  if (bills.filter((b) => b.oknesset_id).length === 0) return true

  let anySuccess = false

  for (const bill of bills) {
    if (!bill.oknesset_id || !bill.id) continue
    try {
      const fresh = await oknesset.getBill(bill.oknesset_id)
      const newStatus = mapBillStatus(String(fresh.status ?? ''))
      const changed = newStatus !== null && newStatus !== bill.status
      if (bill.documentUrl) {
        await summarizer.summarizeUrl(bill.documentUrl)
      }
      // Targeted update: only mutate status/hasNewData/lastPolledAt — leaves knessetNumber intact
      await billsRepo.update(bill.id, {
        status: changed ? newStatus : (bill.status ?? null),
        hasNewData: changed ? true : (bill.hasNewData ?? false),
        lastPolledAt: new Date(),
      })
      anySuccess = true
    } catch (err) {
      console.error(`Poller: error polling bill ${bill.oknesset_id}:`, err)
    }
  }

  return anySuccess
}

async function pollCommittees(): Promise<boolean> {
  const committees = await committeesRepo.getAll()
  if (committees.filter((c) => c.oknesset_id).length === 0) return true

  let anySuccess = false

  for (const committee of committees) {
    if (!committee.oknesset_id || !committee.id) continue
    try {
      const sessions = await oknesset.getCommitteeSessions(committee.oknesset_id, 1)
      let lastSessionDate = committee.lastSessionDate
      let lastSessionDocumentUrl = committee.lastSessionDocumentUrl
      let lastSessionSummary = committee.lastSessionSummary
      let changed = false

      if (sessions.length > 0) {
        const latest = sessions[0] as Record<string, unknown>
        const sessionDate = String(latest.date ?? '')
        if (sessionDate && sessionDate !== committee.lastSessionDate) {
          lastSessionDate = sessionDate
          changed = true
          if (typeof latest.protocol_file === 'string') {
            lastSessionDocumentUrl = latest.protocol_file
            lastSessionSummary = await summarizer.summarizeUrl(latest.protocol_file)
          }
        }
      }

      await committeesRepo.upsert(
        {
          oknesset_id: committee.oknesset_id,
          name: committee.name,
          chair: committee.chair,
          lastSessionDate,
          lastSessionSummary: lastSessionSummary ?? null,
          lastSessionDocumentUrl: lastSessionDocumentUrl ?? null,
          sourceUrl: committee.sourceUrl,
          hasNewData: changed ? true : committee.hasNewData,
          lastPolledAt: new Date().toISOString(),
          recentSessions: (committee.recentSessions ?? []) as CommitteeSession[],
        },
        committee.id,
      )
      anySuccess = true
    } catch (err) {
      console.error(`Poller: error polling committee ${committee.oknesset_id}:`, err)
    }
  }

  return anySuccess
}

async function pollMks(): Promise<boolean> {
  const currentKnesset = getCurrentKnesset()
  const allMks = await mksRepo.getAll(currentKnesset)
  // Only poll MKs that are active in the current Knesset and have a site ID
  const activeMks = allMks.filter((m) => !m.inactive && m.knesset_site_id)
  if (activeMks.length === 0) return true

  let anySuccess = false

  for (const mk of activeMks) {
    if (!mk.id) continue
    const siteId = mk.knesset_site_id ? parseInt(mk.knesset_site_id, 10) : 0
    if (!siteId) continue

    try {
      const fresh = await fetchMkActivity(siteId, 20)
      const existingUrls = new Set((mk.activity ?? []).map((a) => a.sourceUrl))
      const newItems = fresh.filter((a) => a.sourceUrl && !existingUrls.has(a.sourceUrl))

      const mergedActivity = [...newItems, ...(mk.activity ?? [])]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 20)

      // Targeted update: only replaces activity rows + flags — preserves terms/roles/votes
      await mksRepo.updateActivity(
        mk.id,
        mergedActivity,
        newItems.length > 0 ? true : mk.hasNewData ?? false,
        new Date(),
      )
      anySuccess = true
    } catch (err) {
      console.error(`Poller: error polling MK ${mk.oknesset_id}:`, err)
    }
  }

  return anySuccess
}

function mapBillStatus(status: string): Bill['status'] | null {
  const map: Record<string, Bill['status']> = {
    committee: 'בוועדה',
    vote: 'הצבעה קרובה',
    passed: 'עבר',
    rejected: 'נדחה',
  }
  return map[status.toLowerCase()] ?? null
}

export async function runPollCycle(): Promise<boolean> {
  console.log('Poller: starting poll cycle', new Date().toISOString())

  // Refresh the active-committee list and reconcile closure status. Isolated so a
  // committee-list failure never aborts the entity polls below, and not counted
  // toward cycle success (it must not drive backoff).
  try {
    await refreshCommitteeListIfStale()
  } catch (err) {
    console.error('Poller: error refreshing committee list:', err)
  }

  const results = await Promise.allSettled([pollBills(), pollCommittees(), pollMks()])
  const anySuccess = results.some(
    (r) => r.status === 'fulfilled' && r.value === true
  )

  // Reclaim storage by shedding the stalest orphan entities (tracked by no one) when the
  // DB is over budget. Isolated and not counted toward cycle success/backoff.
  try {
    await purgeOrphansIfNeeded(getDatabaseSizeBytes)
  } catch (err) {
    console.error('Poller: orphan purge failed:', err)
  }

  // Delete expired refresh tokens so the table holds only currently-valid sessions.
  try {
    await new AuthRepository().deleteExpired(new Date())
  } catch (err) {
    console.error('Poller: refresh-token cleanup failed:', err)
  }

  console.log('Poller: poll cycle complete', anySuccess ? '(success)' : '(all failed)')
  return anySuccess
}

async function runAndSchedule(): Promise<void> {
  const success = await runPollCycle()
  if (success) {
    currentDelayMs = INTERVAL_MS
  } else {
    // Start from BACKOFF_INITIAL_MS when coming from normal mode; otherwise double
    if (currentDelayMs === INTERVAL_MS) {
      currentDelayMs = BACKOFF_INITIAL_MS
    } else {
      currentDelayMs = Math.min(currentDelayMs * 2, BACKOFF_MAX_MS)
    }
    console.warn(`Poller: all polls failed — backing off ${currentDelayMs / 1000}s before next cycle`)
  }
  setTimeout(runAndSchedule, currentDelayMs)
}

export function startPoller(): void {
  runAndSchedule()
}
