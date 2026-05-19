import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { OknessetClient } from './oknesset'
import { Summarizer } from './summarizer'
import { fetchMkActivity } from './knesset-scraper'
import type { Bill, Committee, Mk } from '../../src/types'

const DATA_DIR = path.join(process.cwd(), 'src/data')
const CACHE_PATH = path.join(DATA_DIR, 'summaries-cache.json')
const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 21_600_000)
const BACKOFF_INITIAL_MS = 60_000   // 1 minute minimum on failure
const BACKOFF_MAX_MS = 600_000      // 10 minutes maximum on failure

let currentDelayMs = INTERVAL_MS

const oknesset = new OknessetClient()
const summarizer = new Summarizer(CACHE_PATH)

async function readJson<T>(filename: string): Promise<T[]> {
  const raw = await readFile(path.join(DATA_DIR, filename), 'utf-8')
  return JSON.parse(raw) as T[]
}

async function writeJson<T>(filename: string, data: T[]): Promise<void> {
  await writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8')
}

async function pollBills(): Promise<boolean> {
  const bills = await readJson<Bill>('bills.json')
  if (bills.filter((b) => b.oknesset_id).length === 0) return true

  let changed = false
  let anySuccess = false

  for (const bill of bills) {
    if (!bill.oknesset_id) continue
    try {
      const fresh = await oknesset.getBill(bill.oknesset_id)
      const newStatus = mapBillStatus(String(fresh.status ?? ''))
      if (newStatus && newStatus !== bill.status) {
        bill.status = newStatus
        bill.hasNewData = true
        changed = true
      }
      if (bill.documentUrl) {
        await summarizer.summarizeUrl(bill.documentUrl)
      }
      anySuccess = true
    } catch (err) {
      console.error(`Poller: error polling bill ${bill.oknesset_id}:`, err)
    }
    bill.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('bills.json', bills)
  return anySuccess
}

async function pollCommittees(): Promise<boolean> {
  const committees = await readJson<Committee>('committees.json')
  if (committees.filter((c) => c.oknesset_id).length === 0) return true

  let changed = false
  let anySuccess = false

  for (const committee of committees) {
    if (!committee.oknesset_id) continue
    try {
      const sessions = await oknesset.getCommitteeSessions(committee.oknesset_id, 1)
      if (sessions.length > 0) {
        const latest = sessions[0] as Record<string, unknown>
        const sessionDate = String(latest.date ?? '')
        if (sessionDate && sessionDate !== committee.lastSessionDate) {
          committee.lastSessionDate = sessionDate
          committee.hasNewData = true
          changed = true
          if (typeof latest.protocol_file === 'string') {
            committee.lastSessionDocumentUrl = latest.protocol_file
            committee.lastSessionSummary = await summarizer.summarizeUrl(latest.protocol_file)
          }
        }
      }
      anySuccess = true
    } catch (err) {
      console.error(`Poller: error polling committee ${committee.oknesset_id}:`, err)
    }
    committee.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('committees.json', committees)
  return anySuccess
}

async function pollMks(): Promise<boolean> {
  const mks = await readJson<Mk>('mks.json')
  if (mks.filter((m) => !m.inactive && m.knesset_site_id).length === 0) return true

  let changed = false
  let anySuccess = false

  for (const mk of mks) {
    if (mk.inactive) continue
    const siteId = mk.knesset_site_id ? parseInt(mk.knesset_site_id, 10) : 0
    if (!siteId) continue

    try {
      const fresh = await fetchMkActivity(siteId, 20)
      const existingUrls = new Set((mk.activity ?? []).map((a) => a.sourceUrl))
      const newItems = fresh.filter((a) => a.sourceUrl && !existingUrls.has(a.sourceUrl))

      if (newItems.length > 0) {
        mk.activity = [...newItems, ...(mk.activity ?? [])]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 20)
        mk.hasNewData = true
        changed = true
      }
      anySuccess = true
    } catch (err) {
      console.error(`Poller: error polling MK ${mk.oknesset_id}:`, err)
    }

    mk.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('mks.json', mks)
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
  const results = await Promise.allSettled([pollBills(), pollCommittees(), pollMks()])
  const anySuccess = results.some(
    (r) => r.status === 'fulfilled' && r.value === true
  )
  console.log('Poller: poll cycle complete', anySuccess ? '(success)' : '(all failed)')
  return anySuccess
}

async function runAndSchedule(): Promise<void> {
  const success = await runPollCycle()
  if (success) {
    currentDelayMs = INTERVAL_MS
  } else {
    currentDelayMs = Math.min(currentDelayMs * 2, BACKOFF_MAX_MS)
    currentDelayMs = Math.max(currentDelayMs, BACKOFF_INITIAL_MS)
    console.warn(`Poller: all polls failed — backing off ${currentDelayMs / 1000}s before next cycle`)
  }
  setTimeout(runAndSchedule, currentDelayMs)
}

export function startPoller(): void {
  runAndSchedule()
}
