# Closed Committees Implementation Plan

> **For agentic workers:** execute task-by-task with TDD. Steps use checkbox syntax.

**Goal:** Detect when a tracked committee closes (absent from the Knesset `IsCurrent` active list) and present it as a historical record with a "Closed" badge, safely and automatically.

**Architecture:** A pure `computeStatusChanges` function decides flag changes from (tracked committees, active id set, safety floor). The repository applies them. A refresh helper runs the OData fetch + cache write + reconciliation, called by both the `/list` route and the poller. Schema gains a persisted `inactive` column.

**Tech Stack:** Drizzle + Postgres/pglite, Express, Vitest, React + i18next.

---

### Task 1: Schema column + migration

**Files:** `server/db/schema/committees.ts`, generated migration under `server/db/migrations/`

- [ ] Add `inactive: boolean('inactive').notNull().default(false)` to the `committees` table (after `lastPolledAt`).
- [ ] Run `npm run db:generate` → produces `0006_*.sql`.
- [ ] Verify the migration file contains `ADD COLUMN "inactive" boolean DEFAULT false NOT NULL`.

### Task 2: Pure reconciliation function (TDD)

**Files:** Create `server/services/committee-status.ts`, `tests/server/committee-status.test.ts`

- [ ] Write failing tests: deactivate (missing id), reactivate (inactive id present), safety guard (`activeIds.size < minActive` → both empty), no redundant write (already-inactive still absent → neither list).
- [ ] Implement `computeStatusChanges(tracked, activeIds, minActive)` and `export const MIN_ACTIVE_COMMITTEES = 10`.
- [ ] `npx vitest run tests/server/committee-status.test.ts` → pass.

### Task 3: Repository — read inactive + apply reconciliation (TDD)

**Files:** `server/repositories/committees-repository.ts`, `tests/server/committees-repository.test.ts`

- [ ] `toCommittee()` includes `inactive: row.inactive`.
- [ ] Add `setInactiveByIds(oknessetIds: string[], inactive: boolean): Promise<number>` — targeted UPDATE on `committees.inactive` filtered by `inArray(committees.oknessetId, ids)`; returns row count. No-op on empty array.
- [ ] Add `reconcileActiveStatus(activeIds: number[]): Promise<{ deactivated: number; reactivated: number }>` — reads `{ oknessetId, inactive }` for all committees, calls `computeStatusChanges(..., MIN_ACTIVE_COMMITTEES)`, applies via `setInactiveByIds`. Confirm `upsert()` still does NOT set `inactive` (already true).
- [ ] Tests: upsert→getById returns `inactive: false`; reconcile with active set missing a committee marks it inactive; reconcile with it back present clears it; reconcile with active set size < 10 changes nothing.

### Task 4: Refresh helper extraction

**Files:** Create `server/services/committee-list-refresh.ts`; edit `server/routes/committees.ts`

- [ ] Move `ODATA_BASE`, `CACHE_TTL_MS`, `odataFetchAll`, the url-mapping load, and the OData fetch/map/`repo.set` block into the helper. Export `refreshCommitteeListIfStale(): Promise<CommitteeListItem[]>`.
- [ ] After a successful `repo.set(committees)`, call `committeesRepo.reconcileActiveStatus(committees.map(c => c.committeeId))` and `console.log` the counts.
- [ ] `/list` route becomes: `res.json(await refreshCommitteeListIfStale())` with the existing try/catch 500.
- [ ] `npx tsc --noEmit` clean.

### Task 5: Poller integration

**Files:** `server/services/poller.ts`

- [ ] Import `refreshCommitteeListIfStale`. Add a step in the cycle (alongside `pollCommittees`) wrapped in its own try/catch that logs and continues on error. Place it before/after the committee session poll — independent.
- [ ] `npm test` (server) still green.

### Task 6: UI — Closed badge (TDD)

**Files:** `src/components/parliament/CommitteeCard.tsx`, `src/locales/he.json`, `src/locales/en.json`, `tests/components/CommitteeCard.test.tsx`

- [ ] Add `"closed"` key to the `tracker` block: he `"סגורה"`, en `"Closed"`.
- [ ] In `CommitteeCard`, when `committee.inactive`, render `<Badge variant="secondary">{t('tracker.closed')}</Badge>` next to the name (inline, start-aligned within the RTL header row). Sessions/summary/source unchanged.
- [ ] Tests: `inactive: true` → badge text present + a session still rendered; `inactive: false` → no badge.
- [ ] `npx vitest run tests/components/CommitteeCard.test.tsx` → pass.

### Task 7: Seed data — include a closed committee

**Files:** `scripts/seed-data/committees.json`, `scripts/seed-db.ts`

- [ ] Add one committee entry with `"inactive": true` and an `oknesset_id` that is NOT a current committee (a plausible dissolved special committee, e.g. a "הוועדה המיוחדת" with a high/unused id). Give it 1–2 recentSessions so the historical card has content.
- [ ] In `seed-db.ts`, after the upsert+track loop, collect `oknesset_id`s where `c.inactive === true` and call `committeesRepo.setInactiveByIds(ids, true)`.
- [ ] Smoke: `NODE_ENV` default; can't run real DB here, so verify by a repo/seed-shape unit assertion or manual note. (Main verification is the unit + component tests.)

### Final verification

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm test` — all green (new tests included)
- [ ] `npm run lint` — clean
