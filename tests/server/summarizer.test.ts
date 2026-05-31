import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'סיכום בדיקה' }],
      }),
    },
  })),
}))

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'PDF content here' }),
}))

vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: 'DOCX content here' }),
}))

const mockRepoGet = vi.fn()
const mockRepoSet = vi.fn()

vi.mock('../../server/repositories/summaries-repository', () => ({
  SummariesRepository: vi.fn().mockImplementation(() => ({
    get: mockRepoGet,
    set: mockRepoSet,
  })),
}))

import { Summarizer } from '../../server/services/summarizer'

describe('Summarizer', () => {
  let summarizer: Summarizer

  beforeEach(() => {
    summarizer = new Summarizer()
    vi.clearAllMocks()
    mockRepoGet.mockResolvedValue(null)
    mockRepoSet.mockResolvedValue(undefined)
  })

  it('returns cached summary when MD5 matches', async () => {
    const content = Buffer.from('test content')
    const md5 = createHash('md5').update(content).digest('hex')
    const cachedSummary = 'סיכום שמור'

    mockRepoGet.mockResolvedValueOnce({
      summary: cachedSummary,
      createdAt: '2024-01-01',
      sourceUrl: 'http://test.com',
    })

    const result = await summarizer.summarizeBuffer(content, 'http://test.com', 'pdf')
    expect(result).toBe(cachedSummary)
    expect(mockRepoGet).toHaveBeenCalledWith(md5)
  })

  it('calls Claude API on cache miss and caches result', async () => {
    mockRepoGet.mockResolvedValueOnce(null)

    const result = await summarizer.summarizeBuffer(
      Buffer.from('new content'),
      'http://test.com',
      'pdf'
    )

    expect(result).toBe('סיכום בדיקה')
    expect(mockRepoSet).toHaveBeenCalled()
  })
})
