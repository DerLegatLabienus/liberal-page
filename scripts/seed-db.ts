import { readFile } from 'fs/promises'
import path from 'path'
import { runMigrations } from '../server/db/migrate'
import { db } from '../server/db/client'
import {
  mkVotes, mkActivity, mkRoles, mkKnessetTerms, mks as mksTable,
  committeeSessions, committees as committeesTable, bills as billsTable,
  knessetConfig, featureFlags, mkAnnotations,
  trackedBills, trackedCommittees, trackedMks, users,
} from '../server/db/schema'
import { KnessetConfigRepository } from '../server/repositories/knesset-config-repository'
import { FeatureFlagsRepository } from '../server/repositories/feature-flags-repository'
import { BillsRepository } from '../server/repositories/bills-repository'
import { CommitteesRepository } from '../server/repositories/committees-repository'
import { MksRepository } from '../server/repositories/mks-repository'
import { MkAnnotationsRepository } from '../server/repositories/mk-annotations-repository'
import { UsersRepository } from '../server/repositories/users-repository'
import { TrackedBillsRepository } from '../server/repositories/tracked-bills-repository'
import { TrackedCommitteesRepository } from '../server/repositories/tracked-committees-repository'
import { TrackedMksRepository } from '../server/repositories/tracked-mks-repository'
import type { Bill, Committee, Mk } from '../src/types'

const DATA = path.join(process.cwd(), 'scripts/seed-data')
const readJson = async <T>(f: string): Promise<T> => JSON.parse(await readFile(path.join(DATA, f), 'utf-8'))

async function main() {
  await runMigrations()

  // Idempotent reseed: clear in FK-safe order (children before parents) so re-running is safe.
  // tracking rows first (reference entities + users)
  await db.delete(trackedBills)
  await db.delete(trackedCommittees)
  await db.delete(trackedMks)
  // entity children
  await db.delete(mkVotes)
  await db.delete(mkActivity)
  await db.delete(mkRoles)
  await db.delete(mkKnessetTerms)
  await db.delete(mksTable)
  await db.delete(committeeSessions)
  await db.delete(committeesTable)
  await db.delete(billsTable)
  await db.delete(featureFlags)
  await db.delete(knessetConfig)
  await db.delete(mkAnnotations)
  // users last (referenced by tracking rows, now deleted)
  await db.delete(users)

  const cfgRaw = await readJson<{ currentKnesset: number }>('knesset-config.json')
  const currentKnesset = cfgRaw.currentKnesset
  await new KnessetConfigRepository().set(currentKnesset)

  const flagsRaw = await readJson<{ bills: { trendingAlgorithm: string; recentRanking: string; policyFilterEnabled: boolean } }>('feature-flags.json')
  const ff = new FeatureFlagsRepository()
  await ff.setFlag('trendingAlgorithm', true, flagsRaw.bills.trendingAlgorithm, 'Trending tab ranking source')
  await ff.setFlag('recentRanking', true, flagsRaw.bills.recentRanking, 'Recent tab ordering')
  await ff.setFlag('policyFilter', flagsRaw.bills.policyFilterEnabled, null, 'Policy-aligned tab toggle')

  // Create the shared user
  const sharedUserId = await new UsersRepository().getSharedUserId()

  const trackedBillsRepo = new TrackedBillsRepository()
  const trackedCommitteesRepo = new TrackedCommitteesRepository()
  const trackedMksRepo = new TrackedMksRepository()

  const bills = await readJson<Bill[]>('bills.json')
  const billsRepo = new BillsRepository()
  for (const b of bills) {
    const billId = await billsRepo.upsert({
      oknessetId: b.oknesset_id,
      number: b.number,
      title: b.title,
      status: b.status,
      committee: b.committee,
      sourceUrl: b.sourceUrl,
      documentUrl: b.documentUrl,
      knessetUrl: b.knessetUrl ?? null,
      knessetNumber: currentKnesset,
      hasNewData: b.hasNewData,
      lastPolledAt: b.lastPolledAt ? new Date(b.lastPolledAt) : null,
    })
    await trackedBillsRepo.track(sharedUserId, billId, b.position ?? 'עוקבים', b.notes ?? '')
  }

  const committees = await readJson<Committee[]>('committees.json')
  const committeesRepo = new CommitteesRepository()
  for (const c of committees) {
    const committeeId = await committeesRepo.upsert({
      oknesset_id: c.oknesset_id,
      name: c.name,
      chair: c.chair,
      lastSessionDate: c.lastSessionDate,
      lastSessionSummary: c.lastSessionSummary,
      lastSessionDocumentUrl: c.lastSessionDocumentUrl,
      sourceUrl: c.sourceUrl,
      hasNewData: c.hasNewData,
      lastPolledAt: c.lastPolledAt,
      recentSessions: c.recentSessions ?? [],
    })
    await trackedCommitteesRepo.track(sharedUserId, committeeId)
  }
  // upsert() never writes the inactive flag (so the poller can't revive a closed
  // committee); apply seeded closure status explicitly.
  const closedIds = committees.filter((c) => c.inactive).map((c) => c.oknesset_id)
  await committeesRepo.setInactiveByIds(closedIds, true)

  const mksData = await readJson<Mk[]>('mks.json')
  const mksRepo = new MksRepository()
  for (const m of mksData) {
    const mkId = await mksRepo.upsert({
      oknesset_id: m.oknesset_id,
      knesset_site_id: m.knesset_site_id,
      name: m.name,
      email: m.email ?? null,
      photoUrl: m.photoUrl ?? null,
      votingSummary: m.votingSummary,
      sourceUrl: m.sourceUrl,
      hasNewData: m.hasNewData,
      lastPolledAt: m.lastPolledAt,
      terms: [{ knessetNumber: currentKnesset, faction: m.party.trim() }],
      currentRoles: m.currentRoles ?? [],
      activity: m.activity ?? [],
      recentVotes: m.recentVotes ?? [],
    })
    await trackedMksRepo.track(sharedUserId, mkId)
  }

  const annotations = await readJson<Record<string, { isLiberal: boolean; isSupporter: boolean }>>('mk-annotations.json')
  const annRepo = new MkAnnotationsRepository()
  for (const [siteId, ann] of Object.entries(annotations)) {
    await annRepo.set(siteId, ann)
  }

  console.log(`Seeded: ${bills.length} bills, ${committees.length} committees, ${mksData.length} MKs, tracking rows: ${bills.length} tracked_bills, ${committees.length} tracked_committees, ${mksData.length} tracked_mks.`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
