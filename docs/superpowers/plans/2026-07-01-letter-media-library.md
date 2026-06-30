# Letter Image Media Library (R2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only image library: upload raster images to Cloudflare R2 and embed their public URLs in letter bodies.

**Architecture:** A stateless R2 client wrapping the S3 SDK + a pure byte-sniffing validator; a `letter_media_assets` table as source of truth (public URL derived on read); three `requireAdmin` endpoints added to the existing `admin-letter-assets` router; a Media panel in the admin Letters page that copies an `<img>` snippet into the raw-HTML body textarea.

**Tech Stack:** Express 5, `@aws-sdk/client-s3` (already a dependency), `multer` (new), Drizzle + Postgres/pglite, React 18, Vitest + supertest.

## Global Constraints

- Allowed image types: **PNG, JPEG, WebP, GIF only**. SVG and all else rejected. Validate by **sniffing magic bytes**, never the client-declared MIME or filename.
- Max upload size: **5 MB**.
- Object key: server-generated **UUID + sniffed extension**, under the **`letters/`** prefix. Never derive the key from the user's filename.
- R2 env vars (already on the Render backend): `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (=`prod`), `R2_PUBLIC_BASE_URL` (region is `auto`).
- Public URL is **derived on read** via `r2-client.publicUrl(key)` — never stored in the DB.
- All endpoints are `requireAdmin`, added to `server/routes/admin-letter-assets.ts` (already mounted at `/api/admin/letters`).
- Tests never touch real R2 or the network — mock `@aws-sdk/client-s3` / the `r2-client` module. DB tests use `setupTestDb()` (pglite).

---

### Task 1: R2 client service

**Files:**
- Create: `server/services/r2-client.ts`
- Test: `tests/server/r2-client.test.ts`

**Interfaces:**
- Produces: `isConfigured(): boolean`, `publicUrl(key: string): string`, `putObject(key: string, body: Buffer, contentType: string): Promise<void>`, `deleteObject(key: string): Promise<void>`, `class R2NotConfiguredError extends Error`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/r2-client.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const sendMock = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn((input) => ({ __type: 'Put', input })),
  DeleteObjectCommand: vi.fn((input) => ({ __type: 'Delete', input })),
}))

import * as r2 from '../../server/services/r2-client'

const ENV = { ...process.env }
beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({})
  process.env.R2_ENDPOINT = 'https://acc.r2.cloudflarestorage.com'
  process.env.R2_ACCESS_KEY_ID = 'k'
  process.env.R2_SECRET_ACCESS_KEY = 's'
  process.env.R2_BUCKET = 'prod'
  process.env.R2_PUBLIC_BASE_URL = 'https://pub-x.r2.dev/'
})
afterEach(() => { process.env = { ...ENV } })

describe('r2-client', () => {
  it('isConfigured true when all env present, false when one missing', () => {
    expect(r2.isConfigured()).toBe(true)
    delete process.env.R2_BUCKET
    expect(r2.isConfigured()).toBe(false)
  })

  it('publicUrl joins base + key and strips a trailing slash on the base', () => {
    expect(r2.publicUrl('letters/abc.png')).toBe('https://pub-x.r2.dev/letters/abc.png')
  })

  it('putObject sends a PutObjectCommand with bucket/key/body/content-type', async () => {
    await r2.putObject('letters/abc.png', Buffer.from([1, 2, 3]), 'image/png')
    expect(sendMock).toHaveBeenCalledTimes(1)
    const cmd = sendMock.mock.calls[0][0]
    expect(cmd.input).toMatchObject({ Bucket: 'prod', Key: 'letters/abc.png', ContentType: 'image/png' })
  })

  it('throws R2NotConfiguredError when env missing', async () => {
    delete process.env.R2_ACCESS_KEY_ID
    await expect(r2.putObject('k', Buffer.from([1]), 'image/png')).rejects.toBeInstanceOf(r2.R2NotConfiguredError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/r2-client.test.ts`
Expected: FAIL — cannot find module `server/services/r2-client`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/services/r2-client.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

export class R2NotConfiguredError extends Error {
  constructor() {
    super('R2 is not configured (missing R2_* env vars)')
    this.name = 'R2NotConfiguredError'
  }
}

const REQUIRED = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'] as const

