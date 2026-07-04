# Public Per-Letter Send Pages — Design Spec

**Date:** 2026-07-04
**Status:** Approved design — pending spec review

## Motivation

The metric that matters is **the number of letters actually sent to MKs**. Make each published letter shareable via a **public link anyone can open without registering**, read the letter, and **send it from their own email client in a couple of clicks** — with a **preview image** so the link is compelling when pasted into WhatsApp/social. Sends from the public page are counted **separately** from in-app member sends.

## Problem with today's implementation

The current R2 "share page" is a **dead end**: it only *previews* the letter, and its single call-to-action bounces the visitor **back into the login-gated app** to actually send. A stranger who taps a shared link hits a **sign-in wall** before they can send — directly suppressing the one number we care about. This spec turns the shared page into the **send surface itself**.

## Approach (locked): A — static R2 send page

Social link-preview crawlers (WhatsApp/Facebook/X) do a plain `GET` and parse `og:` meta from the **raw HTML** — they do not run JavaScript. So per-letter preview metadata must live in server-produced HTML. A static page generated to R2 satisfies that, loads instantly from the CDN, scales without limit, and never cold-starts (unlike the free-tier Render backend). Content staleness between edits is acceptable (small scale, integrity non-critical) and self-heals via the existing regenerate-on-edit hook.

Rejected: **B** (server-rendered Express route) — every open hits the free-tier backend → ~30–60 s cold start on shared links + a single-instance bottleneck exactly under viral load. **C** (SPA route) — cannot serve per-letter OG meta to non-JS crawlers, so the preview image would not work. The **hybrid** (static shell + client hydration) is a valid future upgrade but solves *content freshness*, which is explicitly not needed here.

## Scope

**In:** evolve the R2 page into a public send page; fix the OG-card reversed-Hebrew; add a public send-tracking endpoint with separate counters; group member-vs-public sends in the admin analytics.

**Out:** the project-wide **RTL audit** across other features (separate effort — the OG card is the only RTL item here); any change to the authenticated in-app letters flow; the hybrid live-fetch.

## Locked decisions

- Static R2 page (A).
- Public sends recorded into **separate buckets**: `public_mailto` / `public_gmail` / `public_copy` (distinct from member `mailto` / `copy`).
- Use **`bidi-js`** to fix the OG card (not a naive string reverse).
- Include the admin **member-vs-public** grouping in this spec.

## Architecture

```
letter publish/edit  ──share-publisher hook──▶  renderShareHtml + renderShareImage
                                                      │  (bidi-reordered card)
                                                      ▼
                                        R2:  letter/{id}.html  +  letter/{id}.png
                                                      │  (public CDN)
   stranger taps link ──GET──▶ static send page (no login)
        │  reads letter · clicks mailto / Gmail / copy
        └── sendBeacon ──▶ POST /api/public/letters/:id/send  ──▶ analyticsRepo.record(id, 'public_'+action)
                                                                        │
                                          admin dashboard ◀── member vs public breakdown
```

## Components

### 1. Public send page — `server/services/share-renderer.ts` › `renderShareHtml`

Evolve the preview into a self-contained send page:
- **`<head>`:** existing OG/Twitter meta (title, description, `og:image` → the PNG), `dir="rtl"`, canonical.
- **Body:** letter title, recipients ("אל: …"), issue tags, the stored (already-sanitized) letter body, the existing privacy note, and a **non-blocking** "learn more / join" link to the main site (never a login wall).
- **Send controls — three actions**, hrefs generated server-side by reusing the existing pure builders `buildMailtoUrl` / `buildGmailComposeUrl` (`src/lib/letter-urls.ts`, re-exported by `server/services/letter-utils.ts`):
  - **מייל (mailto):** `<a href="mailto:…?cc/bcc/subject/body">` — opens the visitor's mail app pre-filled (plain-text body per RFC 6068).
  - **Gmail:** `<a href="https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…" target="_blank" rel="noopener">`.
  - **העתק (copy):** copies the **rich HTML** letter to the clipboard for pasting into any webmail.
- **Inline JS (~15 lines, no framework):** the copy-button handler (Clipboard API with a `text/plain` fallback) + a `navigator.sendBeacon(...)` tracking call fired on each send button click. `sendBeacon` is used because it is a "simple" cross-origin request that isn't blocked by CORS (we never read a response) and survives the page navigating away when `mailto:` opens.

