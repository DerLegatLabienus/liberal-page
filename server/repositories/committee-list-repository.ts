import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { CommitteeListItem } from '../../src/types'

interface CacheFile { cachedAt: string; committees: CommitteeListItem[] }
const CACHE_PATH = path.join(process.cwd(), 'src/data/knesset-committees-cache.json')

export class CommitteeListRepository {
  private cachedAt = 0

  async get(): Promise<CommitteeListItem[] | null> {
    try {
      const raw = await readFile(CACHE_PATH, 'utf-8')
      const data = JSON.parse(raw as string) as CacheFile
      this.cachedAt = new Date(data.cachedAt).getTime()
      return data.committees
    } catch { return null }
  }

  async set(committees: CommitteeListItem[]): Promise<void> {
    this.cachedAt = Date.now()
    await writeFile(CACHE_PATH, JSON.stringify({ cachedAt: new Date().toISOString(), committees }, null, 2), 'utf-8')
  }

  getAgeMs(): number { return this.cachedAt ? Date.now() - this.cachedAt : Infinity }
}
