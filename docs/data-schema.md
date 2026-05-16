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
