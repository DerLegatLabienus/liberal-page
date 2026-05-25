# Media Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a one-shot migration script that crawls likudliberal.org with Playwright, downloads content images to `public/images/gallery/`, and rewrites `src/data/gallery.json` to use local paths so the gallery no longer depends on the old site being online.

**Architecture:** Pure utility functions (`sanitizeFilename`, `shouldKeepUrl`, `resolveFilename`, `mergeGalleryEntries`) are exported from the script and unit-tested. Playwright crawling and image downloading are side-effectful functions that run against the live site and are not mocked. The `main()` entry point only executes when the file is run directly (guarded via `process.argv[1]`), so tests can import the pure functions safely.

**Tech Stack:** Playwright (already installed, Chromium binary present), Node.js `fs/promises` + `fetch`, `tsx` for TypeScript execution, Vitest for unit tests.

---

### Task 1: Script skeleton and URL utilities

**Files:**
- Create: `scripts/migrate-media.ts`
- Create: `tests/unit/migrate-media.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/migrate-media.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeFilename, shouldKeepUrl, resolveFilename } from '../../scripts/migrate-media'

describe('sanitizeFilename', () => {
  it('extracts filename and lowercases it', () => {
    expect(sanitizeFilename('https://example.com/wp-content/uploads/2020/05/Photo.JPG'))
      .toBe('photo.jpg')
  })

  it('replaces spaces with hyphens', () => {
    expect(sanitizeFilename('https://example.com/foo bar.png')).toBe('foo-bar.png')
  })

  it('collapses consecutive hyphens', () => {
    expect(sanitizeFilename('https://example.com/foo--bar.jpg')).toBe('foo-bar.jpg')
  })

  it('strips query strings', () => {
    expect(sanitizeFilename('https://example.com/foo.jpg?w=300')).toBe('foo.jpg')
  })

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeFilename('https://example.com/-foo-.jpg')).toBe('foo.jpg')
  })
})

describe('shouldKeepUrl', () => {
  it('keeps likudliberal.org wp-content/uploads URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-content/uploads/2020/05/photo.jpg')).toBe(true)
  })

  it('rejects URLs from external domains', () => {
    expect(shouldKeepUrl('https://cdn.example.com/wp-content/uploads/photo.jpg')).toBe(false)
  })

  it('rejects wp-includes URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-includes/images/spinner.gif')).toBe(false)
  })

  it('rejects wp-content/themes URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-content/themes/mytheme/logo.png')).toBe(false)
  })

  it('rejects wp-content/plugins URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-content/plugins/slider/arrow.png')).toBe(false)
  })

  it('rejects URLs not containing wp-content/uploads', () => {
    expect(shouldKeepUrl('https://likudliberal.org/custom/path/image.jpg')).toBe(false)
  })
})

describe('resolveFilename', () => {
  it('returns original name when no collision', () => {
    expect(resolveFilename('photo.jpg', new Set())).toBe('photo.jpg')
  })

  it('appends -1 on first collision', () => {
    expect(resolveFilename('photo.jpg', new Set(['photo.jpg']))).toBe('photo-1.jpg')
  })

  it('increments counter until free', () => {
    expect(resolveFilename('photo.jpg', new Set(['photo.jpg', 'photo-1.jpg']))).toBe('photo-2.jpg')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/migrate-media.test.ts
```
Expected: FAIL — `Cannot find module '../../scripts/migrate-media'`

- [ ] **Step 3: Create the script with URL utilities**

