# Letter Image Media Library (R2-hosted) — Design Spec

**Date:** 2026-07-01
**Status:** Approved design — pending spec review
**Depends on:** existing Letters feature (`2026-06-14-letters-design.md`), R2 env vars provisioned on the backend

## Goal

Let admins upload raster images (logo, banner, infographic) into a managed library and embed them in letter bodies. Images are stored in Cloudflare R2 and referenced by a public URL, so they render when the shared letter is opened.

## Scope & Reach (read this first — it bounds the value)

Letters are sent from `LetterDetailPage` via four actions. They are **not** equal on HTML/images:

| Send action | Body carried | Images render? |
|---|---|---|
| mailto (`buildMailtoUrl`) | `bodyPlain` (plain text) | No — never |
| Open in Gmail (`buildGmailComposeUrl`) | `bodyPlain` (plain text) | No — never |
| Copy as rich HTML (clipboard `text/html`) | full HTML | **Yes**, if `<img src>` is a public URL |
| Open in new tab (Blob preview) | rendered HTML | Yes (preview only) |

**Therefore this feature only benefits the "Copy rich → paste into Gmail" path and the new-tab/admin preview.** The two one-click "send" paths send plain text and show no images regardless. This is an intentional, accepted limitation — it does not change how mass-sending works (one published letter, many members each sending from their own inbox; analytics count sends). This project adds image *richness* to the copy-paste path; it is not the mass-send mechanism.

## Prerequisite (operator action — not a code task)

For images to display, the `prod` R2 bucket must be **publicly readable** and `R2_PUBLIC_BASE_URL` must point at the real public origin:

- Cloudflare managed dev URL: `https://pub-<hash>.r2.dev`, **or**
- a custom domain mapped to the bucket (e.g. `media.likudliberal.org`).

The value provided during env setup was the Cloudflare dashboard URL, which is **not** a public object origin and must be replaced. Until `R2_PUBLIC_BASE_URL` is a real public base, uploads succeed but images will not load.

Already set on the Render service: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET=prod`.

## Architecture

```
AdminLettersPage (Media panel)
  │  upload (multipart)          browse / copy-snippet / delete
  ▼                                       ▲
POST /api/admin/letters/media   GET·DELETE /api/admin/letters/media[/:id]
  │  validate (byte-sniff, ≤5MB)          │
  ▼                                       │
r2-client.ts  ──putObject──▶ R2 (prefix letters/)   letter_media_assets (DB, source of truth)
  └ publicUrl(key) = `${R2_PUBLIC_BASE_URL}/${key}`
