# Data Schema

All shared interfaces live in `src/types.ts`. JSON data files live in `src/data/`.

The current app uses `site`, `about`, `gallery`, `faq`, `bills`, `committees`, `mks`, and `summaries-cache`. Older static files such as `representatives`, `updates`, `protocols`, and `primaries` still exist but are not part of the current mounted homepage flow.

## SiteConfig — `site.json`

```typescript
interface SiteConfig {
  partyName: string
  cellSubtitle: string
  heroHeadline: string
  heroTagline: string
  logoPath: string
  constitutionUrl: string
  contactEmail: string
}
```

Join URLs are not stored in `site.json`. `JoinSelector` owns the effective-soft URL mapping because those links are fixed integration targets, not editable site content.

## Bill — `bills.json`

```typescript
interface Bill {
  id: number
  oknesset_id: string
  number: string
  title: string
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
  position: 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes: string
  committee: string
  sourceUrl: string
  documentUrl: string | null
  hasNewData: boolean
  lastPolledAt: string | null
}
```

`id` is a local numeric ID used for drawer rendering and delete routes. `oknesset_id` is the external ID used for refreshes.

## Committee — `committees.json`

```typescript
interface Committee {
  id: number
  oknesset_id: string
  name: string
  chair: string
  lastSessionDate: string | null
  lastSessionSummary: string | null
  lastSessionDocumentUrl: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
}
```

Committee polling can update latest session fields and cache a summary when a protocol document is available.

## MK — `mks.json`

```typescript
interface Mk {
  id: number
  oknesset_id: string
  knesset_site_id?: string
  name: string
  party: string
  email?: string | null
  photoUrl?: string | null
  currentRoles?: MkRole[]
  activity?: MkActivity[]
  recentVotes: MkVote[]
  votingSummary: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
}
```

`oknesset_id` stores the internal Knesset/OData person ID for MKs added from Knesset-site URLs. `knesset_site_id` stores the public website ID when available.

### MK Supporting Types

```typescript
interface MkVote {
  date: string
  billTitle: string
  vote: 'בעד' | 'נגד' | 'נמנע' | 'נעדר'
}

type MkActivityType = 'bill_initiated' | 'vote' | 'duty_change' | 'question'

interface MkActivity {
  type: MkActivityType
  date: string
  title: string
  detail?: string
  sourceUrl?: string
}

interface MkRole {
  positionId: number
  description: string
  committeeName?: string
  factionName?: string
  isCurrent: boolean
  startDate: string | null
}
```

The current scraper populates `bill_initiated` and `question` activity. Vote and duty-change types remain in the shared type for compatibility with existing UI/data shape.

## Static Public Content

```typescript
interface GalleryItem {
  id: number
  src: string
  caption: string
  date: string
}

interface FaqItem {
  id: number
  question: string
  answer: string
}

interface LeadershipMember {
  name: string
  role: string
  image: string
}

interface AboutData {
  paragraphs: string[]
  values: string[]
  leadership?: LeadershipMember[]
}
```

## Summary Cache — `summaries-cache.json`

```typescript
interface SummaryCache {
  [md5: string]: {
    summary: string
    createdAt: string
    sourceUrl: string
  }
}
```

Summaries are keyed by MD5 of the downloaded document buffer.

## Tracking Types and URL Parsing

```typescript
type TrackingType = 'bill' | 'committee' | 'mk'

interface ParsedUrl {
  type: TrackingType
  id: string
}
```

`POST /api/tracking/add` accepts either a parsed URL or `{ rawId, type }`. Supported parser patterns currently cover oknesset bill/member/committee URLs, selected Knesset bill/committee/MK URLs, and raw numeric IDs selected in the UI.

---

## Postgres Schema (Phase 1 — entity tables)

Phase 1 of the JSON → Postgres migration added `server/db/` with a Drizzle ORM schema, nine repositories, a pglite test harness, startup migration wiring, and a `scripts/seed-db.ts` seed script. The JSON files in `src/data/` remain as the frontend's static seed and as the seed-script input baseline; the routes and poller still read/write them (migration of those call-sites is Phase 2).

### Design principle: entity tables vs. tracking (Phase 2)

**Entity tables** hold objective Knesset facts: the bill as published, the committee as constituted, the MK as elected. They are never hard-deleted. All foreign-key constraints use `ON DELETE RESTRICT`.

**Tracking tables** (which tracker is following which entity, per-tracker `position`, `notes`, etc.) are **Phase 2 — not yet implemented**.