Create `scripts/migrate-media.ts`:
```typescript
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
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

export function shouldKeepUrl(url: string): boolean {
  if (!url.startsWith(BASE_URL)) return false
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
  // placeholder — implemented in Task 3
  return []
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/migrate-media.test.ts
```
Expected: all `sanitizeFilename`, `shouldKeepUrl`, `resolveFilename` tests pass (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-media.ts tests/unit/migrate-media.test.ts
git commit -m "feat(migrate): add URL utilities for media migration script"
```

---

### Task 2: gallery.json merge utility

**Files:**
- Modify: `scripts/migrate-media.ts` — replace `mergeGalleryEntries` placeholder
- Modify: `tests/unit/migrate-media.test.ts` — add merge tests

- [ ] **Step 1: Add the failing tests**

Add to the imports at the top of `tests/unit/migrate-media.test.ts`:
```typescript
import { sanitizeFilename, shouldKeepUrl, resolveFilename, mergeGalleryEntries } from '../../scripts/migrate-media'
import type { GalleryItem } from '@/types'
```
(Replace the existing import line.)

Add to the bottom of `tests/unit/migrate-media.test.ts`:
```typescript
describe('mergeGalleryEntries', () => {
  const existing: GalleryItem[] = [
    {
      id: 1,
      src: 'https://likudliberal.org/wp-content/uploads/2020/05/amir1-300x282.jpg',
      caption: 'Amir',
      captionEn: 'Amir',
      date: '2020-05-01',
    },
    {
      id: 2,
      src: '/images/gallery/local.jpg',
      caption: 'Local',
      date: '2021-01-01',
    },
  ]

  it('rewrites likudliberal.org src to local path', () => {
    const result = mergeGalleryEntries(existing, [], '2026-05-25')
    expect(result[0].src).toBe('/images/gallery/amir1-300x282.jpg')
  })

  it('preserves caption and captionEn on rewritten entries', () => {
    const result = mergeGalleryEntries(existing, [], '2026-05-25')
    expect(result[0].caption).toBe('Amir')
    expect(result[0].captionEn).toBe('Amir')
  })

  it('leaves already-local paths unchanged', () => {
    const result = mergeGalleryEntries(existing, [], '2026-05-25')
    expect(result[1].src).toBe('/images/gallery/local.jpg')
  })

  it('appends new local paths not already present', () => {
    const result = mergeGalleryEntries(existing, ['/images/gallery/new.jpg'], '2026-05-25')
    expect(result).toHaveLength(3)
    expect(result[2]).toMatchObject({ src: '/images/gallery/new.jpg', caption: '', date: '2026-05-25' })
  })

  it('does not duplicate a path already present after rewrite', () => {
    const result = mergeGalleryEntries(
      existing,
      ['/images/gallery/amir1-300x282.jpg'],
      '2026-05-25'
    )
    expect(result).toHaveLength(2)
  })

  it('assigns sequential ids for new entries', () => {
    const result = mergeGalleryEntries(
      existing,
      ['/images/gallery/new1.jpg', '/images/gallery/new2.jpg'],
      '2026-05-25'
    )
    expect(result[2].id).toBe(3)
    expect(result[3].id).toBe(4)
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npx vitest run tests/unit/migrate-media.test.ts
```
Expected: 6 new `mergeGalleryEntries` tests FAIL (placeholder returns `existing` unchanged).

- [ ] **Step 3: Implement mergeGalleryEntries**

Replace the `mergeGalleryEntries` placeholder in `scripts/migrate-media.ts`:
```typescript
export function mergeGalleryEntries(
  existing: GalleryItem[],
  newLocalPaths: string[],
  today: string
): GalleryItem[] {
  const result: GalleryItem[] = existing.map(item => {
    if (!item.src.startsWith('https://likudliberal.org')) return item
    const filename = sanitizeFilename(item.src)
    return { ...item, src: `/images/gallery/${filename}` }
  })

  const usedSrcs = new Set(result.map(item => item.src))
  const maxId = result.reduce((m, item) => Math.max(m, item.id), 0)
  let nextId = maxId + 1

  for (const localPath of newLocalPaths) {
    if (!usedSrcs.has(localPath)) {
      result.push({ id: nextId++, src: localPath, caption: '', captionEn: '', date: today })
    }
  }

  return result
}
```

- [ ] **Step 4: Run all tests to verify everything passes**

```bash
npx vitest run tests/unit/migrate-media.test.ts
```
Expected: all 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-media.ts tests/unit/migrate-media.test.ts
git commit -m "feat(migrate): add gallery.json merge utility with tests"
```

---

### Task 3: Playwright crawler

**Files:**
- Modify: `scripts/migrate-media.ts` — replace `crawlImageUrls` placeholder

No unit tests — this function talks to the live network.

- [ ] **Step 1: Replace the crawlImageUrls placeholder**

Replace the `crawlImageUrls` function in `scripts/migrate-media.ts`:
```typescript
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
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

```bash
npm test
```
Expected: all tests pass (the new function is not imported by tests).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-media.ts
git commit -m "feat(migrate): add Playwright crawler for image URL discovery"
```

---

### Task 4: Image downloader

**Files:**
- Modify: `scripts/migrate-media.ts` — replace `downloadImages` placeholder

No unit tests — this function does network + filesystem I/O.

- [ ] **Step 1: Replace the downloadImages placeholder**

Replace the `downloadImages` function in `scripts/migrate-media.ts`:
```typescript
async function downloadImages(urls: string[]): Promise<string[]> {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const usedNames = new Set<string>()
  const localPaths: string[] = []

  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) { console.warn(`  Skip (${res.status}): ${url}`); continue }
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.byteLength < MIN_SIZE_BYTES) continue

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
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-media.ts
git commit -m "feat(migrate): add image downloader"
```

---

### Task 5: Wire up main() and run the migration

**Files:**
- Modify: `scripts/migrate-media.ts` — replace `main` placeholder

- [ ] **Step 1: Replace the main placeholder**

Replace the `main` function in `scripts/migrate-media.ts`:
```typescript
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
```

- [ ] **Step 2: Type-check the full script**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Run the migration against the live site**

```bash
npx tsx scripts/migrate-media.ts
```
Expected output (approximate):
```
=== Media Migration ===

Step 1: Crawling likudliberal.org for image URLs...
  Loading homepage...
  Found N gallery page(s) to crawl
  Crawling: https://...
Found N candidate image URL(s)

Step 2: Downloading images...
  ✓ amir1-300x282.jpg (18.2 KB)
  ✓ elad1-300x282.jpg (22.4 KB)
  ...
Downloaded N image(s) to public/images/gallery/

Step 3: Updating gallery.json...
Done — 3 entries rewritten, N new entries added
```

- [ ] **Step 4: Verify gallery.json has no more likudliberal.org URLs**

```bash
grep 'likudliberal.org' src/data/gallery.json && echo "FAIL: still has old URLs" || echo "PASS: no old URLs"
```
Expected output: `PASS: no old URLs`

- [ ] **Step 5: Verify the images were downloaded**

```bash
ls public/images/gallery/ | head -20
```
Expected: list of `.jpg`/`.png`/`.webp` filenames.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 7: Commit migration results**

```bash
git add scripts/migrate-media.ts src/data/gallery.json
git add public/images/gallery/
git commit -m "feat(migrate): run media migration — $(ls public/images/gallery/ | wc -l | tr -d ' ') images saved locally

Downloads wp-content/uploads images from likudliberal.org to public/images/gallery/.
Rewrites gallery.json to use local paths. Old site no longer required for gallery."
```