```

Admin pastes the returned `<img src="…">` snippet into the letter body `<textarea>` (the body editor is raw HTML, not WYSIWYG).

### Units

1. **`server/services/r2-client.ts`** — wraps one `S3Client`. Builds config from env (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, region `auto`, bucket `R2_BUCKET`). Exposes:
   - `putObject(key, bytes, contentType): Promise<void>`
   - `deleteObject(key): Promise<void>`
   - `publicUrl(key): string` → `` `${R2_PUBLIC_BASE_URL}/${key}` ``
   - `isConfigured(): boolean` — false when any required env is missing.
   If unconfigured, methods throw `R2NotConfiguredError` so the route returns 503 instead of crashing. Local dev/tests never construct a live client.

2. **`server/services/image-validator.ts`** — sniffs magic bytes and returns `{ ok, contentType, ext }` for PNG/JPEG/WebP/GIF; rejects everything else (incl. SVG). Pure, unit-testable, no I/O.

3. **DB table `letter_media_assets`** (in the `letters` schema, `server/db/schema/letters.ts`) + **`LetterMediaAssetsRepository`** mirroring `LetterTemplatesRepository`.

4. **Routes** — three handlers added to `server/routes/admin-letter-assets.ts` (mounted at `/api/admin/letters`, `requireAdmin`), per the file's existing convention ("add new asset sub-paths to adminLetterAssetsRouter only").

5. **Frontend** — a **Media** panel in `src/pages/AdminLettersPage.tsx` (sibling to Templates), plus an `api.admin.letters.media` client.

## Data Model — `letter_media_assets`

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `key` | text unique not null | R2 object key, `letters/<uuid>.<ext>` |
| `filename` | text not null | original name, display only |
| `content_type` | text not null | sniffed MIME |
| `size_bytes` | integer not null | |
| `uploaded_by` | integer → `users.id` (`on delete set null`) | |
| `created_at` | timestamptz not null default now | |

The public URL is **not stored** — it is derived on read via `r2-client.publicUrl(key)`. This is deliberate: `R2_PUBLIC_BASE_URL` is not yet final, and deriving on read means correcting the env later retroactively fixes every library entry (and the copy-snippet an admin pastes always reflects the current base). API responses include a computed `url` field on each asset.

New migration `0022_*.sql` generated via `npm run db:generate`; applies automatically on boot.

## API (all `requireAdmin`, base `/api/admin/letters`)

- **`POST /media`** — multipart single field `file` (add **multer**, memory storage, 5 MB limit).
  Flow: receive buffer → `image-validator` sniff → reject (400) if not allowed type / over size → generate `key = letters/<uuid>.<ext>` → `r2-client.putObject(key, buf, contentType)` → insert row → `201 { asset }`.
  503 if `!r2-client.isConfigured()`.
- **`GET /media`** — `200 { assets }`, newest first.
- **`DELETE /media/:id`** — load row → `r2-client.deleteObject(key)` → delete row → `200 { ok: true }`. R2 delete failure still removes the DB row but returns a warning flag (object becomes orphaned, not a user-facing break).

`type Letter*` additions go in `src/types.ts` (`LetterMediaAsset`), the single source of truth shared by client and server.

## Validation / Security

- **Byte-sniff** actual magic bytes; allowlist **PNG, JPEG, WebP, GIF**. SVG and all else → 400. Never trust the client-declared MIME or extension.
- **5 MB** cap at multer and re-checked on the buffer.
- Object key is a **server-generated UUID** + extension derived from the sniffed type — the user's filename never forms the key (no key/path injection).
- `Content-Type` on the R2 object is set from the sniff so the public origin serves correct headers.
- Admin-only (`requireAdmin`), consistent with all other letter-asset routes.
- Note: R2 objects are world-readable by design (required for email rendering). Do not upload anything sensitive. This is inherent to the public-bucket model, not a defect.

## Frontend — Media panel in `AdminLettersPage`

- File picker / drop zone → `POST /media` → prepend the new asset to the grid.
- Grid of assets: thumbnail, filename, size, date.
- Per asset: **"Copy `<img>` snippet"** (primary) → copies `<img src="<url>" alt="" style="max-width:100%">` to the clipboard for pasting into the body `<textarea>`; and **Delete** (with a confirm dialog warning that any letter already using the image will show a broken image).
- The body editor stays a raw-HTML `<textarea>` + iframe preview; no editor framework is introduced.

## Delete Semantics (decided)

Hard delete (R2 object + DB row). Letter bodies are freeform HTML and are **not** reference-counted, so the delete confirm warns: "letters already using this image will show a broken image." No usage tracking in v1.

## Testing

- `tests/server/image-validator.test.ts` — accepts PNG/JPEG/WebP/GIF magic bytes; rejects SVG, oversize, and bytes whose content contradicts the declared type.
- `tests/server/r2-client.test.ts` — `publicUrl` composition; `isConfigured` gating; methods throw when unconfigured (S3 `send` mocked; no network).
- `tests/server/admin-letter-media-route.test.ts` — upload happy path (S3 + repo mocked), 400 on bad type/oversize, 503 when R2 unconfigured, list, delete. Consistent with the pglite/no-network test setup.
- `tests/components/AdminLettersMedia.test.tsx` — panel renders the list, upload calls the API and shows the new thumbnail, copy-snippet yields the correct `<img>` string.

## Out of Scope (YAGNI)

Image editing/cropping/resizing; reference-counting / orphan GC; member-facing uploads (admin-only); presigned direct-to-R2 uploads; CDN cache purge on delete; changing the mailto/Gmail send paths to carry HTML.

## Operator Checklist (before the feature is useful in production)

1. Enable public access on the `prod` bucket (r2.dev URL or custom domain).
2. Set `R2_PUBLIC_BASE_URL` to that real public origin on the Render service.
3. (Recommended) Rotate the R2 API token — the secret was shared in a chat transcript during env setup.
