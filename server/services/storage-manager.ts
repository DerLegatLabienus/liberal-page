import { BillsRepository } from '../repositories/bills-repository'
import { CommitteesRepository } from '../repositories/committees-repository'
import { MksRepository } from '../repositories/mks-repository'
import { SummariesRepository } from '../repositories/summaries-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { SentEmailsRepository } from '../repositories/sent-emails-repository'

const billsRepo = new BillsRepository()
const committeesRepo = new CommitteesRepository()
const mksRepo = new MksRepository()
const summariesRepo = new SummariesRepository()
const flagsRepo = new FeatureFlagsRepository()
const sentEmailsRepo = new SentEmailsRepository()

// Config lives in the `storagePressure` feature flag (on by default), value = "limitMb:slackMb"
// (e.g. "450:2"); value "-1" disables. When the flag row is absent, the default keeps the
// feature on so activation needs no env var or re-seed.
export const STORAGE_FLAG = 'storagePressure'
const DEFAULT_PRESSURE = '450:2'

interface PressureConfig { limitMb: number; slackMb: number }

export function parsePressureValue(value: string | null | undefined): PressureConfig | null {
  const raw = (value ?? DEFAULT_PRESSURE).trim()
  if (raw === '-1') return null // disabled
  const [limitStr, slackStr] = raw.split(':')
  const limitMb = Number(limitStr)
  const slackMb = slackStr === undefined || slackStr === '' ? 2 : Number(slackStr)
  if (!Number.isFinite(limitMb) || limitMb <= 0) return null
  if (!Number.isFinite(slackMb) || slackMb < 0) return null
  return { limitMb, slackMb }
}

type OrphanType = 'bill' | 'committee' | 'mk'
interface Candidate {
  type: OrphanType
  id: number
  lastPolledAt: Date | null
  documentUrl?: string | null
}

function num(name: string): number | undefined {
  const v = process.env[name]
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export interface PurgeResult {
  purged: { bills: number; committees: number; mks: number }
  summariesDeleted: number
  sentEmailsDeleted: number
}

const ZERO: PurgeResult = { purged: { bills: 0, committees: 0, mks: 0 }, summariesDeleted: 0, sentEmailsDeleted: 0 }

type Reclaimer = { name: string; reclaim: (result: PurgeResult) => Promise<number> }

/** Reclaimer 1: trim the oldest sent_emails ledger rows (pure audit data → shed first). */
async function reclaimSentEmails(result: PurgeResult): Promise<number> {
  const batch = num('SENT_EMAIL_PURGE_BATCH') ?? 500
  const deleted = await sentEmailsRepo.deleteOldest(batch)
  result.sentEmailsDeleted += deleted
  if (deleted > 0) console.log(`Storage GC: trimmed ${deleted} sent_emails rows (over budget)`)
  return deleted
}

/** Reclaimer 2: delete the stalest orphan entities (tracked by no one) + their children. */
async function reclaimOrphanEntities(result: PurgeResult): Promise<number> {
  const batchSize = num('ORPHAN_PURGE_BATCH') ?? 5
  const candidates: Candidate[] = [
    ...(await billsRepo.findUntracked()).map((o) => ({ type: 'bill' as const, ...o })),
    ...(await committeesRepo.findUntracked()).map((o) => ({ type: 'committee' as const, ...o })),
    ...(await mksRepo.findUntracked()).map((o) => ({ type: 'mk' as const, ...o })),
  ]
  const ts = (d: Date | null) => (d ? d.getTime() : 0)
  candidates.sort((a, b) => ts(a.lastPolledAt) - ts(b.lastPolledAt) || a.id - b.id)

  let freed = 0
  for (const c of candidates.slice(0, batchSize)) {
    if (c.type === 'bill') {
      await billsRepo.deleteCascade(c.id)
      result.purged.bills++
    } else if (c.type === 'committee') {
      result.summariesDeleted += await summariesRepo.deleteBySourceUrl(c.documentUrl)
      await committeesRepo.deleteCascade(c.id)
      result.purged.committees++
    } else {
      await mksRepo.deleteCascade(c.id)
      result.purged.mks++
    }
    freed++
    console.log(`Storage GC: purged orphan ${c.type} ${c.id} (stalest-first, over budget)`)
  }
  return freed
}

const RECLAIMERS: Reclaimer[] = [
  { name: 'sent_emails', reclaim: reclaimSentEmails },
  { name: 'orphan_entities', reclaim: reclaimOrphanEntities },
]

/**
 * When the database is over budget, run reclaimers cheapest-first, re-measuring between each
 * and stopping once back under budget. One batch per reclaimer per call; recovers gradually
 * across poll cycles. No-op when the storagePressure flag disables it or size is unknown.
 */
export async function relieveStoragePressureIfNeeded(
  usedBytes: () => Promise<number | null>,
): Promise<PurgeResult> {
  const flags = await flagsRepo.getAll()
  const cfg = parsePressureValue(flags[STORAGE_FLAG]?.value)
  if (cfg === null) return ZERO

  let used = await usedBytes()
  if (used === null) return ZERO

  const targetBytes = (cfg.limitMb - cfg.slackMb) * 1024 * 1024
  if (used <= targetBytes) return ZERO

  const result: PurgeResult = { purged: { bills: 0, committees: 0, mks: 0 }, summariesDeleted: 0, sentEmailsDeleted: 0 }
  for (const r of RECLAIMERS) {
    const freed = await r.reclaim(result)
    if (freed > 0) used = await usedBytes()
    if (used !== null && used <= targetBytes) break
  }
  return result
}
