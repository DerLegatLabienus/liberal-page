import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import {
  bills, committees, committeeSessions, mks, mkActivity,
  users, trackedBills, trackedCommittees, trackedMks,
  summariesCache, knessetMembersCache, featureFlags,
} from '../../server/db/schema'
import { purgeOrphansIfNeeded, STORAGE_FLAG } from '../../server/services/storage-manager'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

const flagsRepo = new FeatureFlagsRepository()
const OVER = async () => 100 * 1024 * 1024   // 100 MB
const UNDER = async () => 1 * 1024 * 1024     // 1 MB
const HUGE = async () => 500 * 1024 * 1024    // 500 MB (over the default 450 cap)

let userId: number

/** Set the storagePressure flag value ('limit:slack' or '-1'); null = remove (absent). */
async function setPressure(value: string | null) {
  if (value === null) { await db.delete(featureFlags); return }
  await flagsRepo.setFlag(STORAGE_FLAG, true, value, 'storage pressure config')
}

async function addBill(num: string, tracked: boolean, polled: Date | null) {
  const [b] = await db.insert(bills).values({
    number: num, title: `bill ${num}`, status: 'בוועדה', sourceUrl: `https://x/${num}`,
    knessetNumber: 25, lastPolledAt: polled,
  }).returning({ id: bills.id })
  if (tracked) await db.insert(trackedBills).values({ userId, billId: b.id, createdAt: new Date() })
  return b.id
}

async function addCommittee(name: string, tracked: boolean, polled: Date | null, documentUrl: string | null) {
  const [c] = await db.insert(committees).values({
    name, sourceUrl: `https://c/${name}`, lastSessionDocumentUrl: documentUrl, lastPolledAt: polled,
  }).returning({ id: committees.id })
  await db.insert(committeeSessions).values({
    sessionId: Math.floor(Math.random() * 1e9), committeeId: c.id, date: new Date(),
    knessetNum: 25, title: 'session', sessionUrl: 'https://s',
  })
  if (tracked) await db.insert(trackedCommittees).values({ userId, committeeId: c.id, createdAt: new Date() })
  return c.id
}

async function addMk(name: string, tracked: boolean, polled: Date | null) {
  const [m] = await db.insert(mks).values({
    name, sourceUrl: `https://m/${name}`, votingSummary: null, lastPolledAt: polled,
  }).returning({ id: mks.id })
  await db.insert(mkActivity).values({ mkId: m.id, type: 'vote', date: new Date(), title: 'act' })
  if (tracked) await db.insert(trackedMks).values({ userId, mkId: m.id, createdAt: new Date() })
  return m.id
}

