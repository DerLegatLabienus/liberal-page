import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { KnessetMember } from '../../src/types'

interface CacheFile {
  cachedAt: string
  members: KnessetMember[]
}

const CACHE_PATH = path.join(process.cwd(), 'src/data/knesset-members-cache.json')

export class MkListRepository {
  private cachedAt = 0

  async get(): Promise<KnessetMember[] | null> {
    try {
      const raw = await readFile(CACHE_PATH, 'utf-8')
      const data = JSON.parse(raw as string) as CacheFile
      this.cachedAt = new Date(data.cachedAt).getTime()
      return data.members
    } catch {
      return null
    }
  }

  async set(members: KnessetMember[]): Promise<void> {
    const cachedAt = new Date().toISOString()
    this.cachedAt = Date.now()
    await writeFile(CACHE_PATH, JSON.stringify({ cachedAt, members }, null, 2), 'utf-8')
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