*Inherent limit (unchanged, same as in-app):* one-click mailto/Gmail bodies are plain text (protocol limit); rich formatting only via **copy**.

### 2. OG card bidi fix — `renderShareImage` + `bidi-js`

satori does not implement the Unicode Bidirectional Algorithm, so Hebrew is laid out in logical order → reversed. Fix: reorder each card string to **visual order** with `bidi-js` *before* passing it to satori. Applies to the three short card strings (org wordmark, letter title, CTA line). A naive reverse is rejected — titles mix Hebrew with digits/Latin (e.g. `חוק 123`), which a blind reverse corrupts; the bidi algorithm keeps LTR runs intact. Extract a small pure helper `toVisualOrder(s: string): string` (unit-testable) and apply it to each `children` string in the satori node.

### 3. Public tracking endpoint — new `server/routes/public-letters.ts`

- `POST /api/public/letters/:id/send`, mounted **outside** `requireAuth` (its own router registered before/without the auth middleware), gated by `lettersEnabled` **and** the letter existing with `status = 'published'`.
- Body `{ action: 'mailto' | 'gmail' | 'copy' }` → `analyticsRepo.record(id, 'public_' + action)`. Fire-and-forget: returns `204` quickly; invalid ids/actions are ignored (still `204`) so the beacon never surfaces errors.
- **CORS:** add the R2 public origin (derived from `R2_PUBLIC_BASE_URL`) to the `cors` allowlist for this route. (Belt-and-suspenders — `sendBeacon` already isn't CORS-blocked.)
- **Abuse consideration:** a public, unauthenticated counter can be inflated. For this scale, apply a **light per-IP + per-letter throttle** (reuse the existing rate-limit pattern used by `/api/summarize`) so a single client can't spam the metric; not a hard security boundary, just anti-noise.

### 4. Admin analytics grouping — `src/pages/AdminLettersPage.tsx` (per-letter stats display)

The dashboard already renders a per-letter **breakdown by bucket**. Group the buckets into **Member** (`mailto`, `copy`) and **Public** (`public_mailto`, `public_gmail`, `public_copy`), showing each subtotal plus the combined total, so the primary metric (public sends) is legible at a glance. Display-only; no API/schema change.

### 5. Lifecycle — `server/services/share-publisher.ts` (existing hooks)

Unchanged control flow: `syncShareForLetter` / `removeShareForLetter` already fire on letter create/update/delete and publish/remove the R2 objects. They now emit the fuller send page. Unpublish/delete removes the objects. Regeneration staleness is accepted.

## Data / analytics

No schema change — `analyticsSchema.letter_analytics.bucket` is free-form text. New bucket values: `public_mailto`, `public_gmail`, `public_copy`. Member buckets (`mailto`, `copy`) are untouched.

## Config / env

Reuses `R2_*` + `APP_PUBLIC_URL` (already present). The public route derives the CORS-allowed origin from `R2_PUBLIC_BASE_URL`. No new required env var.

## Known constraints

- **Plain-text one-click:** mailto/Gmail can't carry HTML; rich only via copy (protocol limit, unchanged).
- **Staleness:** the page is a snapshot regenerated on edit; brief eventual-consistency + CDN cache lag is accepted.
- **Public exposure:** the page shows the letter body and the MK recipient emails (public officials, public info by design). The **sender stays anonymous** — tracking is aggregate counts only (privacy note retained).
- **Bidi scope:** per-string reordering covers the card's short lines; it is not a general multi-line bidi solution (the card has no wrapped paragraphs).

## Testing

- `share-renderer`: the send page contains OG meta + correct `mailto`/Gmail hrefs + the copy/tracking JS; **`toVisualOrder`** unit-tested on pure-Hebrew and mixed Hebrew+digits/Latin strings.
- public route: records to `public_*` buckets; `204` and no record for unpublished/unknown ids; requires no auth; CORS header present for the R2 origin; throttle rejects rapid repeats from one IP.
- `share-publisher`: still regenerates on update and removes on delete/unpublish (existing tests hold).
- admin grouping: renders Member vs Public subtotals + total from a mixed bucket set.
