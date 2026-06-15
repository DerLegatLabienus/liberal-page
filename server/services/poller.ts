import { Summarizer } from './summarizer'
import { fetchMkActivity } from './knesset-scraper'
import { fetchBillStatusById, knessetBillUrl } from './knesset-bills'
import { BillsRepository } from '../repositories/bills-repository'
import { CommitteesRepository } from '../repositories/committees-repository'
import { MksRepository } from '../repositories/mks-repository'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { renderFragment } from './email-render'
import { sendEmailsBatch, type SendArgs } from './email'
import { getCurrentKnesset, detectKnessetTransition } from './knesset-config'
import { refreshCommitteeListIfStale } from './committee-list-refresh'
import { enrichCommitteeSessions } from './committee-session-enricher'
import { relieveStoragePressureIfNeeded } from './storage-manager'
import { pollDeliveryStatus } from './email-delivery-poll'
import { notifyPinnedLetters } from './letter-notifier'
import { getDatabaseSizeBytes } from '../db/size'
import { AuthRepository } from '../repositories/auth-repository'
import type { CommitteeSession } from '../../src/types'

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 21_600_000)
const BACKOFF_INITIAL_MS = 60_000   // 1 minute minimum on failure
const BACKOFF_MAX_MS = 600_000      // 10 minutes maximum on failure

let currentDelayMs = INTERVAL_MS

const summarizer = new Summarizer()
const billsRepo = new BillsRepository()
const committeesRepo = new CommitteesRepository()
const mksRepo = new MksRepository()
const trackedBillsRepo = new TrackedBillsRepository()

export interface BillChange { billId: number; title: string; oldStatus: string | null; newStatus: string; knessetUrl: string }

/** Build and send one grouped digest per member tracking any of the changed bills. */
export async function sendBillAlerts(changes: BillChange[]): Promise<void> {
  if (changes.length === 0) return
  const recipients = await trackedBillsRepo.findAlertRecipients(changes.map((c) => c.billId))
  if (recipients.length === 0) return

  const changeById = new Map(changes.map((c) => [c.billId, c]))
  const byUser = new Map<number, { email: string; name: string | null; bills: BillChange[] }>()
  for (const r of recipients) {
    const change = changeById.get(r.billId)
    if (!change) continue
    const group = byUser.get(r.userId) ?? { email: r.email, name: r.name, bills: [] }
    group.bills.push(change)
    byUser.set(r.userId, group)
  }

  const messages: SendArgs[] = []
  for (const group of byUser.values()) {
    const items = await Promise.all(
      group.bills.map((b) => renderFragment('bill_digest_item', {
        title: b.title, oldStatus: b.oldStatus ?? '', newStatus: b.newStatus, knessetUrl: b.knessetUrl,
      })),
    )
    messages.push({
      to: group.email,
      template: 'bill_digest',
      params: { name: group.name ?? '', count: String(group.bills.length), bills: items.join('') },
      raw: ['bills'],
    })
  }
  await sendEmailsBatch(messages)
}

async function pollBills(): Promise<boolean> {
  const bills = await billsRepo.getAll(getCurrentKnesset())
  if (bills.filter((b) => b.oknesset_id).length === 0) return true

  let anySuccess = false
  const changes: BillChange[] = []

  for (const bill of bills) {
    if (!bill.oknesset_id || !bill.id) continue
    try {
      // Status comes from Knesset OData by BillID (a bill's oknesset_id is a Knesset
      // BillID). NOT oknesset.org — that's a different ID space and returns an HTML page
      // for these ids, which broke res.json().
      const newStatus = await fetchBillStatusById(Number(bill.oknesset_id))
      const changed = newStatus !== null && newStatus !== bill.status
      if (changed) {
        changes.push({
          billId: bill.id, title: bill.title ?? '', oldStatus: bill.status ?? null,
          newStatus: newStatus as string,
          // knessetUrl column is often null; build from the BillID (oknesset_id) as fallback.
          knessetUrl: bill.knessetUrl || knessetBillUrl(Number(bill.oknesset_id)),
        })
      }
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

  try {
    await sendBillAlerts(changes)
  } catch (err) {
    console.error('Poller: bill alert dispatch failed:', err)
  }

  return anySuccess
}

async function pollCommittees(): Promise<boolean> {
  const committees = await committeesRepo.getAll()
  if (committees.filter((c) => c.oknesset_id).length === 0) return true

  let anySuccess = false

  const aiEnabled = process.env.COMMITTEE_AI === 'true'

  for (const committee of committees) {
    if (!committee.oknesset_id || !committee.id) continue
    try {
      // Refresh sessions from Knesset OData (resolves by committee name), the same source
      // used at track time. NOT oknesset.org — a committee's oknesset_id is a Knesset
      // CommitteeID, a different ID space, and oknesset.org returns an HTML page for it.
      const sessions = await enrichCommitteeSessions(committee.name, [], aiEnabled)
      const latest = sessions[0]
      const changed = !!latest && latest.date !== committee.lastSessionDate

      await committeesRepo.upsert(
        {
          oknesset_id: committee.oknesset_id,
          name: committee.name,
          chair: committee.chair,
          lastSessionDate: latest ? latest.date : committee.lastSessionDate,
          lastSessionSummary: committee.lastSessionSummary ?? null,
          lastSessionDocumentUrl: committee.lastSessionDocumentUrl ?? null,
          sourceUrl: committee.sourceUrl,
          hasNewData: changed ? true : committee.hasNewData,
          lastPolledAt: new Date().toISOString(),
          recentSessions: sessions.length ? sessions : ((committee.recentSessions ?? []) as CommitteeSession[]),
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

export async function runPollCycle(): Promise<boolean> {
  console.log('Poller: starting poll cycle', new Date().toISOString())

  // Check for Knesset transition before entity polls so getCurrentKnesset() reflects the
  // new number in the same cycle. Isolated — a failed check never aborts entity polls.
  try {
    const transitioned = await detectKnessetTransition()
    if (transitioned) console.log('Poller: Knesset transition detected and applied')
  } catch (err) {
    console.error('Poller: Knesset transition check failed:', err)
  }

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
    await relieveStoragePressureIfNeeded(getDatabaseSizeBytes)
  } catch (err) {
    console.error('Poller: orphan purge failed:', err)
  }

  // Notify members of newly pinned letters. Isolated; best-effort.
  try {
    await notifyPinnedLetters()
  } catch (err) {
    console.error('Poller: letter pin notification failed:', err)
  }

  // Pull Resend delivery status for in-flight emails (log on change). Isolated; best-effort.
  try {
    await pollDeliveryStatus()
  } catch (err) {
    console.error('Poller: email delivery-status poll failed:', err)
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
