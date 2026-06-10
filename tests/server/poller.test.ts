import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// vi.hoisted() runs before module-level code so the fns are available inside vi.mock factories
const { mockFetchBillStatus, mockEnrichCommitteeSessions } = vi.hoisted(() => ({
  mockFetchBillStatus: vi.fn().mockRejectedValue(new Error('network error')),
  mockEnrichCommitteeSessions: vi.fn().mockRejectedValue(new Error('network error')),
}))

// Bill status comes from Knesset OData (not oknesset.org).
vi.mock('../../server/services/knesset-bills', () => ({
  fetchBillStatusById: mockFetchBillStatus,
  knessetBillUrl: (billId: number) => `https://mock-knesset.gov.il/bill/${billId}`,
}))

// Committee sessions are polled via the Knesset-OData enricher (not oknesset.org).
vi.mock('../../server/services/committee-session-enricher', () => ({
  enrichCommitteeSessions: mockEnrichCommitteeSessions,
}))

vi.mock('../../server/services/knesset-scraper', () => ({
  fetchMkActivity: vi.fn().mockRejectedValue(new Error('network error')),
}))

vi.mock('../../server/services/summarizer', () => ({
  Summarizer: vi.fn().mockImplementation(() => ({
    summarizeUrl: vi.fn().mockRejectedValue(new Error('network error')),
  })),
}))

vi.mock('../../server/repositories/tracked-bills-repository', () => ({
  TrackedBillsRepository: vi.fn().mockImplementation(() => ({
    findAlertRecipients: vi.fn().mockResolvedValue([]),
  })),
}))

vi.mock('../../server/services/email-render', () => ({
  renderFragment: vi.fn().mockResolvedValue('<li>item</li>'),
}))

vi.mock('../../server/services/email', () => ({
  sendEmailsThrottled: vi.fn().mockResolvedValue(undefined),
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

  it('updates bill status in DB when Knesset OData returns a new status', async () => {
    const billId = await billsRepo.upsert({
      oknessetId: '1', number: '101', title: 'חוק בדיקה', status: 'בוועדה',
      committee: '', sourceUrl: 'https://example.gov.il/bill', documentUrl: null,
      knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
    })

    // Knesset OData returns the already-mapped Hebrew status for this bill
    mockFetchBillStatus.mockResolvedValueOnce('עבר')

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
