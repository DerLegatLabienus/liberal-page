# Data Schema

All shared interfaces live in `src/types.ts`.

**Phase 2 cutover complete.** The runtime JSON datastore is gone. `src/data/*.json` now contains only static content (about, faq, gallery, site, primaries, protocols, representatives, updates) and read-only config (committee-url-mapping, trending-bills). All tracked parliament data (bills, committees, MKs), feature flags, knesset config, and summaries cache live in Postgres.

The curated parliament baseline lives in `scripts/seed-data/` and is loaded via `npm run db:seed`.

The current app uses `site`, `about`, `gallery`, and `faq` as static JSON. Older static files such as `representatives`, `updates`, `protocols`, and `primaries` still exist but are not part of the current mounted homepage flow.

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

## Bill (TypeScript shape — stored in DB)

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

`id` is the DB serial PK. `oknesset_id` is the external ID used for refreshes.

## Committee (TypeScript shape — stored in DB)

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

## MK (TypeScript shape — stored in DB)

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

## Summary Cache (stored in DB — `summaries_cache` table)

Document summaries are keyed by MD5 of the downloaded document buffer and stored in the `summaries_cache` Postgres table. The `Summarizer` service reads and writes via `SummariesRepository`.

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

## Postgres Schema (Phase 2 complete)

Phases 1 and 2 of the JSON → Postgres migration are complete. `server/db/` contains a Drizzle ORM schema, repositories, a pglite test harness, startup migration wiring, and a `scripts/seed-db.ts` seed script. The curated parliament baseline lives in `scripts/seed-data/` and is loaded via `npm run db:seed`. The runtime JSON datastore (`src/data/bills.json`, `mks.json`, etc.) has been removed.

### Domain schemas (§23 — 2026-06-19)

The 28 tables live in **6 Postgres schemas** (not a single `public` schema), grouped by Low
Coupling / High Cohesion:

| Schema | Tables |
|--------|--------|
| `parliament` | `bills`, `committees`, `committee_sessions`, `mks`, `mk_knesset_terms`, `mk_roles`, `mk_activity`, `mk_votes`, `mk_annotations`, `tracked_bills`, `tracked_committees`, `tracked_mks`, `knesset_members_cache`, `knesset_committees_cache`, `summaries_cache`, `knesset_config` |
| `auth` | `users`, `refresh_tokens`, `allowed_emails` |
| `email` | `email_templates`, `sent_emails` |
| `letters` | `letters`, `letter_channels`, `letter_contacts`, `letter_issue_tags`, `letter_templates`, `letter_media_assets` |
| `analytics` | `join_analytics`, `letter_analytics` |
| `config` | `feature_flags` |

Schemas are declared in `server/db/schema/schemas.ts` via `pgSchema('<name>')`, and each table is
defined with `<schema>.table(...)`. Drizzle emits schema-qualified SQL, so repositories need no
changes. Migration `0021_domain_schemas.sql` moved the tables non-destructively
(`CREATE SCHEMA` + `ALTER TABLE … SET SCHEMA`; FKs/indexes/sequences ride along). The only
cross-schema foreign keys are `parliament.tracked_* → auth.users`,
`letters.letters.created_by → auth.users`, and `analytics.letter_analytics → letters.letters`;
everything else is intra-schema. Spec: `docs/superpowers/specs/2026-06-18-domain-schemas-design.md`.

#### Multi-channel letters (`letter_channels`)

A `letters` row is a campaign holding only shared fields (title, issue tags, status, priority,
pin/publish, analytics). Its content lives in **`letter_channels`** — one row per medium,
`UNIQUE(letter_id, kind)` where `kind ∈ {email, sms, whatsapp}`. Each channel row carries `enabled`,
`recipient_ids`/`cc_ids`/`bcc_ids` (jsonb `number[]` — **contact ids, resolved live**, never
snapshots), `body_text` (the SMS/WhatsApp message, or email's plain-text alternative derived as
`stripHtml(body_html)`), and the email-only `subject`/`body_html`/`template_id`. A CHECK enforces
that an `email` channel has a subject + body_html. `letter_contacts` was widened: `email` is now
**nullable** (still unique), plus `phone` (E.164), `has_whatsapp`, `photo_url`, `mk_site_id`; a CHECK
requires email OR phone. Reachability: email ⟺ email present; sms ⟺ phone present; whatsapp ⟺ phone
present AND has_whatsapp. `analytics.letter_analytics` gained `public_sms`/`public_whatsapp` buckets
(no schema change — bucket is just a text column). Migration `0027_colorful_nicolaos.sql` (expand);
`scripts/backfill-channels.ts` turns legacy letters into email channels (run once before serving);
the legacy `letters.subject/body_html/body_plain/to/cc/bcc_addresses` columns are retained but empty
and unread, pending a later contract migration. Spec: `docs/superpowers/specs/2026-07-15-communications-channels-design.md`.

### Design principles

**Entity tables** hold objective Knesset facts: the bill as published, the committee as constituted, the MK as elected. They are never hard-deleted. All foreign-key constraints use `ON DELETE RESTRICT`.

