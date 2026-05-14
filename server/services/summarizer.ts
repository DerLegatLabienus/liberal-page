import { createHash } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import Anthropic from '@anthropic-ai/sdk'
import pdfParse from 'pdf-parse'
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

  private extractText(buffer: Buffer, format: 'pdf' | 'docx'): Promise<string> {
    if (format === 'pdf') return pdfParse(buffer).then((r) => r.text)
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
}