describe('purgeOrphansIfNeeded', () => {
  beforeAll(async () => {
    await setupTestDb()
    const [u] = await db.insert(users).values({ label: 'shared', createdAt: new Date() }).returning({ id: users.id })
    userId = u.id
  })

  beforeEach(async () => {
    await db.delete(trackedBills); await db.delete(trackedCommittees); await db.delete(trackedMks)
    await db.delete(mkActivity); await db.delete(committeeSessions)
    await db.delete(bills); await db.delete(committees); await db.delete(mks)
    await db.delete(summariesCache); await db.delete(knessetMembersCache); await db.delete(featureFlags)
    delete process.env.ORPHAN_PURGE_BATCH
    await setPressure('50:2') // default for most tests: cap 50 MB, slack 2 MB
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('is disabled when the flag value is "-1"', async () => {
    await setPressure('-1')
    await addBill('1', false, null)
    const r = await purgeOrphansIfNeeded(OVER)
    expect(r.purged).toEqual({ bills: 0, committees: 0, mks: 0 })
    expect(await db.select().from(bills)).toHaveLength(1)
  })

  it('is on by default when the flag row is absent', async () => {
    await setPressure(null) // no flag → default "450:2", on
    await addBill('1', false, null)
    // under the default 450 cap → no purge
    await purgeOrphansIfNeeded(OVER)
    expect(await db.select().from(bills)).toHaveLength(1)
    // over the default cap → purge
    await purgeOrphansIfNeeded(HUGE)
    expect(await db.select().from(bills)).toHaveLength(0)
  })

  it('is a no-op when size is unknown (null)', async () => {
    await addBill('1', false, null)
    await purgeOrphansIfNeeded(async () => null)
    expect(await db.select().from(bills)).toHaveLength(1)
  })

  it('is a no-op when under budget', async () => {
    await addBill('1', false, null)
    await purgeOrphansIfNeeded(UNDER)
    expect(await db.select().from(bills)).toHaveLength(1)
  })

  it('over budget: deletes orphans but never tracked entities', async () => {
    const orphan = await addBill('orphan', false, null)
    const tracked = await addBill('tracked', true, null)
    const r = await purgeOrphansIfNeeded(OVER)
    expect(r.purged.bills).toBe(1)
    const remaining = await db.select().from(bills)
    expect(remaining.map((b) => b.id)).toEqual([tracked])
    expect(remaining.map((b) => b.id)).not.toContain(orphan)
  })

  it('deletes at most ORPHAN_PURGE_BATCH stalest-first, shedding the rest on later calls', async () => {
    process.env.ORPHAN_PURGE_BATCH = '2'
    const a = await addMk('a', false, new Date('2025-01-01'))
    const b = await addMk('b', false, new Date('2025-06-01'))
    const c = await addMk('c', false, new Date('2026-01-01'))

    await purgeOrphansIfNeeded(OVER)
    let left = (await db.select().from(mks)).map((m) => m.id)
    expect(left).toEqual([c])
    expect(left).not.toContain(a); expect(left).not.toContain(b)

    await purgeOrphansIfNeeded(OVER)
    left = (await db.select().from(mks)).map((m) => m.id)
    expect(left).toEqual([])
  })

  it('deletes an orphan committee\'s matching summary but keeps unrelated summaries and API caches', async () => {
    const docUrl = 'https://docs/protocol-7.pdf'
    await addCommittee('orphan-cmt', false, null, docUrl)
    await db.insert(summariesCache).values({ md5: 'm1', summary: 's', createdAt: new Date(), sourceUrl: docUrl })
    await db.insert(summariesCache).values({ md5: 'm2', summary: 's', createdAt: new Date(), sourceUrl: 'https://other' })
    await db.insert(knessetMembersCache).values({ siteId: 1, name: 'x', party: 'p', isLiberal: false, isSupporter: false, cachedAt: new Date() })

    const r = await purgeOrphansIfNeeded(OVER)
    expect(r.purged.committees).toBe(1)
    expect(r.summariesDeleted).toBe(1)
    expect((await db.select().from(summariesCache)).map((s) => s.md5)).toEqual(['m2'])
    expect(await db.select().from(knessetMembersCache)).toHaveLength(1)
  })

  it('is multi-user safe: an entity another user still tracks is not deleted', async () => {
    const [u2] = await db.insert(users).values({ label: 'other', createdAt: new Date() }).returning({ id: users.id })
    const [b] = await db.insert(bills).values({
      number: 'shared', title: 't', status: 'בוועדה', sourceUrl: 'https://x', knessetNumber: 25, lastPolledAt: null,
    }).returning({ id: bills.id })
    await db.insert(trackedBills).values({ userId: u2.id, billId: b.id, createdAt: new Date() })

    const r = await purgeOrphansIfNeeded(OVER)
    expect(r.purged.bills).toBe(0)
    expect(await db.select().from(bills)).toHaveLength(1)
  })

  it('logs one server-log line per deletion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await addBill('o1', false, null)
    await addBill('o2', false, null)
    await purgeOrphansIfNeeded(OVER)
    const gcLines = logSpy.mock.calls.filter((c) => String(c[0]).includes('Storage GC'))
    expect(gcLines).toHaveLength(2)
  })
})
