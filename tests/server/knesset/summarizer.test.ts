import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'

const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: createMock } })),
}))

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'PDF content here' }),
}))

vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: 'DOCX content here' }),
}))

const mockRepoGet = vi.fn()
const mockRepoSet = vi.fn()
const mockRepoGetByUrl = vi.fn()

vi.mock('../../../server/repositories/summaries-repository', () => ({
  SummariesRepository: vi.fn().mockImplementation(() => ({
    get: mockRepoGet,
    set: mockRepoSet,
    getBySourceUrl: mockRepoGetByUrl,
  })),
}))

const fetchDocMock = vi.fn()
vi.mock('../../../server/services/url-guard', () => ({
  fetchAllowedDocument: (...a: unknown[]) => fetchDocMock(...a),
  UrlNotAllowedError: class UrlNotAllowedError extends Error {},
  DocumentFetchError: class DocumentFetchError extends Error {},
}))

import { Summarizer } from '../../../server/services/summarizer'

const relevant = (summary: string) => ({ content: [{ type: 'text', text: JSON.stringify({ relevant: true, summary }) }] })
const irrelevant = () => ({ content: [{ type: 'text', text: JSON.stringify({ relevant: false, summary: '' }) }] })

describe('Summarizer.summarizeBuffer', () => {
  let summarizer: Summarizer

  beforeEach(() => {
    summarizer = new Summarizer()
    vi.clearAllMocks()
    mockRepoGet.mockResolvedValue(null)
    mockRepoSet.mockResolvedValue(undefined)
  })

  it('returns cached summary when MD5 matches (no AI call)', async () => {
    const content = Buffer.from('test content')
    const md5 = createHash('md5').update(content).digest('hex')
    mockRepoGet.mockResolvedValueOnce({ summary: 'סיכום שמור', createdAt: '2024-01-01', sourceUrl: 'http://test.com' })

    const result = await summarizer.summarizeBuffer(content, 'http://test.com', 'pdf')
    expect(result).toBe('סיכום שמור')
    expect(mockRepoGet).toHaveBeenCalledWith(md5)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('summarizes and caches on cache miss when content is relevant', async () => {
    createMock.mockResolvedValueOnce(relevant('סיכום בדיקה'))
    const result = await summarizer.summarizeBuffer(Buffer.from('new content'), 'http://test.com', 'pdf')
    expect(result).toBe('סיכום בדיקה')
    expect(mockRepoSet).toHaveBeenCalled()
  })

  it('returns null and does NOT cache when content is judged irrelevant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createMock.mockResolvedValueOnce(irrelevant())
    const result = await summarizer.summarizeBuffer(Buffer.from('spam'), 'http://evil.example/ad', 'pdf')
    expect(result).toBeNull()
    expect(mockRepoSet).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('Summarizer.summarizeUrl URL cache', () => {
  let summarizer: Summarizer

  beforeEach(() => {
    summarizer = new Summarizer()
    vi.clearAllMocks()
    mockRepoGet.mockResolvedValue(null)
    mockRepoSet.mockResolvedValue(undefined)
    mockRepoGetByUrl.mockResolvedValue(null)
  })

  it('skips the download entirely when a summary is cached for the URL', async () => {
    mockRepoGetByUrl.mockResolvedValueOnce({ summary: 'מהמטמון', createdAt: '2024-01-01', sourceUrl: 'https://main.knesset.gov.il/x.pdf' })
    const result = await summarizer.summarizeUrl('https://main.knesset.gov.il/x.pdf')
    expect(result).toBe('מהמטמון')
    expect(fetchDocMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('downloads and summarizes when the URL is not cached', async () => {
    mockRepoGetByUrl.mockResolvedValueOnce(null)
    fetchDocMock.mockResolvedValueOnce(Buffer.from('doc bytes'))
    createMock.mockResolvedValueOnce(relevant('סיכום חדש'))
    const result = await summarizer.summarizeUrl('https://main.knesset.gov.il/x.pdf')
    expect(result).toBe('סיכום חדש')
    expect(fetchDocMock).toHaveBeenCalledTimes(1)
  })
})
