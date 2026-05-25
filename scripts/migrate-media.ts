import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'
import type { GalleryItem } from '../src/types'

const GALLERY_JSON = path.join(process.cwd(), 'src/data/gallery.json')
const OUTPUT_DIR = path.join(process.cwd(), 'public/images/gallery')
const BASE_URL = 'https://likudliberal.org'
const MIN_SIZE_BYTES = 10 * 1024

const BLOCKED_PATTERNS = ['/wp-includes/', '/wp-content/themes/', '/wp-content/plugins/']
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'])

export function sanitizeFilename(url: string): string {
  const raw = url.split('/').pop()?.split('?')[0] ?? 'image'
  const ext = path.extname(raw).toLowerCase()
  const base = path.basename(raw, path.extname(raw))
  const sanitizedBase = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const stem = sanitizedBase || 'image'
  return stem + ext
}

export function shouldKeepUrl(url: string): boolean {
  if (!url.startsWith(BASE_URL + '/')) return false
  if (!url.includes('/wp-content/uploads/')) return false
  if (BLOCKED_PATTERNS.some(p => url.includes(p))) return false
  const ext = path.extname(url.split('?')[0]).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

export function resolveFilename(filename: string, existingNames: Set<string>): string {
  if (!existingNames.has(filename)) return filename
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let counter = 1
  let candidate = `${base}-${counter}${ext}`
  while (existingNames.has(candidate)) {
    counter++
    candidate = `${base}-${counter}${ext}`
  }
  return candidate
}

export function mergeGalleryEntries(
  existing: GalleryItem[],
  newLocalPaths: string[],
  today: string
): GalleryItem[] {
  const usedSrcs = new Set<string>()
  const result: GalleryItem[] = []

  for (const item of existing) {
    if (!item.src.startsWith('https://likudliberal.org/')) {
      usedSrcs.add(item.src)
      result.push(item)
      continue
    }
    const filename = sanitizeFilename(item.src)
    const resolved = resolveFilename(filename, usedSrcs)
    const localPath = `/images/gallery/${resolved}`
    usedSrcs.add(localPath)
    result.push({ ...item, src: localPath })
  }

  const maxId = result.reduce((m, item) => Math.max(m, item.id), 0)
  let nextId = maxId + 1

  for (const localPath of newLocalPaths) {
    if (!usedSrcs.has(localPath)) {
      usedSrcs.add(localPath)
      result.push({ id: nextId++, src: localPath, caption: '', captionEn: '', date: today })
    }
  }

  return result
}

async function crawlImageUrls(): Promise<string[]> {
  const collectedUrls = new Set<string>()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()

    page.on('request', (request) => {
      const url = request.url()
      if (shouldKeepUrl(url)) collectedUrls.add(url)
    })

    console.log('  Loading homepage...')
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    // Extra wait to capture JS-driven slideshow requests fired after networkidle
    await page.waitForTimeout(3_000)

    const galleryLinks: string[] = await page.evaluate(() =>
      [...new Set(
        Array.from(document.querySelectorAll('a[href]'))
          .filter((a) => {
            const href = (a as HTMLAnchorElement).href
            const text = a.textContent ?? ''
            const raw  = a.getAttribute('href') ?? ''
            return /gallery|גלריה|אירועים|תמונות/i.test(href + ' ' + text + ' ' + raw)
          })
          .map((a) => (a as HTMLAnchorElement).href)
      )]
    )

    console.log(`  Found ${galleryLinks.length} gallery page(s) to crawl`)
    // Only initial page load is captured per sub-page; paginated galleries need additional traversal
    for (const link of galleryLinks.slice(0, 10)) {
      try {
        console.log(`  Crawling: ${link}`)
        await page.goto(link, { waitUntil: 'networkidle', timeout: 20_000 })
        await page.waitForTimeout(2_000)
      } catch {
        console.warn(`  Skipped (timeout/error): ${link}`)
      }
    }
  } finally {
    await browser.close()
  }
  return [...collectedUrls]
}

async function downloadImages(urls: string[]): Promise<string[]> {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const usedNames = new Set<string>()
  const localPaths: string[] = []

  for (const url of urls) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let res: Response
      try {
        res = await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) { console.warn(`  Skip (${res.status}): ${url}`); continue }
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.byteLength < MIN_SIZE_BYTES) {
        console.warn(`  Skip (too small, ${buffer.byteLength} B): ${url}`)
        continue
      }

      const rawFilename = sanitizeFilename(url)
      const filename = resolveFilename(rawFilename, usedNames)
      usedNames.add(filename)

      await writeFile(path.join(OUTPUT_DIR, filename), buffer)
      localPaths.push(`/images/gallery/${filename}`)
      console.log(`  ✓ ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KB)`)
    } catch (err) {
      console.warn(`  Error fetching ${url}:`, err)
    }
  }

  return localPaths
}

async function main(): Promise<void> {
  console.log('=== Media Migration ===')

  console.log('\nStep 1: Crawling likudliberal.org for image URLs...')
  const urls = await crawlImageUrls()
  console.log(`Found ${urls.length} candidate image URL(s)`)

  console.log('\nStep 2: Downloading images...')
  const localPaths = await downloadImages(urls)
  console.log(`Downloaded ${localPaths.length} image(s) to public/images/gallery/`)

  console.log('\nStep 3: Updating gallery.json...')
  const raw = await readFile(GALLERY_JSON, 'utf-8')
  const existing: GalleryItem[] = JSON.parse(raw)
  const today = new Date().toISOString().slice(0, 10)
  const updated = mergeGalleryEntries(existing, localPaths, today)
  await writeFile(GALLERY_JSON, JSON.stringify(updated, null, 2) + '\n', 'utf-8')

  const rewrote = existing.filter(i => i.src.startsWith('https://likudliberal.org')).length
  const newItems = updated.length - existing.length
  console.log(`Done — ${rewrote} entr${rewrote === 1 ? 'y' : 'ies'} rewritten, ${newItems} new entr${newItems === 1 ? 'y' : 'ies'} added`)
}

const isMain = process.argv[1]?.replace(/\.js$/, '.ts').endsWith('migrate-media.ts')
if (isMain) {
  main().catch((err: Error) => { console.error(err); process.exit(1) })
}
