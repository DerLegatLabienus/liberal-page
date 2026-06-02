# Join Section Analytics — Design

**Status:** Approved design
**Date:** 2026-06-02
**Backlog item:** #1 (Join Flow Analytics)

## Context

The Join section (`JoinSection` → `JoinSelector`) lets a visitor pick a membership
**status** (`new` / `renewal` / `existing`) and a **mode** (`individual` / `couple`),
then click through to an external "effective-soft" membership form. The site stores no
membership/identity/payment data and never proxies submissions — that privacy stance is
fixed.

We want lightweight, budget-conscious analytics on **intent**: how many people click
through to a form, and which of the 6 `(status, mode)` combinations they pick. Storage
must stay tiny (the site runs on a free-tier DB), and the analytics code must be fully
separated from business logic.

## What is measured (and what is not)

- **Measured:** a *click-through* — the moment the user clicks the button that opens the
  external form. This is the conversion-intent signal.
- **Not measured:** form completion. The form lives on a third-party provider; we only
  own the outbound link, and the privacy stance forbids storing submission/identity data.
  Knowing completion would require the provider to support a webhook or a redirect-back
  "thank-you" URL — neither is confirmed. Deferred (see Out of Scope / backlog #16).
- **Not exposed:** no read endpoint or UI. Data lives in the DB only, inspected via SQL.
  A future admin-gated read view is backlog #16.

## Storage — single table

```ts
// server/db/schema/analytics.ts
export const joinAnalytics = pgTable('join_analytics', {
  bucket: text('bucket').primaryKey(),          // 'YYYY-MM-DD' for a day, or 'lifetime'
  total: integer('total').notNull().default(0), // click-throughs in this bucket
  breakdown: jsonb('breakdown').notNull().default({}), // { "new:individual": 12, ... }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})
```

One reserved row (`bucket = 'lifetime'`) holds the all-time total + breakdown; its
`createdAt` is the "since inception" date. Every other row is one day. This collapses
the 1-year sliding window and the lifetime total into a single table with no ambiguity.

**Footprint:** ≤ 366 rows at any time (365 daily + 1 lifetime).

**Combination key:** `` `${status}:${mode}` `` — e.g. `new:individual`, `existing:couple`.
6 possible keys.

## Components

### Repository — `server/repositories/join-analytics-repository.ts`

Mirrors the simple style of `feature-flags-repository.ts`. Fully isolated; the only
module that touches `joinAnalytics`.

```ts
export const JOIN_STATUSES = ['new', 'renewal', 'existing'] as const
export const JOIN_MODES = ['individual', 'couple'] as const
export type JoinStatus = (typeof JOIN_STATUSES)[number]
export type JoinMode = (typeof JOIN_MODES)[number]

export class JoinAnalyticsRepository {
  // Returns false if status/mode are invalid (caller maps to HTTP 400).
  async record(status: string, mode: string, now = new Date()): Promise<boolean>
  // Deletes daily rows older than `now - 365 days`; never the 'lifetime' row.
  async pruneOldDays(now = new Date()): Promise<number>
}
```

`record`:
1. Validate `status ∈ JOIN_STATUSES`, `mode ∈ JOIN_MODES`; return `false` if not (guards
   against arbitrary `breakdown` keys).
2. `combo = ` `` `${status}:${mode}` ``; `day = now.toISOString().slice(0, 10)`.
3. Upsert the day row and the `'lifetime'` row, each: `total += 1`,
   `breakdown[combo] += 1`. Implemented with `onConflictDoUpdate` and a SQL expression
   that increments `total` and rewrites `breakdown` via `jsonb_set(..., COALESCE(existing,0)+1)`.
   `createdAt` is set only on insert, untouched on conflict.
4. Call `pruneOldDays(now)`.

Increment SQL sketch (per row):
```sql
INSERT INTO join_analytics (bucket, total, breakdown, created_at)
VALUES ($bucket, 1, jsonb_build_object($combo, 1), $now)
ON CONFLICT (bucket) DO UPDATE SET
  total = join_analytics.total + 1,
  breakdown = jsonb_set(
    join_analytics.breakdown, ARRAY[$combo],
    to_jsonb(COALESCE((join_analytics.breakdown ->> $combo)::int, 0) + 1)
  );
```

Prune:
```sql
DELETE FROM join_analytics WHERE bucket <> 'lifetime' AND bucket < $cutoff;
```
`cutoff = (now - 365d).toISOString().slice(0,10)`. Lexicographic comparison is valid for
ISO `YYYY-MM-DD` strings.

### Route — `server/routes/analytics.ts`

```
POST /api/analytics/join   body: { status, mode }
```
- Calls `repo.record(status, mode)`.
- `true` → `200 { ok: true }`. `false` → `400 { error }`. Thrown error → `500 { error }`.
  (`200` rather than `204` so the existing `apiFetch` helper, which calls `res.json()`,
  needs no special-casing for an empty body.)
- No `GET` route (data is DB-only for now).

Mounted in `server/index.ts`: `app.use('/api/analytics', analyticsRouter)`.

### Frontend — `src/lib/api-client.ts` + `JoinSelector`

- Add to `api-client.ts`:
  ```ts
  analytics: {
    joinClick: (status: string, mode: string) =>
      apiFetch<void>('/analytics/join', { method: 'POST', body: JSON.stringify({ status, mode }) }),
  }
  ```
- In `JoinSelector`, on the click-through handler that opens the external form, call
  `api.analytics.joinClick(status, mode).catch(() => {})` **before/alongside** opening the
  URL. Fire-and-forget: the form opens regardless; analytics failure is swallowed and
  never blocks navigation.

**Implementation note:** `apiFetch` does `res.json()`, which would throw on an empty
`204` body, so the route returns **`200 { ok: true }`**. Keeps the existing `apiFetch`
helper unchanged.

## Data flow

```
JoinSelector click-through
  → api.analytics.joinClick(status, mode)   (fire-and-forget; form opens regardless)
  → POST /api/analytics/join
  → JoinAnalyticsRepository.record()
       ├─ validate combo (else 400)
       ├─ upsert day row     (total+1, breakdown[combo]+1)
       ├─ upsert lifetime row(total+1, breakdown[combo]+1)
       └─ pruneOldDays()     (delete daily rows < today-365; lifetime kept)
  → 200 { ok: true }
```

## Error handling

- Invalid `status`/`mode` → `400`, nothing written (no junk keys).
- DB error → `500`; frontend swallows it. The join navigation is never affected.
- Frontend never `await`s the analytics call in a way that delays opening the form.

## Testing

**Repository (`tests/server/join-analytics-repository.test.ts`, pglite):**
- `record` creates a day row and the lifetime row, both `total = 1`, correct `breakdown` key.
- Two records same day/combo → day + lifetime `total = 2`, `breakdown[combo] = 2`.
- Different combos accumulate independent `breakdown` keys; `total` sums them.
- Invalid status or mode → returns `false`, writes nothing.
- `record` with an injected `now` 400 days ahead prunes the old day row but keeps
  `'lifetime'` (and the new day row).

**Route (`tests/server/analytics-route.test.ts`, supertest + pglite):**
- Valid POST → `200 { ok: true }`; row counts updated.
- Invalid combo → `400`.

**Frontend:** a small `JoinSelector` test asserting the click handler calls
`api.analytics.joinClick` with the selected `(status, mode)` and still opens the form
(mock `api-client`). Only if `JoinSelector` already has a test harness; otherwise covered
by the backend tests (the frontend call is a one-line fire-and-forget).

## Out of scope (tracked in backlog)

- **#16 — Admin read view:** a `GET /api/analytics/join` + admin-panel UI, gated behind
  auth, when an admin panel exists.
- **#17 — Site-wide product analytics:** a general per-feature analytics layer; large,
  someday/maybe.
- **Completion tracking:** depends on the form provider offering a webhook or
  redirect-back URL; not feasible under current constraints.
