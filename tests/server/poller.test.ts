import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// vi.hoisted() runs before module-level code so the fns are available inside vi.mock factories
const { mockGetBill, mockGetCommitteeSessions } = vi.hoisted(() => ({
  mockGetBill: vi.fn().mockRejectedValue(new Error('network error')),
  mockGetCommitteeSessions: vi.fn().mockRejectedValue(new Error('network error')),
}))

// Mock all three external service modules — network calls never happen in tests
vi.mock('../../server/services/oknesset', () => ({
  OknessetClient: vi.fn().mockImplementation(() => ({
    getBill: mockGetBill,
    getCommitteeSessions: mockGetCommitteeSessions,
  })),
}))

vi.mock('../../server/services/knesset-scraper', () => ({
  fetchMkActivity: vi.fn().mockRejectedValue(new Error('network error')),
}))

vi.mock('../../server/services/summarizer', () => ({
  Summarizer: vi.fn().mockImplementation(() => ({
    summarizeUrl: vi.fn().mockRejectedValue(new Error('network error')),
  })),
}))

// Import AFTER mocks are set up
import { runPollCycle } from '../../server/services/poller'
import { fetchMkActivity } from '../../server/services/knesset-scraper'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { bills, committees, mks, mkKnessetTerms } from '../../server/db/schema'
import { BillsRepository } from '../../server/repositories/bills-repository'
import { CommitteesRepository } from '../../server/repositories/committees-repository'
import { MksRepository } from '../../server/repositories/mks-repository'

const billsRepo = new BillsRepository()
const committeesRepo = new CommitteesRepository()
const mksRepo = new MksRepository()

describe('runPollCycle', () => {
  beforeAll(async () => { await setupTestDb() })

  beforeEach(async () => {
    // Clear in FK-safe order
    await db.delete(mkKnessetTerms)
    await db.delete(mks)
    await db.delete(committees)
    await db.delete(bills)
  })

  afterEach(() => vi.clearAllMocks())

  it('returns true when there are no items to poll (empty DB)', async () => {
    const result = await runPollCycle()
    expect(result).toBe(true)
  })

  it('returns false when all sub-polls have items but all fetch calls fail', async () => {
    // Seed one bill, one committee, and one MK so each poller has something to attempt
    await billsRepo.upsert({
      oknessetId: '1', number: '101', title: 'חוק בדיקה', status: 'בוועדה',
      committee: '', sourceUrl: 'https://example.gov.il/bill', documentUrl: null,
      knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
    })
    await committeesRepo.upsert({
      oknesset_id: '42', name: 'ועדת בדיקה', chair: 'יו"ר', lastSessionDate: null,
      lastSessionSummary: null, lastSessionDocumentUrl: null, sourceUrl: 'https://example.gov.il/committee',
      hasNewData: false, lastPolledAt: null, recentSessions: [],
    })
    const mkId = await mksRepo.upsert({
      oknesset_id: '99', knesset_site_id: '1116', name: 'חבר כנסת',
      email: null, photoUrl: null, votingSummary: null, sourceUrl: 'https://example.gov.il/mk',
      hasNewData: false, lastPolledAt: null,
      terms: [{ knessetNumber: 25, faction: 'מפלגה' }],
      currentRoles: [], activity: [], recentVotes: [],
    })
    // Verify the MK was seeded and is not inactive (has term 25 = current default)
    const mk = await mksRepo.getById(mkId, 25)
    expect(mk?.inactive).toBe(false)

    const result = await runPollCycle()
    expect(result).toBe(false)
  })

  it('updates bill status in DB when oknesset returns a new status', async () => {
    const billId = await billsRepo.upsert({
      oknessetId: '1', number: '101', title: 'חוק בדיקה', status: 'בוועדה',
      committee: '', sourceUrl: 'https://example.gov.il/bill', documentUrl: null,
      knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
    })

    // Override the shared mock spy to return a new status for this test
    mockGetBill.mockResolvedValueOnce({ status: 'passed' })

    await runPollCycle()

    const updated = await billsRepo.getById(billId, 25)
    expect(updated?.status).toBe('עבר')
    expect(updated?.hasNewData).toBe(true)
    expect(updated?.lastPolledAt).not.toBeNull()
  })

  it('updates MK activity in DB without touching terms', async () => {
    const mkId = await mksRepo.upsert({
      oknesset_id: '99', knesset_site_id: '1116', name: 'חבר כנסת',
      email: null, photoUrl: null, votingSummary: null, sourceUrl: 'https://example.gov.il/mk',
      hasNewData: false, lastPolledAt: null,
      terms: [{ knessetNumber: 25, faction: 'מפלגה' }],
      currentRoles: [], activity: [], recentVotes: [],
    })

    const newActivity = [{
      type: 'question' as const, date: '2026-05-01', title: 'שאלה לשר',
      detail: undefined, sourceUrl: 'https://example.gov.il/q/1',
    }]
    vi.mocked(fetchMkActivity).mockResolvedValueOnce(newActivity)

    await runPollCycle()

    const updated = await mksRepo.getById(mkId, 25)
    expect(updated?.activity?.length).toBe(1)
    expect(updated?.activity?.[0].title).toBe('שאלה לשר')
    expect(updated?.hasNewData).toBe(true)
    // Terms must be preserved
    expect(updated?.inactive).toBe(false)
    expect(updated?.party).toBe('מפלגה')
  })
})