export function isConfigured(): boolean {
  return REQUIRED.every((k) => !!process.env[k])
}

// Constructed per call (low-volume admin tool) so tests can toggle env freely.
function client(): S3Client {
  if (!isConfigured()) throw new R2NotConfiguredError()
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export function publicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) throw new R2NotConfiguredError()
  return `${base.replace(/\/$/, '')}/${key}`
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }))
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/r2-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/r2-client.ts tests/server/r2-client.test.ts
git commit -m "feat(letters): R2 client service for media uploads"
```

---

### Task 2: Image byte-sniff validator

**Files:**
- Create: `server/services/image-validator.ts`
- Test: `tests/server/image-validator.test.ts`

**Interfaces:**
- Produces: `MAX_IMAGE_BYTES: number`; `validateImage(buf: Buffer): { ok: boolean; contentType?: string; ext?: string; reason?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/image-validator.test.ts
import { describe, it, expect } from 'vitest'
import { validateImage, MAX_IMAGE_BYTES } from '../../server/services/image-validator'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const gif = Buffer.from('GIF89a___', 'ascii')
const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')])
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')

describe('validateImage', () => {
  it('accepts PNG/JPEG/GIF/WebP by magic bytes', () => {
    expect(validateImage(png)).toMatchObject({ ok: true, contentType: 'image/png', ext: 'png' })
    expect(validateImage(jpeg)).toMatchObject({ ok: true, contentType: 'image/jpeg', ext: 'jpg' })
    expect(validateImage(gif)).toMatchObject({ ok: true, contentType: 'image/gif', ext: 'gif' })
    expect(validateImage(webp)).toMatchObject({ ok: true, contentType: 'image/webp', ext: 'webp' })
  })

  it('rejects SVG and other content', () => {
    expect(validateImage(svg).ok).toBe(false)
    expect(validateImage(Buffer.from('hello world')).ok).toBe(false)
  })

  it('rejects buffers over the size cap', () => {
    const big = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES + 1)])
    expect(validateImage(big)).toMatchObject({ ok: false, reason: 'too large' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/image-validator.test.ts`
Expected: FAIL — cannot find module `image-validator`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/services/image-validator.ts
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ImageValidation {
  ok: boolean
  contentType?: string
  ext?: string
  reason?: string
}

export function validateImage(buf: Buffer): ImageValidation {
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too large' }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ok: true, contentType: 'image/png', ext: 'png' }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ok: true, contentType: 'image/jpeg', ext: 'jpg' }
  }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) {
    return { ok: true, contentType: 'image/gif', ext: 'gif' }
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ok: true, contentType: 'image/webp', ext: 'webp' }
  }
  return { ok: false, reason: 'unsupported type' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/image-validator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/image-validator.ts tests/server/image-validator.test.ts
git commit -m "feat(letters): magic-byte image validator (raster-only, 5MB)"
```

---

### Task 3: DB table, migration, repository, shared type

**Files:**
- Modify: `server/db/schema/letters.ts` (add `letterMediaAssets` table)
- Create: `server/repositories/letter-media-assets-repository.ts`
- Modify: `src/types.ts` (add `LetterMediaAsset`)
- Create (generated): `server/db/migrations/0022_*.sql`
- Test: `tests/server/letter-media-assets-repository.test.ts`

**Interfaces:**
- Consumes: `db` from `server/db/client`, `lettersSchema`/`users` already imported in `letters.ts`.
- Produces: table `letterMediaAssets`; `class LetterMediaAssetsRepository` with `list()`, `getById(id)`, `create(input)`, `delete(id)`; row type `LetterMediaAssetRow = typeof letterMediaAssets.$inferSelect`; client type `LetterMediaAsset`.

- [ ] **Step 1: Add the table to the schema**

In `server/db/schema/letters.ts`, append (the imports `serial, integer, text, timestamp`, `lettersSchema`, and `users` already exist at the top of the file):

```ts
export const letterMediaAssets = lettersSchema.table('letter_media_assets', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `server/db/migrations/0022_*.sql` creating `letters.letter_media_assets`. (`setupTestDb()` runs migrations, so this file must exist before the test passes.)

- [ ] **Step 3: Add the shared client type**

In `src/types.ts`, near the other `Letter*` interfaces:

```ts
export interface LetterMediaAsset {
  id: number
  key: string
  url: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedBy: number | null
  createdAt: string
}
```

- [ ] **Step 4: Write the failing repository test**

```ts
// tests/server/letter-media-assets-repository.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letterMediaAssets } from '../../server/db/schema'
import { LetterMediaAssetsRepository } from '../../server/repositories/letter-media-assets-repository'

const repo = new LetterMediaAssetsRepository()

describe('LetterMediaAssetsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterMediaAssets) })

  it('creates, lists newest-first, gets by id, and deletes', async () => {
    const a = await repo.create({ key: 'letters/a.png', filename: 'a.png', contentType: 'image/png', sizeBytes: 10, uploadedBy: null })
    const b = await repo.create({ key: 'letters/b.png', filename: 'b.png', contentType: 'image/png', sizeBytes: 20, uploadedBy: null })

    const list = await repo.list()
    expect(list.map((r) => r.key)).toEqual(['letters/b.png', 'letters/a.png'])

    expect((await repo.getById(a.id))?.key).toBe('letters/a.png')

    await repo.delete(b.id)
    expect((await repo.list()).map((r) => r.key)).toEqual(['letters/a.png'])
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/server/letter-media-assets-repository.test.ts`
Expected: FAIL — cannot find module `letter-media-assets-repository`.

- [ ] **Step 6: Write the repository**

```ts
// server/repositories/letter-media-assets-repository.ts
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/client'
import { letterMediaAssets } from '../db/schema'

export type LetterMediaAssetRow = typeof letterMediaAssets.$inferSelect

export class LetterMediaAssetsRepository {
  async list(): Promise<LetterMediaAssetRow[]> {
    return db.select().from(letterMediaAssets).orderBy(desc(letterMediaAssets.createdAt), desc(letterMediaAssets.id))
  }

  async getById(id: number): Promise<LetterMediaAssetRow | null> {
    const [row] = await db.select().from(letterMediaAssets).where(eq(letterMediaAssets.id, id))
    return row ?? null
  }

  async create(input: {
    key: string; filename: string; contentType: string; sizeBytes: number; uploadedBy: number | null
  }): Promise<LetterMediaAssetRow> {
    const [row] = await db.insert(letterMediaAssets).values(input).returning()
    return row
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterMediaAssets).where(eq(letterMediaAssets.id, id))
  }
}
```

(The secondary `desc(id)` tiebreaks rows created in the same transaction/timestamp so `list()` order is deterministic in tests.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/server/letter-media-assets-repository.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/db/schema/letters.ts server/db/migrations/ server/repositories/letter-media-assets-repository.ts src/types.ts tests/server/letter-media-assets-repository.test.ts
git commit -m "feat(letters): letter_media_assets table + repository"
```

---

### Task 4: Upload/list/delete API endpoints

**Files:**
- Modify: `server/routes/admin-letter-assets.ts` (add `/media` routes)
- Install: `multer`, `@types/multer`
- Test: `tests/server/admin-letter-media-route.test.ts`

**Interfaces:**
- Consumes: `r2.isConfigured/publicUrl/putObject/deleteObject` (Task 1), `validateImage` (Task 2), `LetterMediaAssetsRepository` (Task 3).
- Produces: `GET /api/admin/letters/media → { assets: LetterMediaAsset[] }`; `POST /api/admin/letters/media` (multipart `file`) → `201 { asset }`; `DELETE /api/admin/letters/media/:id → { ok }`.

- [ ] **Step 1: Install multer**

Run: `npm install multer && npm install -D @types/multer`
Expected: both added to `package.json`.

- [ ] **Step 2: Write the failing route test**

```ts
// tests/server/admin-letter-media-route.test.ts
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letterMediaAssets } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'

vi.mock('../../server/services/r2-client', () => ({
  isConfigured: vi.fn(() => true),
  publicUrl: (key: string) => `https://pub-x.r2.dev/${key}`,
  putObject: vi.fn().mockResolvedValue(undefined),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  R2NotConfiguredError: class extends Error {},
}))

import * as r2 from '../../server/services/r2-client'
import adminLetterAssetsRouter from '../../server/routes/admin-letter-assets'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLetterAssetsRouter)

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
let adminToken: string
let memberToken: string

async function mkUser(email: string, role: string) {
  const [u] = await db.insert(users).values({ label: email, email, role, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}

describe('admin letter media routes', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    vi.clearAllMocks()
    ;(r2.isConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true)
    await db.delete(letterMediaAssets); await db.delete(refreshTokens); await db.delete(users)
    const adminId = await mkUser('admin@x.com', 'admin')
    const memberId = await mkUser('member@x.com', 'member')
    adminToken = issueAccessToken({ id: adminId, email: 'admin@x.com', name: 'A', role: 'admin' })
    memberToken = issueAccessToken({ id: memberId, email: 'member@x.com', name: 'M', role: 'member' })
  })

  it('401 anonymous, 403 member', async () => {
    expect((await request(app).get('/api/admin/letters/media')).status).toBe(401)
    expect((await request(app).get('/api/admin/letters/media').set('Authorization', `Bearer ${memberToken}`)).status).toBe(403)
  })

  it('uploads a PNG and returns the asset with a public url', async () => {
    const res = await request(app)
      .post('/api/admin/letters/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', png, 'logo.png')
    expect(res.status).toBe(201)
    expect(res.body.asset.url).toMatch(/^https:\/\/pub-x\.r2\.dev\/letters\/.+\.png$/)
    expect(r2.putObject).toHaveBeenCalledTimes(1)
    expect((await request(app).get('/api/admin/letters/media').set('Authorization', `Bearer ${adminToken}`)).body.assets).toHaveLength(1)
  })

  it('400 for a non-image (SVG bytes)', async () => {
    const res = await request(app)
      .post('/api/admin/letters/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('<svg></svg>'), 'x.svg')
    expect(res.status).toBe(400)
    expect(r2.putObject).not.toHaveBeenCalled()
  })

  it('503 when R2 is not configured', async () => {
    ;(r2.isConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const res = await request(app).get('/api/admin/letters/media').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(503)
  })

  it('deletes an asset (R2 + row)', async () => {
    const up = await request(app).post('/api/admin/letters/media').set('Authorization', `Bearer ${adminToken}`).attach('file', png, 'logo.png')
    const del = await request(app).delete(`/api/admin/letters/media/${up.body.asset.id}`).set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)
    expect(r2.deleteObject).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-letter-media-route.test.ts`
Expected: FAIL — routes return 404 (not yet defined).

- [ ] **Step 4: Add the routes**

At the top of `server/routes/admin-letter-assets.ts`, add imports:

```ts
import multer from 'multer'
import { randomUUID } from 'crypto'
import { LetterMediaAssetsRepository } from '../repositories/letter-media-assets-repository'
import * as r2 from '../services/r2-client'
import { validateImage } from '../services/image-validator'
import type { LetterMediaAssetRow } from '../repositories/letter-media-assets-repository'
```

After the existing repo instances, add:

```ts
const mediaRepo = new LetterMediaAssetsRepository()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// Wrap multer so a too-large/invalid upload is a 400, not a thrown 500.
const uploadSingle = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code
      return res.status(400).json({ error: code === 'LIMIT_FILE_SIZE' ? 'file too large (max 5MB)' : 'upload failed' })
    }
    next()
  })

function toAsset(row: LetterMediaAssetRow) {
  return { ...row, url: r2.publicUrl(row.key) }
}
```

Then add the handlers (before `export default router`):

```ts
// --- Media (R2-hosted letter images) ---

router.get('/media', async (_req, res) => {
  if (!r2.isConfigured()) return res.status(503).json({ error: 'R2 not configured' })
  const rows = await mediaRepo.list()
  res.json({ assets: rows.map(toAsset) })
})

router.post('/media', uploadSingle, async (req, res) => {
  if (!r2.isConfigured()) return res.status(503).json({ error: 'R2 not configured' })
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required' })
  const v = validateImage(file.buffer)
  if (!v.ok) return res.status(400).json({ error: v.reason ?? 'invalid image' })
  const key = `letters/${randomUUID()}.${v.ext}`
  await r2.putObject(key, file.buffer, v.contentType!)
  const row = await mediaRepo.create({
    key,
    filename: file.originalname,
    contentType: v.contentType!,
    sizeBytes: file.size,
    uploadedBy: req.user?.id ?? null, // req.user is attached by requireAuth (Express.Request augmentation in server/middleware/auth.ts)
  })
  res.status(201).json({ asset: toAsset(row) })
})

router.delete('/media/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' })
  const row = await mediaRepo.getById(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  try {
    await r2.deleteObject(row.key)
  } catch (err) {
    console.error('[media] R2 delete failed (orphaned object):', err) // still remove the row
  }
  await mediaRepo.delete(id)
  res.json({ ok: true })
})
```

If `req.user?.id` is a type error, confirm the augmentation exists in `server/middleware/auth.ts`; if `req.user` is typed elsewhere, use that type. Do not invent a new global augmentation.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-letter-media-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin-letter-assets.ts package.json package-lock.json tests/server/admin-letter-media-route.test.ts
git commit -m "feat(letters): media upload/list/delete API endpoints"
```

---

### Task 5: api-client methods + admin Media panel

**Files:**
- Modify: `src/lib/api-client.ts` (add `admin.letters.media`, import `LetterMediaAsset`)
- Create: `src/components/letters/MediaPanel.tsx`
- Modify: `src/pages/AdminLettersPage.tsx` (render `<MediaPanel />`)
- Test: `tests/components/MediaPanel.test.tsx`

**Interfaces:**
- Consumes: `LetterMediaAsset` (Task 3), the `/media` endpoints (Task 4).
- Produces: `api.admin.letters.media.list()/upload(file)/delete(id)`; `<MediaPanel />`.

- [ ] **Step 1: Add the api-client methods**

In `src/lib/api-client.ts`, add `LetterMediaAsset` to the type import on line 1. Inside the `admin.letters` object (sibling to `letterTemplates`), add:

```ts
      media: {
        list: () => apiFetch<{ assets: LetterMediaAsset[] }>('/admin/letters/media'),
        delete: (id: number) =>
          apiFetch<{ ok: boolean }>(`/admin/letters/media/${id}`, { method: 'DELETE' }),
        upload: async (file: File): Promise<{ asset: LetterMediaAsset }> => {
          const fd = new FormData()
          fd.append('file', file)
          // Multipart must NOT set Content-Type (the browser sets the boundary), so this
          // bypasses apiFetch's JSON wrapper and attaches the token directly.
          const res = await fetch(`${API_BASE}/admin/letters/media`, {
            method: 'POST',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: fd,
          })
          if (!res.ok) {
            const b = (await res.json().catch(() => ({}))) as { error?: string }
            const e = new Error(b.error ?? `API error ${res.status}`) as Error & { status?: number }
            e.status = res.status
            throw e
          }
          return res.json() as Promise<{ asset: LetterMediaAsset }>
        },
      },
```

- [ ] **Step 2: Write the failing component test**

```tsx
// tests/components/MediaPanel.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { list, upload, del } = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), del: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ api: { admin: { letters: { media: { list, upload, delete: del } } } } }))

import MediaPanel from '@/components/letters/MediaPanel'

const asset = { id: 1, key: 'letters/a.png', url: 'https://pub-x.r2.dev/letters/a.png', filename: 'a.png', contentType: 'image/png', sizeBytes: 10, uploadedBy: null, createdAt: '2026-07-01T00:00:00Z' }

describe('MediaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    list.mockResolvedValue({ assets: [asset] })
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('lists existing assets', async () => {
    render(<MediaPanel />)
    expect(await screen.findByText('a.png')).toBeInTheDocument()
  })

  it('copies an <img> snippet for an asset', async () => {
    render(<MediaPanel />)
    await screen.findByText('a.png')
    await userEvent.click(screen.getByRole('button', { name: /snippet/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '<img src="https://pub-x.r2.dev/letters/a.png" alt="" style="max-width:100%" />'
    )
  })

  it('uploads a file and shows the new asset', async () => {
    const created = { ...asset, id: 2, filename: 'b.png', url: 'https://pub-x.r2.dev/letters/b.png' }
    upload.mockResolvedValue({ asset: created })
    render(<MediaPanel />)
    await screen.findByText('a.png')
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'b.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('media-file-input'), file)
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file))
    expect(await screen.findByText('b.png')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/MediaPanel.test.tsx`
Expected: FAIL — cannot find module `@/components/letters/MediaPanel`.

- [ ] **Step 4: Write the MediaPanel component**

```tsx
// src/components/letters/MediaPanel.tsx
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import type { LetterMediaAsset } from '@/types'

function snippetFor(url: string): string {
  return `<img src="${url}" alt="" style="max-width:100%" />`
}

export default function MediaPanel() {
  const [assets, setAssets] = useState<LetterMediaAsset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  useEffect(() => {
    api.admin.letters.media.list().then((r) => setAssets(r.assets)).catch((e) => setError(String(e?.message ?? e)))
  }, [])

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError(null)
    try {
      const { asset } = await api.admin.letters.media.upload(file)
      setAssets((prev) => [asset, ...prev])
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const onCopy = async (a: LetterMediaAsset) => {
    await navigator.clipboard.writeText(snippetFor(a.url))
    setCopiedId(a.id)
    setTimeout(() => setCopiedId((id) => (id === a.id ? null : id)), 1500)
  }

  const onDelete = async (a: LetterMediaAsset) => {
    if (!window.confirm('Delete this image? Letters already using it will show a broken image.')) return
    await api.admin.letters.media.delete(a.id)
    setAssets((prev) => prev.filter((x) => x.id !== a.id))
  }

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">Media</h3>
      <input data-testid="media-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={onUpload} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {assets.map((a) => (
          <div key={a.id} className="rounded border p-2 text-xs">
            <img src={a.url} alt={a.filename} className="mb-1 h-24 w-full object-contain" />
            <p className="truncate" title={a.filename}>{a.filename}</p>
            <p className="text-muted-foreground">{Math.round(a.sizeBytes / 1024)} KB</p>
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => onCopy(a)} className="text-primary hover:underline">
                {copiedId === a.id ? 'Copied!' : 'Copy <img> snippet'}
              </button>
              <button type="button" onClick={() => onDelete(a)} className="text-red-500 hover:underline">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/MediaPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Render it in the admin page**

In `src/pages/AdminLettersPage.tsx`, import and render the panel near the Templates section:

```tsx
import MediaPanel from '@/components/letters/MediaPanel'
// …in the JSX, as a sibling block to the Templates section:
<MediaPanel />
```

- [ ] **Step 7: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/lib/api-client.ts src/components/letters/MediaPanel.tsx src/pages/AdminLettersPage.tsx tests/components/MediaPanel.test.tsx
git commit -m "feat(letters): admin Media panel + api-client upload methods"
```

---

### Task 6: Config example + docs

**Files:**
- Modify: `.env.example`
- Modify: `docs/architecture.md`, `docs/components.md`, `CLAUDE.md`

- [ ] **Step 1: Document the env vars**

Append to `.env.example`:

```bash
# Cloudflare R2 — letter image media library (admin upload → public-read images).
# region is always "auto". R2_PUBLIC_BASE_URL must be a PUBLIC object origin
# (https://pub-<hash>.r2.dev or a custom domain) — NOT the Cloudflare dashboard URL.
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=prod
R2_PUBLIC_BASE_URL=
```

- [ ] **Step 2: Update docs**

- `CLAUDE.md` API table — add: `GET/POST /api/admin/letters/media`, `DELETE /api/admin/letters/media/:id` (admin; R2-hosted letter images; 503 when R2 unconfigured).
- `docs/architecture.md` — a short "R2 media (letter images)" subsection: `r2-client` service, `letter_media_assets` table (public URL derived on read), byte-sniff validation, the operator prerequisite (public bucket + real `R2_PUBLIC_BASE_URL`), and that images render only in the copy-rich/preview paths.
- `docs/components.md` — add `MediaPanel` (admin-only; upload + copy `<img>` snippet + delete).

- [ ] **Step 3: Full gate**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass; lint shows no new errors.

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/architecture.md docs/components.md CLAUDE.md
git commit -m "docs(letters): R2 media library env + docs"
```

---

## Post-implementation (operator, not code)

1. Enable public access on the `prod` R2 bucket (r2.dev URL or custom domain).
2. Set `R2_PUBLIC_BASE_URL` to that real public origin on the Render service (and locally in `.env`).
3. Rotate the R2 API token (the secret was shared in a chat transcript during env setup).
