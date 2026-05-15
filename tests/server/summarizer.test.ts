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

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { Summarizer } from '../../server/services/summarizer'

const CACHE_PATH = 'src/data/summaries-cache.json'

describe('Summarizer', () => {
  let summarizer: Summarizer

  beforeEach(() => {
    summarizer = new Summarizer(CACHE_PATH)
    vi.clearAllMocks()
  })

  it('returns cached summary when MD5 matches', async () => {
    const content = Buffer.from('test content')
    const md5 = createHash('md5').update(content).digest('hex')
    const cachedSummary = 'סיכום שמור'

    const { readFile } = await import('fs/promises')
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ [md5]: { summary: cachedSummary, createdAt: '2024-01-01', sourceUrl: 'http://test.com' } })
    )

    const result = await summarizer.summarizeBuffer(content, 'http://test.com', 'pdf')
    expect(result).toBe(cachedSummary)
  })

  it('calls Claude API on cache miss and caches result', async () => {
    const { readFile, writeFile } = await import('fs/promises')
    vi.mocked(readFile).mockResolvedValueOnce('{}')

    const result = await summarizer.summarizeBuffer(
      Buffer.from('new content'),
      'http://test.com',
      'pdf'
    )

    expect(result).toBe('סיכום בדיקה')
    expect(writeFile).toHaveBeenCalled()
  })
})
