import { createHash } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import type { SummaryCache } from '../../src/types'

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'

export class Summarizer {
  private client = new Anthropic()

  constructor(private cachePath: string) {}

  private async readCache(): Promise<SummaryCache> {
    try {
      const raw = await readFile(this.cachePath, 'utf-8')
      return JSON.parse(raw) as SummaryCache
    } catch {
      return {}
    }
  }

  private async writeCache(cache: SummaryCache): Promise<void> {
    await writeFile(this.cachePath, JSON.stringify(cache, null, 2), 'utf-8')
  }

  private async extractText(buffer: Buffer, format: 'pdf' | 'docx'): Promise<string> {
    if (format === 'pdf') {
      // Dynamic import keeps pdf-parse lazy (avoids stdout dump on server start)
      // and lets vitest mock it via vi.mock('pdf-parse')
      const pdfMod = await import('pdf-parse') as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }
      return pdfMod.default(buffer).then((r) => r.text)
    }
    return mammoth.extractRawText({ buffer }).then((r) => r.value)
  }

  private async callClaude(text: string): Promise<string> {
    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `סכם את המסמך הבא בעברית בפסקה אחת קצרה וברורה:\n\n${text.slice(0, 8000)}`,
        },
      ],
    })
    const block = message.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
    return block.text
  }

  async summarizeBuffer(
    buffer: Buffer,
    sourceUrl: string,
    format: 'pdf' | 'docx'
  ): Promise<string> {
    const md5 = createHash('md5').update(buffer).digest('hex')
    const cache = await this.readCache()

    if (cache[md5]) return cache[md5].summary

    const text = await this.extractText(buffer, format)
    const summary = await this.callClaude(text)

    cache[md5] = { summary, createdAt: new Date().toISOString(), sourceUrl }
    await this.writeCache(cache)
    return summary
  }

  async summarizeUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buffer = Buffer.from(await res.arrayBuffer())
      const format = url.toLowerCase().includes('.docx') ? 'docx' : 'pdf'
      return this.summarizeBuffer(buffer, url, format)
    } catch {
      return null
    }
  }

  async summarizeAndExtractAttendees(docUrl: string): Promise<{
    derivedTitle?: string
    aiSummary?: string
    attendees: string[]
  }> {
    try {
      const res = await fetch(docUrl)
      if (!res.ok) return { attendees: [] }
      const buffer = Buffer.from(await res.arrayBuffer())
      const format = docUrl.toLowerCase().includes('.doc') ? 'docx' : 'pdf'
      const md5 = createHash('md5').update(buffer).digest('hex')

      const cache = await this.readCache()
      const entry = cache[md5]

      // Return from cache if already processed with attendees
      if (entry && entry.attendees !== undefined) {
        return {
          derivedTitle: entry.derivedTitle,
          aiSummary: entry.summary,
          attendees: entry.attendees,
        }
      }

      // Extract text and call Claude for title + summary + attendees in one pass
      const text = await this.extractText(buffer, format)
      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `קרא את פרוטוקול ועדה זה בעברית וענה ב-JSON בפורמט הבא בלבד (ללא טקסט נוסף):
{"title":"כותרת קצרה של הנושא הראשי (משפט אחד)","summary":"סיכום קצר של הדיון (משפט אחד)","attendees":["שם ח\\\"כ 1","שם ח\\\"כ 2"]}

חברי הכנסת שנכחו מופיעים בתחילת המסמך תחת "נכחו" או "חברי הכנסת".

פרוטוקול:
${text.slice(0, 8000)}`,
        }],
      })
      const block = message.content[0]
      if (block.type !== 'text') return { attendees: [] }

      let parsed: { title?: string; summary?: string; attendees?: string[] } = {}
      try {
        parsed = JSON.parse(block.text) as typeof parsed
      } catch {
        const attendeeMatch = block.text.match(/"attendees"\s*:\s*\[(.*?)\]/s)
        if (attendeeMatch) {
          parsed.attendees = attendeeMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, '')) ?? []
        }
      }

      // Write to cache
      cache[md5] = {
        summary: parsed.summary ?? '',
        createdAt: new Date().toISOString(),
        sourceUrl: docUrl,
        attendees: parsed.attendees ?? [],
        derivedTitle: parsed.title,
      }
      await this.writeCache(cache)

      return {
        derivedTitle: parsed.title,
        aiSummary: parsed.summary,
        attendees: parsed.attendees ?? [],
      }
    } catch {
      return { attendees: [] }
    }
  }
}
