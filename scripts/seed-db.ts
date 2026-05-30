import { readFile } from 'fs/promises'
import path from 'path'
import { runMigrations } from '../server/db/migrate'
import { KnessetConfigRepository } from '../server/repositories/knesset-config-repository'
import { FeatureFlagsRepository } from '../server/repositories/feature-flags-repository'
import { BillsRepository } from '../server/repositories/bills-repository'
import { CommitteesRepository } from '../server/repositories/committees-repository'
import { MksRepository } from '../server/repositories/mks-repository'
import { MkAnnotationsRepository } from '../server/repositories/mk-annotations-repository'
import type { Bill, BillsFeatureFlags, Committee, Mk } from '../src/types'

const DATA = path.join(process.cwd(), 'src/data')
const readJson = async <T>(f: string): Promise<T> => JSON.parse(await readFile(path.join(DATA, f), 'utf-8'))

async function main() {
  await runMigrations()

  const cfgRaw = await readJson<{ currentKnesset: number }>('knesset-config.json')
  const currentKnesset = cfgRaw.currentKnesset
  await new KnessetConfigRepository().set(currentKnesset)

  const flagsRaw = await readJson<{ bills: BillsFeatureFlags }>('feature-flags.json')
  await new FeatureFlagsRepository().setBillsFlags(flagsRaw.bills)

  const bills = await readJson<Bill[]>('bills.json')
  const billsRepo = new BillsRepository()
  for (const b of bills) {
    await billsRepo.upsert({
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
  }

  const committees = await readJson<Committee[]>('committees.json')
  const committeesRepo = new CommitteesRepository()
  for (const c of committees) {
    await committeesRepo.upsert({
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
  }

  const mksData = await readJson<Mk[]>('mks.json')
  const mksRepo = new MksRepository()
  for (const m of mksData) {
    await mksRepo.upsert({
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
  }

  const annotations = await readJson<Record<string, { isLiberal: boolean; isSupporter: boolean }>>('mk-annotations.json')
  const annRepo = new MkAnnotationsRepository()
  for (const [siteId, ann] of Object.entries(annotations)) {
    await annRepo.set(siteId, ann)
  }

  console.log(`Seeded: ${bills.length} bills, ${committees.length} committees, ${mksData.length} MKs.`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