### `knesset_config`

One row (always `id = 1`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK | always 1 |
| `current_knesset` | integer | the active Knesset number |
| `detected_at` | timestamptz | when this value was last detected |

### `feature_flags`

One row per flag.

| Column | Type | Notes |
|--------|------|-------|
| `name` | text PK | flag identifier |
| `enabled` | boolean | |
| `value` | text | optional string payload |
| `description` | text | |
| `updated_at` | timestamptz | |

### `bills`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `oknesset_id` | text | oknesset.org external ID |
| `number` | text | bill number |
| `title` | text | |
| `status` | text | |
| `committee` | text | |
| `source_url` | text | |
| `document_url` | text | nullable |
| `knesset_url` | text | nullable |
| `knesset_number` | integer | which Knesset this bill belongs to |
| `has_new_data` | boolean | |
| `last_polled_at` | timestamptz | nullable |

**Derived field (not a column):** `inactive` — computed at read time as `knesset_number != knesset_config.current_knesset`.

### `committees`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `oknesset_id` | text | |
| `name` | text | |
| `chair` | text | |
| `last_session_date` | timestamptz | nullable |
| `last_session_summary` | text | nullable |
| `last_session_document_url` | text | nullable |
| `source_url` | text | |
| `has_new_data` | boolean | |
| `last_polled_at` | timestamptz | nullable |

### `committee_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | integer PK | Knesset session ID (not serial) |
| `committee_id` | integer FK → `committees.id` RESTRICT | |
| `date` | timestamptz | |
| `knesset_num` | integer | |
| `title` | text | |
| `session_url` | text | |
| `attending_site_ids` | text[] | array of Knesset site IDs of attendees |
| `ai_summary` | text | nullable |

### `mks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `oknesset_id` | text | |
| `knesset_site_id` | text | nullable; public Knesset website ID |
| `name` | text | |
| `email` | text | nullable |
| `photo_url` | text | nullable |
| `voting_summary` | text | nullable |
| `source_url` | text | |
| `has_new_data` | boolean | |
| `last_polled_at` | timestamptz | nullable |

**Derived fields (not columns):** `party` — resolved at read time from the current Knesset term's `faction` in `mk_knesset_terms` (falls back to the latest term). `inactive` — `true` when there is no `mk_knesset_terms` row matching `current_knesset`.

### `mk_knesset_terms`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `mk_id` | integer FK → `mks.id` RESTRICT | |
| `knesset_number` | integer | |
| `faction` | text | party/faction name for this term |

Unique constraint on `(mk_id, knesset_number)`.

### `mk_roles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `mk_id` | integer FK → `mks.id` RESTRICT | |
| `position_id` | integer | Knesset position ID |
| `description` | text | |
| `committee_name` | text | nullable |
| `is_current` | boolean | |
| `start_date` | timestamptz | nullable |

### `mk_activity`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `mk_id` | integer FK → `mks.id` RESTRICT | |
| `type` | text | `bill_initiated`, `vote`, `duty_change`, `question` |
| `date` | timestamptz | |
| `title` | text | |
| `detail` | text | nullable |
| `source_url` | text | nullable |

### `mk_votes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `mk_id` | integer FK → `mks.id` RESTRICT | |
| `date` | timestamptz | |
| `bill_title` | text | |
| `vote` | text | |

### Cache tables

Cache tables hold data fetched from external Knesset APIs, refreshed on stale reads by their respective repositories.

#### `knesset_members_cache`

| Column | Type |
|--------|------|
| `site_id` | integer PK |
| `name` | text |
| `party` | text |
| `photo_url` | text (nullable) |
| `is_liberal` | boolean |
| `is_supporter` | boolean |
| `cached_at` | timestamptz |

#### `knesset_committees_cache`

| Column | Type |
|--------|------|
| `committee_id` | integer PK |
| `name` | text |
| `knesset_url` | text |
| `cached_at` | timestamptz |

#### `summaries_cache`

| Column | Type | Notes |
|--------|------|-------|
| `md5` | text PK | MD5 of the downloaded document buffer |
| `summary` | text | |
| `created_at` | timestamptz | |
| `source_url` | text | |
| `attendees` | text[] | nullable |
| `derived_title` | text | nullable |

### `mk_annotations`

Stores liberal/supporter flags keyed by Knesset site ID.

| Column | Type |
|--------|------|
| `knesset_site_id` | text PK |
| `is_liberal` | boolean |
| `is_supporter` | boolean |
