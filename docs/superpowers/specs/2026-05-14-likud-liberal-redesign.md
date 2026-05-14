# Likud Liberal Site — Full Redesign & Parliamentary Tracker

**Date:** 2026-05-14  
**Status:** Approved  
**Project:** `/home/aavitan/claude-projects/liberal-page`

---

## Overview

A full redesign of the Likud Liberal (הליברלים בליכוד) Jerusalem cell website. The site serves two purposes:

1. **Public-facing org page** — hero, who-we-are, gallery, FAQ, and hitkpakdut (joining) CTA.
2. **Parliamentary tracker** — the primary feature: follow specific Knesset bills, committees, and MK voting records using live data from oknesset.org, with AI-powered PDF/DOCX summarization.

Data layer is inline JSON files (no database). Runs locally. No user authentication in this phase.

---

## Architecture

### Stack

- **Frontend:** React 18 + TypeScript + Vite (existing)
- **UI library:** Tailwind CSS + shadcn/ui (replacing CSS modules)
- **Backend:** Express (TypeScript) running on port 3001, alongside Vite dev server
- **Dev runner:** `concurrently` — single `npm run dev` starts both Vite and Express
- **API proxy:** Vite proxies `/api/*` → `localhost:3001`

### Repo structure

```
liberal-page/
├── src/                        # React frontend
│   ├── components/
│   │   ├── layout/             # Header, Footer, ParliamentDrawer
│   │   ├── sections/           # Hero, AboutSection, GallerySection, FaqSection, JoinSection
│   │   ├── parliament/         # BillCard, CommitteeCard, MkCard, AddTrackingInput
│   │   └── ui/                 # shadcn/ui re-exports
│   ├── hooks/
│   │   ├── useDirection.ts     # reads document.documentElement.dir → 'rtl' | 'ltr'
│   │   └── useParliament.ts    # fetches /api/parliament/:type
│   ├── data/                   # JSON source of truth (read by frontend, written by server)
│   │   ├── bills.json
│   │   ├── committees.json
│   │   ├── mks.json
│   │   ├── summaries-cache.json
│   │   ├── site.json
│   │   ├── about.json
│   │   ├── gallery.json
│   │   └── faq.json
│   └── lib/
│       └── api-client.ts       # typed wrappers for /api/* calls
├── server/
│   ├── index.ts                # Express entry point, routes, poller init
│   ├── routes/
│   │   ├── tracking.ts         # POST /api/tracking/add, DELETE /api/tracking/:type/:id
│   │   ├── parliament.ts       # GET /api/parliament/:type
│   │   └── summarize.ts        # POST /api/summarize
│   └── services/
│       ├── oknesset.ts         # oknesset REST API client
│       ├── url-parser.ts       # URL → { type, id } extractor
│       ├── summarizer.ts       # Claude API + MD5 cache
│       └── poller.ts           # setInterval change-detection loop
├── BACKLOG.md                  # Tracked future work
├── vite.config.ts              # proxy /api → localhost:3001
└── package.json                # concurrently script
```

---

## Frontend: Page Structure

Single scrolling homepage (`/`). Sections top-to-bottom:

| Section | Component | Notes |
|---------|-----------|-------|
| Navbar | `Header` | Sticky. Logo + nav links + "מעקב כנסת ☰" drawer trigger button |
| Hero | `HeroSection` | Blue gradient, headline, tagline, two CTAs (join + open drawer) |
| Parliament strip | `ParliamentStrip` | Horizontal scroll of 3–5 status cards (live data); "לכל הנתונים ←" opens drawer |
| Who are we | `AboutSection` | 2 paragraphs + value tags (from `about.json`) |
| Gallery | `GallerySection` | Masonry/grid of images from `gallery.json` |
| FAQ | `FaqSection` | Accordion items from `faq.json` |
| Join / Hitkpakdut | `JoinSection` | Blue gradient CTA → external Likud registration link. `JoinForm` component built but inactive (see Backlog) |
| Footer | `Footer` | Party name, copyright |

### Parliamentary Drawer

- Triggered by the "מעקב כנסת ☰" button in the navbar and the "לכל הנתונים" link in the parliament strip.
- Full-height overlay panel, slides in from the **right** in RTL (Hebrew), from the **left** in LTR.
- Direction driven by `useDirection()` hook: reads `document.documentElement.dir`. No hardcoding.
- Three tabs: **הצ"ח** (Bills) · **ועדות** (Committees) · **ח"כים** (MKs)

**Add Tracking input** (top of drawer):
- Single text input: paste any URL from oknesset.org, knesset.gov.il, or gov.il
- `POST /api/tracking/add` → server parses URL, resolves metadata, appends to JSON
- Also accepts raw IDs (bill number, committee ID, MK ID)

**Card anatomy (all three tabs share this pattern):**
- Status color bar on the right edge (green = active/in-committee, orange = vote upcoming, grey = closed)
- Title + metadata (bill number / committee chair / MK party)
- AI summary block (collapsible, shown by default if summary exists)
- "צפה במקור ↗" link to original source
- Last-updated timestamp

**Footer:**
- "סנכרון אחרון: X" timestamp
- Manual "↻ רענן" refresh button → triggers `/api/parliament/:type` fetch

