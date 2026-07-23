import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: createMock } })),
}))

import { beautifyLetterHtml } from '../../../server/services/letter-beautifier'

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY

describe('beautifyLetterHtml', () => {
  beforeEach(() => {
    createMock.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY
  })

  it('returns sanitized HTML from the model response', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '<p dir="rtl">שלום</p><script>alert(1)</script>' }] })
    const out = await beautifyLetterHtml('שלום')
    expect(out).toContain('<p dir="rtl">שלום</p>')
    expect(out).not.toContain('script')
  })

  it('strips a ```html code fence the model may wrap output in', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '```html\n<p dir="rtl">היי</p>\n```' }] })
    const out = await beautifyLetterHtml('היי')
    expect(out).toBe('<p dir="rtl">היי</p>')
  })

  it('throws beautify_unavailable when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(beautifyLetterHtml('x')).rejects.toThrow('beautify_unavailable')
    expect(createMock).not.toHaveBeenCalled()
  })
})
