import { readFile, writeFile } from 'fs/promises'
import path from 'path'

interface Annotation {
  isLiberal: boolean
  isSupporter: boolean
}

const PATH = path.join(process.cwd(), 'src/data/mk-annotations.json')

export class MkAnnotationsRepository {
  async getAll(): Promise<Record<string, Annotation>> {
    try {
      const raw = await readFile(PATH, 'utf-8')
      return JSON.parse(raw as string) as Record<string, Annotation>
    } catch {
      return {}
    }
  }

  async set(siteId: string, annotation: Annotation): Promise<void> {
    const all = await this.getAll()
    all[siteId] = annotation
    await writeFile(PATH, JSON.stringify(all, null, 2), 'utf-8')
  }
}
