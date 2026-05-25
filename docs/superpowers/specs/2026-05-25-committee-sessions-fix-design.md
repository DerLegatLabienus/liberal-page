# CommitteeCard Sessions — Fix Spec

**Date:** 2026-05-25
**Backlog item:** 10 (CommitteeCard — Recent Sessions with Links)
**Supersedes:** Partial implementation from 2026-05-19 spec

## Context

The initial implementation of `recentSessions` shipped with three bugs:
1. Session links are broken — the enricher builds custom URLs via `committee-url-mapping.json` instead of using the canonical `SessionUrl` from OData.
2. Only 2 sessions are fetched (`$top=2`). Backlog says 3–5; we target 5.
3. MK attendance badges show raw siteId numbers (e.g. `💙 1116`) because `attendingSiteIds` is always `[]` — the enricher never populated it, and the card falls back to the key as the label.
4. The committee name → OData ID lookup has `KnessetNum eq 25` hardcoded.

---

## Changes

### 1. `server/services/committee-session-enricher.ts`

**Fix URL generation** — remove the `committee-url-mapping.json` lookup entirely. Use `session.SessionUrl` from OData directly, upgrading `http://` → `https://`:

```ts
// Before
const sessionsUrl = committeeAppUrl
  ? `https://main.knesset.gov.il/APPS/committees/${committeeAppUrl}/sessions/${session.CommitteeSessionID}`
  : session.SessionUrl.replace('http://', 'https://')

// After
const sessionUrl = session.SessionUrl.replace('http://', 'https://')
```

**Increase session count** — change `$top=2` to `$top=5` in the `KNS_CommitteeSession` query.

**Remove hardcoded Knesset number** — `resolveCommitteeId` currently filters `KnessetNum eq 25 and IsCurrent eq true`. Drop `KnessetNum eq 25`; `IsCurrent eq true` is sufficient and survives a Knesset transition.

**Attendee enrichment stays out of scope** — populating `attendingSiteIds` requires additional OData calls (`KNS_CmtSessionPresence`) that need verification. Not included in this fix.

### 2. `src/components/parliament/CommitteeCard.tsx`

**Show MK names in badges** — import `knesset-members-cache.json` and build a `siteId → name` lookup. Replace the raw `{siteId}` label with the resolved name:

```tsx
import memberCache from '@/data/knesset-members-cache.json'

const nameByMkSiteId = Object.fromEntries(
  (memberCache as { members: { siteId: number; name: string }[] }).members
    .map(m => [String(m.siteId), m.name])
)

// In render:
{ann.isLiberal ? '💙' : '⭐'} {nameByMkSiteId[siteId] ?? siteId}
```

Since `attendingSiteIds` is currently always empty, this change has no visible effect until attendee enrichment is implemented — but it is correct and prevents the siteId-as-label bug from appearing when that data arrives.

### 3. Update `CommitteeCard` session count rendering

The card currently destructures `[extended, compact] = sessions`. Expand to render all sessions beyond the first as compact rows (up to 4):

```tsx
const [extended, ...compactSessions] = sessions  // up to 4 compact rows
```

---

## What is NOT changing

- `attendingSiteIds` population (pending OData `KNS_CmtSessionPresence` verification)
- `committee-url-mapping.json` — file stays but is no longer read by the enricher
- `summaries-cache.json` format or AI summary logic
- `Committee` type shape — no new fields

---

## Tests to update

- `tests/server/committee-session-enricher.test.ts` — update URL expectations from custom format to OData `SessionUrl` passthrough; update `$top` expectation to 5; verify KnessetNum filter is absent from the committee lookup query
- `tests/components/CommitteeCard.test.tsx` — add test: badge renders MK name from cache, not raw siteId
