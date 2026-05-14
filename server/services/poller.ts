import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { OknessetClient } from './oknesset'
import { Summarizer } from './summarizer'
import type { Bill, Committee, Mk } from '../../src/types'

const DATA_DIR = path.join(process.cwd(), 'src/data')
const CACHE_PATH = path.join(DATA_DIR, 'summaries-cache.json')
const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 21_600_000)

const oknesset = new OknessetClient()
const summarizer = new Summarizer(CACHE_PATH)

async function readJson<T>(filename: string): Promise<T[]> {
  const raw = await readFile(path.join(DATA_DIR, filename), 'utf-8')
  return JSON.parse(raw) as T[]
}

async function writeJson<T>(filename: string, data: T[]): Promise<void> {
  await writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8')
}

async function pollBills(): Promise<void> {
  const bills = await readJson<Bill>('bills.json')
  let changed = false

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
    } catch (err) {
      console.error(`Poller: error polling bill ${bill.oknesset_id}:`, err)
    }
    bill.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('bills.json', bills)
}

async function pollCommittees(): Promise<void> {
  const committees = await readJson<Committee>('committees.json')
  let changed = false

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
    } catch (err) {
      console.error(`Poller: error polling committee ${committee.oknesset_id}:`, err)
    }
    committee.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('committees.json', committees)
}

async function pollMks(): Promise<void> {
  const mks = await readJson<Mk>('mks.json')
  let changed = false

  for (const mk of mks) {
    if (!mk.oknesset_id) continue
    try {
      const votes = await oknesset.getMkVotes(mk.oknesset_id, 10)
      if (votes.length !== mk.recentVotes.length) {
        mk.recentVotes = votes.map((v) => {
          const vote = v as Record<string, unknown>
          return {
            date: String(vote.time ?? ''),
            billTitle: String(vote.bill_title ?? ''),
            vote: mapVote(String(vote.vote_type ?? '')),
          }
        })
        mk.hasNewData = true
        changed = true
      }
    } catch (err) {
      console.error(`Poller: error polling MK ${mk.oknesset_id}:`, err)
    }
    mk.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('mks.json', mks)
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

function mapVote(voteType: string): Mk['recentVotes'][number]['vote'] {
  const map: Record<string, Mk['recentVotes'][number]['vote']> = {
    for: 'בעד',
    against: 'נגד',
    abstain: 'נמנע',
    absent: 'נעדר',
  }
  return map[voteType.toLowerCase()] ?? 'נעדר'
}

async function runPollCycle(): Promise<void> {
  console.log('Poller: starting poll cycle', new Date().toISOString())
  await Promise.allSettled([pollBills(), pollCommittees(), pollMks()])
  console.log('Poller: poll cycle complete')
}

export function startPoller(): void {
  runPollCycle()
  setInterval(runPollCycle, INTERVAL_MS)
}
