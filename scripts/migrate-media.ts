import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'
import type { GalleryItem } from '../src/types'

const GALLERY_JSON = path.join(process.cwd(), 'src/data/gallery.json')
const OUTPUT_DIR = path.join(process.cwd(), 'public/images/gallery')
const BASE_URL = 'https://likudliberal.org'
const MIN_SIZE_BYTES = 10 * 1024

const BLOCKED_PATTERNS = ['/wp-includes/', '/wp-content/themes/', '/wp-content/plugins/']

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
  return !BLOCKED_PATTERNS.some(p => url.includes(p))
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
  // placeholder — implemented in Task 2
  return existing
}

async function crawlImageUrls(): Promise<string[]> {
  const collectedUrls = new Set<string>()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  page.on('request', (request) => {
    const url = request.url()
    if (shouldKeepUrl(url)) collectedUrls.add(url)
  })

  console.log('  Loading homepage...')
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.waitForTimeout(3_000)

  const galleryLinks: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((href) => /gallery|גלריה|אירועים|תמונות/i.test(href))
  )

  console.log(`  Found ${galleryLinks.length} gallery page(s) to crawl`)
  for (const link of galleryLinks.slice(0, 10)) {
    try {
      console.log(`  Crawling: ${link}`)
      await page.goto(link, { waitUntil: 'networkidle', timeout: 20_000 })
      await page.waitForTimeout(2_000)
    } catch {
      console.warn(`  Skipped (timeout/error): ${link}`)
    }
  }

  await browser.close()
  return [...collectedUrls]
}

async function downloadImages(urls: string[]): Promise<string[]> {
  // placeholder — implemented in Task 4
  return []
}

async function main(): Promise<void> {
  // placeholder — implemented in Task 5
}

const isMain = process.argv[1]?.replace(/\.js$/, '.ts').endsWith('migrate-media.ts')
if (isMain) {
  main().catch((err: Error) => { console.error(err); process.exit(1) })
}
