# Media Migration — Design Spec

**Date:** 2026-05-23
**Backlog item:** 7 — Media Migration (Fetch Event Photos from likudliberal.org)

## Problem

`gallery.json` contains 3 items whose `src` URLs point directly to `likudliberal.org`. If that server goes dark, all gallery images break. Additional images on the site (homepage slideshow, event gallery) have never been captured.

## Goal

One-time migration that:
1. Discovers all content images on `likudliberal.org` via Playwright
2. Downloads them into the repo under `public/images/gallery/`
3. Updates `gallery.json` to use local paths (empty captions; user fills in manually)

## Non-Goals

- Ongoing sync — this is a one-shot migration
- Auto-generating captions — captions are filled in manually after migration
- Cloud storage — images live in the repo for now; R2/S3 swap is a future step

## Script

**Location:** `scripts/migrate-media.ts`
**Invocation:** `npx tsx scripts/migrate-media.ts`

### Steps

1. Launch Playwright (Chromium), navigate to `https://likudliberal.org/`
2. Enable network interception — capture every image request URL as the page renders and the JS slideshow plays through
3. Discover gallery sub-pages by following internal links matching patterns like `/gallery`, `/תמונות`, `/אירועים`; repeat image capture on each
4. Collect all captured image URLs, keep only those matching `/wp-content/uploads/` — WordPress's media library path
5. Filter out:
   - `/wp-includes/` — WordPress core UI assets
   - `/wp-content/themes/` — theme assets
   - External domains (CDN embeds, social media)
   - Images under 10 KB — icons, bullets, thumbnails
6. Download each image to `public/images/gallery/` using the sanitized original filename (`[a-z0-9._-]`); append a counter on collision
7. Merge into `src/data/gallery.json`:
   - Existing entries whose `src` points to `likudliberal.org` → rewrite `src` to `/images/gallery/filename`
   - New images → append `{ id, src: "/images/gallery/filename", caption: "", captionEn: "", date: "<today>" }`
   - Entries already using local paths → leave unchanged
8. Print a summary: N images downloaded, N gallery.json entries updated, N new entries added

## Output

| Path | Description |
|------|-------------|
| `scripts/migrate-media.ts` | Migration script (kept for re-run) |
| `public/images/gallery/*.{jpg,png,webp}` | Downloaded images |
| `src/data/gallery.json` | Updated — local `src` paths, empty captions on new items |

## Future Cloud Storage Swap

No code abstraction is needed now. When migrating to Cloudflare R2 or S3:
- Upload `public/images/gallery/*` to the bucket
- Rewrite `src` values in `gallery.json` from `/images/gallery/...` to the CDN URL
- `GallerySection.tsx` requires no changes

## Testing

Run the script against the live site before it goes dark. Verify:
- All existing 3 gallery.json `src` URLs are rewritten to local paths
- Homepage slideshow images are captured (check the gallery in the browser after running)
- No WordPress theme assets appear in `public/images/gallery/`
- `npm test` still passes after the migration
