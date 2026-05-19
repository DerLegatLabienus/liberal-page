import { vi, describe, it, expect } from 'vitest'
import { readFile, writeFile } from 'fs/promises'

// Mock the fs/promises module so poller never touches real files
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('[]'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

// Mock all three external service modules
vi.mock('../../server/services/oknesset', () => ({
  OknessetClient: vi.fn().mockImplementation(() => ({
    getBill: vi.fn().mockRejectedValue(new Error('network error')),
    getCommitteeSessions: vi.fn().mockRejectedValue(new Error('network error')),
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

describe('runPollCycle', () => {
  it('returns false when all sub-polls have items but all fetch calls fail', async () => {
    // Give each poll function one item to attempt
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify([
        { id: 1, oknesset_id: '1', knesset_site_id: '1116', lastPolledAt: null },
      ]) as unknown as Buffer
    )

    const result = await runPollCycle()
    expect(result).toBe(false)
  })

  it('returns true when there are no items to poll (nothing to fail)', async () => {
    vi.mocked(readFile).mockResolvedValue('[]' as unknown as Buffer)

    const result = await runPollCycle()
    expect(result).toBe(true)
  })
})
