import { BillsRepository } from '../repositories/bills-repository'
import { CommitteesRepository } from '../repositories/committees-repository'
import { MksRepository } from '../repositories/mks-repository'
import { SummariesRepository } from '../repositories/summaries-repository'

const billsRepo = new BillsRepository()
const committeesRepo = new CommitteesRepository()
const mksRepo = new MksRepository()
const summariesRepo = new SummariesRepository()

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
}

const ZERO: PurgeResult = { purged: { bills: 0, committees: 0, mks: 0 }, summariesDeleted: 0 }

/**
 * When the database is over budget, delete at most ORPHAN_PURGE_BATCH (default 5) of the
 * stalest orphan entities — those tracked by no user — plus their children, and an orphaned
 * committee's session summary. Preserves everything tracked and all other orphans; the next
 * poll cycle sheds another batch only if still over budget. No-op unless STORAGE_LIMIT_MB is
 * set and the (real) measured size exceeds LIMIT − SLACK.
 */
export async function purgeOrphansIfNeeded(
  usedBytes: () => Promise<number | null>,
): Promise<PurgeResult> {
  const limitMb = num('STORAGE_LIMIT_MB')
  if (limitMb === undefined) return ZERO // feature disabled (opt-in)

  const used = await usedBytes()
  if (used === null) return ZERO // size unknown → skip, never block

  const slackMb = num('STORAGE_SLACK_MB') ?? 2
  const targetBytes = (limitMb - slackMb) * 1024 * 1024
  if (used <= targetBytes) return ZERO // have slack

  const batchSize = num('ORPHAN_PURGE_BATCH') ?? 5

  const candidates: Candidate[] = [
    ...(await billsRepo.findUntracked()).map((o) => ({ type: 'bill' as const, ...o })),
    ...(await committeesRepo.findUntracked()).map((o) => ({ type: 'committee' as const, ...o })),
    ...(await mksRepo.findUntracked()).map((o) => ({ type: 'mk' as const, ...o })),
  ]

  // Stalest first: oldest lastPolledAt (null = never polled = oldest), tie-break id asc.
  const ts = (d: Date | null) => (d ? d.getTime() : 0)
  candidates.sort((a, b) => ts(a.lastPolledAt) - ts(b.lastPolledAt) || a.id - b.id)

  const result: PurgeResult = { purged: { bills: 0, committees: 0, mks: 0 }, summariesDeleted: 0 }

  for (const c of candidates.slice(0, batchSize)) {
    if (c.type === 'bill') {
      await billsRepo.deleteCascade(c.id)
      result.purged.bills++
    } else if (c.type === 'committee') {
      const removed = await summariesRepo.deleteBySourceUrl(c.documentUrl)
      result.summariesDeleted += removed
      await committeesRepo.deleteCascade(c.id)
      result.purged.committees++
    } else {
      await mksRepo.deleteCascade(c.id)
      result.purged.mks++
    }
    console.log(`Storage GC: purged orphan ${c.type} ${c.id} (stalest-first, over budget)`)
  }

  return result
}
