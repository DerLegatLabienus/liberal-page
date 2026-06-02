# Join Analytics Implementation Plan

> Execute task-by-task with TDD.

**Goal:** Record Join-section click-throughs (per `status:mode` combo) into a single
`join_analytics` table — daily rows in a 1-year sliding window + a `lifetime` row — via a
fire-and-forget POST. DB-only, no read endpoint.

---

### Task 1: Schema + migration
- Create `server/db/schema/analytics.ts` with `joinAnalytics` (`bucket` text PK, `total`
  int default 0, `breakdown` jsonb default {}, `createdAt` timestamptz).
- Export `* from './analytics'` in `server/db/schema/index.ts`.
- `npm run db:generate` → migration `0007_*.sql`; verify `CREATE TABLE "join_analytics"`.

### Task 2: Repository (TDD)
- Create `server/repositories/join-analytics-repository.ts`: `JOIN_STATUSES`,
  `JOIN_MODES`, `record(status, mode, now?)`, `pruneOldDays(now?)`.
- Tests `tests/server/join-analytics-repository.test.ts` (pglite): increments day+lifetime;
  same combo accumulates; distinct combos independent; invalid combo → false, no write;
  prune drops >365-day day rows, keeps lifetime.

### Task 3: Route + mount (TDD)
- Create `server/routes/analytics.ts`: `POST /join` → `record` → 200 `{ok:true}` / 400 / 500.
- Mount `app.use('/api/analytics', analyticsRouter)` in `server/index.ts`.
- Tests `tests/server/analytics-route.test.ts` (supertest): valid → 200 + counts; invalid → 400.

### Task 4: Frontend wiring
- Add `analytics.joinClick(status, mode)` to `src/lib/api-client.ts`.
- In `JoinSelector`, call it fire-and-forget on the click-through that opens the form;
  swallow errors; form opens regardless.

### Verify
- `npx tsc --noEmit` clean; `npm test` green; `npm run lint` no new errors.
