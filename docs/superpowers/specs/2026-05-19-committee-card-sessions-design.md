# CommitteeCard — Recent Sessions with Liberal MK Highlighting — Design Spec

**Date:** 2026-05-19
**Backlog item:** 13 (CommitteeCard — Recent Sessions with Links)

## Overview

Extend `CommitteeCard` to show the 2 most recent committee sessions with dates, titles, and (optionally) liberal MK attendance highlighting. Session data is fetched at poll time and stored on the `Committee` type. AI-derived titles and attendance extraction are gated behind `COMMITTEE_AI=true` env var.

## Section 1 — Data Model

### New `CommitteeSession` interface (`src/types.ts`)

```typescript
export interface CommitteeSession {
  sessionId: number
  date: string              // ISO datetime from OData
  knessetNum: number        // Knesset number this session belongs to
  title: string             // agenda item name OR AI-derived one-liner
  sessionUrl: string        // https://main.knesset.gov.il/...AllCommitteesAgenda...
  attendingSiteIds: string[] // knesset_site_id strings; populated only when COMMITTEE_AI=true
  aiSummary?: string        // optional AI one-liner; only when COMMITTEE_AI=true
}
```

### `Committee` type update

Add to the existing `Committee` interface:
```typescript
recentSessions?: CommitteeSession[]
```

### Cross-Knesset highlighting logic

`CommitteeCard` checks `mk-annotations.json` (siteId → `{ isLiberal, isSupporter }`) against each session's `attendingSiteIds`. Because sessions store their own `knessetNum` and `attendingSiteIds`, the correct MKs are highlighted even after a Knesset transition — the stored data is frozen at poll time. No schema change to `mk-annotations.json` is needed.

## Section 2 — Poll-time Enrichment

### New function `enrichCommitteeSessions(committeeId: number): Promise<CommitteeSession[]>`

Located in `server/services/committee-session-enricher.ts`.

**Step 1 — Fetch 2 latest sessions from OData:**
```
KNS_CommitteeSession?$filter=CommitteeID eq {id}&$orderby=StartDate desc&$top=2
  &$select=CommitteeSessionID,StartDate,KnessetNum,SessionUrl&$format=json
```

**Step 2 — For each session, fetch agenda items:**
```
KNS_CmtSessionItem?$filter=CommitteeSessionID eq {sessionId}
  &$select=Name&$orderby=Ordinal&$top=5&$format=json
```
Use first item's `Name` as the session `title`. If multiple items, join with " · " up to 80 chars.

**Step 3 — AI enrichment (only when `process.env.COMMITTEE_AI === 'true'`):**
- Fetch `KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq {id}&$select=FilePath,GroupTypeDesc` — find the protocol document (`GroupTypeDesc = "פרוטוקול ועדה"`)
- Call `summarizer.summarizeAndExtractAttendees(docUrl)` — new method on `Summarizer`
- Returns `{ title?: string, attendingSiteIds: string[], aiSummary?: string }`
- Override `title` only if it was blank and AI returned one
- Cache key: hash of `docUrl` (already done by `Summarizer`)

**Step 4 — Integrate into `pollCommittees()`:**
After fetching committee data, call `enrichCommitteeSessions(committee.oknesset_id)` and set `committee.recentSessions`. Handle errors silently (empty array fallback).

## Section 3 — `Summarizer` Extension

New method `summarizeAndExtractAttendees(docUrl: string)` in `server/services/summarizer.ts`:

- Downloads and extracts text from the .doc file (same `extractText` logic already exists)
- Single Claude prompt that returns JSON:
  ```
  { "title": "one-line topic", "attendees": ["שם חבר כנסת", ...], "summary": "optional one-liner" }
  ```
- Matches attendee names against `KNS_Person` data (or resolves via the existing MK list) to get `siteId`
- Cache key: `md5(docUrl)` — stored in `summaries-cache.json`
- Returns `{ title?: string, attendingSiteIds: string[], aiSummary?: string }`

## Section 4 — CommitteeCard UI

### Two-session layout

**Session 1 (most recent — extended):**
- Date (Hebrew locale format)
- Title (bold, truncated at 2 lines)
- Liberal attendee badges (row of chips): blue `💙` for `isLiberal`, amber `⭐` for `isSupporter` — only shown when `attendingSiteIds.length > 0`
- AI summary box (`bg-blue-50`, same as existing `lastSessionSummary`) — only shown when `aiSummary` present

**Session 2 (older — compact):**
- Date + title on one line, muted foreground
- No badges, no summary

Both sessions link to `sessionUrl` (opens in new tab).

### Feature flag visibility

When `COMMITTEE_AI=false`: no badge row rendered (since `attendingSiteIds` is always empty), no `aiSummary` box.

### Removes

The existing `lastSessionDate`, `lastSessionSummary`, and `lastSessionDocumentUrl` fields on `Committee` are **replaced** by `recentSessions`. The poller no longer sets them. `CommitteeCard` no longer renders them.

## Section 5 — CommitteeCombobox Tests

Add to `tests/components/CommitteeCombobox.test.tsx`:

- **Empty list**: `useCommitteeList` returns `[]` → combobox trigger shows placeholder, dropdown shows "לא נמצאו תוצאות"
- **Loading state**: `loading: true` → dropdown shows loading indicator
- **Item with empty knessetUrl**: `knessetUrl: ''` → item still renders, no broken href attribute rendered on the item itself (tracking fires via `api.committees.track`, not a link)
- **Long committee name**: name > 60 chars → truncated with `line-clamp-2`

## Section 6 — What Is NOT Changing

- `mk-annotations.json` schema — stays flat (siteId → isLiberal/isSupporter)
- The `/api/committees/info/{id}` endpoint — kept as a fallback/debug tool but no longer used as the `sourceUrl`
- The `summaries-cache.json` format — existing entries remain valid
- Bills or MK activity data — untouched