**Tracking tables** record which entities the shared "house account" (`users.id = 1`) is following, with per-entry `position` and `notes`.

**Feature flags** are a flat global registry in the `feature_flags` table (one row per flag, no scoping). Queried via `GET /api/feature-flags` which returns `Record<string, { enabled, value }>`.

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

Seeded flags (via `scripts/seed-db.ts`):

| `name` | `enabled` | `value` | Purpose |
|--------|-----------|---------|---------|
| `trendingAlgorithm` | true | `"manual"` | Bills Overview trending tab source (`"manual"` \| `"amendments"` \| `"sponsorship"`) |
| `recentRanking` | true | `"newest"` | Bills Overview recent tab order (`"newest"` \| `"progress"`) |
| `policyFilter` | true | null | Bills Overview policy-aligned tab toggle |
| `storagePressure` | true | `"450:2"` | Orphan-purge config `"limitMb:slackMb"`; `"-1"` disables |
| `meetUs` | false | null | Calendly event-type URI for Meet Us booking; set value + enable via admin panel |

### `join_analytics`

Single-table Join-section click-through analytics. One reserved row holds all-time
totals; every other row is one day within a 1-year sliding window (pruned on write).

| Column | Type | Notes |
|--------|------|-------|
| `bucket` | text PK | `'YYYY-MM-DD'` for a daily row, or the literal `'lifetime'` |
| `total` | integer | click-throughs in this bucket (default 0) |
| `breakdown` | jsonb | per-combination counts, keyed `'<status>:<mode>'` e.g. `{ "new:individual": 12 }` (default `{}`) |
| `created_at` | timestamptz | set once on insert; on the `'lifetime'` row this is "since inception" |

Written only by `JoinAnalyticsRepository` (`POST /api/analytics/join`). Read via `GET /api/admin/analytics/join` (admin only) — returns `{ lifetime, daily }` with daily rows sorted newest-first. Displayed in the AdminPanel "Join analytics" section.

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

### `users`

Real accounts plus one internal `role = 'group'` row that owns the public/default tracking
list. Tracking is per-user via the `tracked_*` join tables.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `label` | text | legacy/display label |
| `email` | text | unique; null for the `group` row |
| `name` | text | display name from Google |
| `google_sub` | text | unique Google subject id; null for the `group` row |
| `role` | text | `'admin' \| 'member' \| 'group'` (default `member`) |
| `last_login_at` | timestamptz | |
| `created_at` | timestamptz | |

### `allowed_emails`

Invite allowlist for the closed group; presence permits sign-in, `role` is granted on first login.

| Column | Type | Notes |
|--------|------|-------|
| `email` | text PK | |
| `role` | text | `'admin' \| 'member'` (default `member`) |
| `invited_by` | integer → users.id | nullable |
| `created_at` | timestamptz | |

### `refresh_tokens`

Active sessions. Only the sha256 hash is stored; validity = row exists and not expired
(invalidation is deletion). Raw token is `userId.randomHex` (self-identifying for reuse detection).

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `user_id` | integer → users.id | onDelete restrict |
| `token_hash` | text | sha256 of the raw refresh token |
| `expires_at` | timestamptz | |
| `created_at` | timestamptz | |

### `email_templates`

DB-stored transactional email templates, editable via the admin panel without redeploy.

| Column | Type | Notes |
|--------|------|-------|
| `name` | text PK | `'invite'`, `'bill_digest'`, `'bill_digest_item'`, `'_layout'` |
| `subject` | text | |
| `html` | text | Handlebars template |
| `updated_at` | timestamptz | |

### `sent_emails`

Send ledger; polled each cycle to advance delivery status from Resend's `last_event`. First table trimmed under storage pressure.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Resend message id, or `failed:<uuid>` on send error |
| `to_email` | text | redacted in logs |
| `template` | text | |
| `status` | text | last known Resend status: `sent`, `delivered`, `bounced`, `failed`, … |
| `last_status_at` | timestamptz | when `status` was last observed |
| `error` | text | nullable; set on send failure |
| `created_at` | timestamptz | send date |

### `tracked_bills`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `user_id` | integer FK → `users.id` RESTRICT | |
| `bill_id` | integer FK → `bills.id` RESTRICT | |
| `position` | text | `תומכים` / `מתנגדים` / `עוקבים` |
| `notes` | text | |
| `created_at` | timestamptz | |

Unique constraint on `(user_id, bill_id)`.

### `tracked_committees`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `user_id` | integer FK → `users.id` RESTRICT | |
| `committee_id` | integer FK → `committees.id` RESTRICT | |
| `created_at` | timestamptz | |

Unique constraint on `(user_id, committee_id)`.

### `tracked_mks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `user_id` | integer FK → `users.id` RESTRICT | |
| `mk_id` | integer FK → `mks.id` RESTRICT | |
| `created_at` | timestamptz | |

Unique constraint on `(user_id, mk_id)`.