**New-data badge:**
- When the poller detects changes and sets `hasNewData: true` on any tracked item, the navbar "מעקב כנסת" button shows a blue dot badge until the drawer is opened.

---

## Backend

### Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tracking/add` | Parse URL/ID, fetch oknesset metadata, append to JSON |
| `DELETE` | `/api/tracking/:type/:id` | Remove tracked item from JSON |
| `GET` | `/api/parliament/:type` | Fetch fresh data for all tracked items of `type` (bills/committees/mks) |
| `POST` | `/api/summarize` | Download file, MD5 check, Claude summarize, cache result |

### Services

**`url-parser.ts`**  
Regex-based extractor. Supports:
- `oknesset.org/bill/<id>` → `{ type: 'bill', id }`
- `oknesset.org/mk/<id>` → `{ type: 'mk', id }`
- `main.knesset.gov.il/...?CommitteeId=<id>` → `{ type: 'committee', id }`
- `gov.il/...` ministerial committee pages → `{ type: 'committee', id }`
- Raw numeric IDs → prompted to choose type

**`oknesset.ts`**  
Typed REST client for the oknesset.org public API. Methods:
- `getBill(id)` → bill metadata + status + committee assignments
- `getCommittee(id)` → committee metadata + recent sessions
- `getMk(id)` → MK profile + recent votes

**`summarizer.ts`**  
1. Download file from URL (PDF or DOCX)
2. `crypto.createHash('md5').update(buffer).digest('hex')`
3. Check `summaries-cache.json` — if entry exists with matching MD5, return cached summary
4. Otherwise: extract text (`pdf-parse` for PDF, `mammoth` for DOCX)
5. Call Claude API (`claude-opus-4-7` or `claude-sonnet-4-6`) with Hebrew summarization prompt
6. Write `{ md5, summary, createdAt, sourceUrl }` to `summaries-cache.json`

**`poller.ts`**  
- Starts on server init
- `POLL_INTERVAL_MS` env var (default: `21600000` = 6 hours)
- Each tick: iterate all tracked items, fetch from oknesset, compare `updatedAt` / content hash
- On change: set `hasNewData: true` + `lastPolledAt` on the JSON entry
- Also checks MD5 of any linked document URLs; queues re-summarization if changed

---

## Data Schema

### `bills.json`
```json
[{
  "id": 1,
  "oknesset_id": "string",
  "number": "פ/1234",
  "title": "string",
  "status": "בוועדה | הצבעה קרובה | עבר | נדחה",
  "position": "תומכים | מתנגדים | עוקבים",
  "notes": "string",
  "committee": "string",
  "sourceUrl": "string",
  "documentUrl": "string | null",
  "hasNewData": false,
  "lastPolledAt": "ISO string"
}]
```

### `committees.json`
```json
[{
  "id": 1,
  "oknesset_id": "string",
  "name": "string",
  "chair": "string",
  "lastSessionDate": "ISO string",
  "lastSessionSummary": "string | null",
  "lastSessionDocumentUrl": "string | null",
  "sourceUrl": "string",
  "hasNewData": false,
  "lastPolledAt": "ISO string"
}]
```

### `mks.json`
```json
[{
  "id": 1,
  "oknesset_id": "string",
  "name": "string",
  "party": "string",
  "recentVotes": [{ "date": "ISO string", "billTitle": "string", "vote": "בעד | נגד | נמנע | נעדר" }],
  "votingSummary": "string | null",
  "sourceUrl": "string",
  "hasNewData": false,
  "lastPolledAt": "ISO string"
}]
```

### `summaries-cache.json`
```json
{
  "<md5-hex>": {
    "summary": "string",
    "createdAt": "ISO string",
    "sourceUrl": "string"
  }
}
```

### `gallery.json`
```json
[{ "id": 1, "src": "string", "caption": "string", "date": "string" }]
```

### `faq.json`
```json
[{ "id": 1, "question": "string", "answer": "string" }]
```

---

## Error Handling

- **oknesset API down:** cached JSON data is served as-is with a "last updated X ago" indicator; no crash
- **Claude API error:** summarization is non-blocking; card renders without summary block and shows a "סיכום לא זמין" label
- **Invalid URL pasted:** `url-parser.ts` returns `null`; frontend shows inline validation error "הקישור אינו נתמך"
- **File download failure:** summarizer returns graceful error; no cache entry written

---

## Internationalization

- Site language: Hebrew (RTL) as default
- `document.documentElement.dir` drives all directional logic
- Drawer position, text alignment, and icon mirroring all derived from `useDirection()` hook
- English/LTR support left as a future concern; all directional code uses logical CSS properties where possible

---

## Backlog

`BACKLOG.md` will track:

1. **Hitkpakdut modernized form** — `JoinForm.tsx` is built with all fields (name, phone, email, ID, neighborhood) but not wired as the primary CTA. Currently the "הצטרפות" button links to the official Likud registration page. When user storage is available (DB phase), replace external link with the built form.
2. **Database migration** — replace JSON files with a proper DB (PostgreSQL or SQLite). All server services read/write through a repository interface from day one to make this swap clean.
3. **Multi-language support** — English version of the site (LTR layout, translated content).
4. **User accounts** — member login, personalized tracking lists, voting alerts by email.

---

## Out of Scope (this phase)

- User authentication
- Email notifications
- Public deployment / hosting
- Mobile app
- CMS for content editing
