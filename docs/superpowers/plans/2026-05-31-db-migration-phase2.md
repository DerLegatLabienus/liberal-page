# Database Migration — Phase 2 (JSON → DB Cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Postgres the actual source of truth — rewire every route, the poller, the transition service, config, and feature flags off JSON onto the repositories; move the frontend to load from the API only; delete the runtime JSON.

**Architecture:** Shared entity pool (`bills`/`committees`/`mks`) + per-user tracking tables (`tracked_*`) scoped to one seeded shared user until real auth. Entity reassembly reuses the Phase 1 entity repos; tracked repos add the per-user join (and bill `position`/`notes`). Feature flags become a flat global registry behind `GET /api/feature-flags`. The curated baseline moves to `scripts/seed-data/`.

**Tech Stack:** Drizzle ORM, node-postgres, pglite (tests), Express 5, React 18, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-05-31-db-migration-phase2-design.md`
**Branch:** `feat/db-migration-phase2`

---

## File Structure

**Created:**
- `server/db/schema/tracking.ts` — `users`, `tracked_bills`, `tracked_committees`, `tracked_mks`
- `server/repositories/users-repository.ts`
- `server/repositories/tracked-bills-repository.ts`
- `server/repositories/tracked-committees-repository.ts`
- `server/repositories/tracked-mks-repository.ts`
- `server/routes/feature-flags.ts` — `GET /api/feature-flags`
- `src/hooks/useFeatureFlags.ts`
- `scripts/seed-data/*` — curated baseline fixtures (moved from `src/data/`)
- repository test files under `tests/server/`

**Modified:**
- `server/db/schema/index.ts` (export tracking)
- `server/repositories/feature-flags-repository.ts` (flat global API)
- `server/repositories/bills-repository.ts` (add `getByIds`)
- `server/routes/parliament.ts`, `tracking.ts`, `bills.ts`, `committees.ts`
- `server/services/poller.ts`, `knesset-config.ts`, `knesset-bills.ts`
- `server/index.ts` (mount feature-flags route)
- `scripts/seed-db.ts`
- `src/hooks/useParliament.ts`, `src/hooks/useBillsOverview.ts`, `src/components/parliament/CommitteeCard.tsx`, `src/types.ts`

**Deleted:** `src/data/{bills,committees,mks,knesset-config,feature-flags,mk-annotations,knesset-members-cache,knesset-committees-cache,summaries-cache}.json`

---

## Task 1: Schema — users + tracking tables

**Files:**
- Create: `server/db/schema/tracking.ts`
- Modify: `server/db/schema/index.ts`
- Regenerate migration

- [ ] **Step 1: Write `server/db/schema/tracking.ts`**

```ts
import { pgTable, serial, integer, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { bills } from './bills'
import { committees } from './committees'
import { mks } from './mks'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const trackedBills = pgTable('tracked_bills', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  billId: integer('bill_id').notNull().references(() => bills.id, { onDelete: 'restrict' }),
  position: text('position').notNull().default('עוקבים'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserBill: unique('uniq_user_bill').on(t.userId, t.billId) }))

export const trackedCommittees = pgTable('tracked_committees', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  committeeId: integer('committee_id').notNull().references(() => committees.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserCommittee: unique('uniq_user_committee').on(t.userId, t.committeeId) }))

export const trackedMks = pgTable('tracked_mks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserMk: unique('uniq_user_mk').on(t.userId, t.mkId) }))
```

- [ ] **Step 2: Add `export * from './tracking'` to `server/db/schema/index.ts`** (append after the existing exports).

- [ ] **Step 3: Regenerate + type check**

Run: `npm run db:generate && npx tsc --noEmit`
Expected: a new migration (e.g. `0005_*.sql`) with `users` + three `tracked_*` tables, all FKs `ON DELETE restrict`, three unique constraints; tsc PASS.

- [ ] **Step 4: Verify it applies under pglite**

Run:
```bash
NODE_ENV=test npx tsx -e "import('./server/db/migrate.ts').then(m => m.runMigrations()).then(() => { console.log('migrations applied OK'); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })"
```
Expected: `migrations applied OK`.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/tracking.ts server/db/schema/index.ts server/db/migrations
git commit -m "feat(db): add users + tracked_* tracking schema"
```

---

## Task 2: UsersRepository

**Files:**
- Create: `server/repositories/users-repository.ts`
- Test: `tests/server/users-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users } from '../../server/db/schema'
import { UsersRepository } from '../../server/repositories/users-repository'

describe('UsersRepository', () => {
  const repo = new UsersRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(users) })

  it('getSharedUserId() creates the shared account on first call', async () => {
    const id = await repo.getSharedUserId()
    expect(id).toBeGreaterThan(0)
    const rows = await db.select().from(users)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('shared')
  })

  it('getSharedUserId() is idempotent (no duplicate shared rows)', async () => {
    const a = await repo.getSharedUserId()
    const b = await repo.getSharedUserId()
    expect(a).toBe(b)
    expect(await db.select().from(users)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/users-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/repositories/users-repository.ts`**

```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { users } from '../db/schema'

const SHARED_LABEL = 'shared'

export class UsersRepository {
  private cachedId: number | null = null

  async getSharedUserId(): Promise<number> {
    if (this.cachedId !== null) return this.cachedId
    const existing = await db.select().from(users).where(eq(users.label, SHARED_LABEL))
    if (existing[0]) {
      this.cachedId = existing[0].id
      return this.cachedId
    }
    const [row] = await db
      .insert(users)
      .values({ label: SHARED_LABEL, createdAt: new Date() })
      .returning({ id: users.id })
    this.cachedId = row.id
    return row.id
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/users-repository.test.ts`
Expected: PASS (2 tests).

> Note: the `cachedId` is per-instance; tests construct one repo and clear `users` in `beforeEach`, so construct a fresh repo per test OR call within one test. The test above uses a single repo and the second test relies on the first having cached — acceptable since both assert idempotency. If flakiness appears, set `repo['cachedId'] = null` in `beforeEach`.

- [ ] **Step 5: Commit**

```bash
git add server/repositories/users-repository.ts tests/server/users-repository.test.ts
git commit -m "feat(db): add UsersRepository (seeded shared account)"
```

---

## Task 3: BillsRepository.getByIds + TrackedBillsRepository

**Files:**
- Modify: `server/repositories/bills-repository.ts`
- Create: `server/repositories/tracked-bills-repository.ts`
- Test: `tests/server/tracked-bills-repository.test.ts`

- [ ] **Step 1: Add `getByIds` to `server/repositories/bills-repository.ts`**

Add this method to the `BillsRepository` class (it reuses the existing private `toBill`):
```ts
  async getByIds(ids: number[], currentKnesset: number): Promise<Partial<Bill>[]> {
    if (ids.length === 0) return []
    const rows = await db.select().from(bills).where(inArray(bills.id, ids))
    return rows.map((r) => this.toBill(r, currentKnesset))
  }
```
Add `inArray` to the drizzle import: `import { eq, inArray } from 'drizzle-orm'`.

- [ ] **Step 2: Write the failing test** — `tests/server/tracked-bills-repository.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, trackedBills, bills } from '../../server/db/schema'
import { BillsRepository } from '../../server/repositories/bills-repository'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'

const ENTITY = {
  oknessetId: '', number: '1044632', title: 'הצעת חוק', status: 'בוועדה',
  committee: '', sourceUrl: 'https://x', documentUrl: null, knessetUrl: null,
  knessetNumber: 25, hasNewData: false, lastPolledAt: null,
}

describe('TrackedBillsRepository', () => {
  const usersRepo = new UsersRepository()
  const billsRepo = new BillsRepository()
  const repo = new TrackedBillsRepository()
  let userId: number
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(trackedBills); await db.delete(bills); await db.delete(users)
    usersRepo['cachedId'] = null
    userId = await usersRepo.getSharedUserId()
  })

  it('track() then getAll() returns the bill with position/notes', async () => {
    const billId = await billsRepo.upsert(ENTITY)
    await repo.track(userId, billId, 'תומכים', 'my note', 25)
    const list = await repo.getAll(userId, 25)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(billId)
    expect(list[0].position).toBe('תומכים')
    expect(list[0].notes).toBe('my note')
  })

  it('track() is idempotent on (user, bill)', async () => {
    const billId = await billsRepo.upsert(ENTITY)
    await repo.track(userId, billId, 'עוקבים', '', 25)
    await repo.track(userId, billId, 'מתנגדים', 'changed', 25)
    const list = await repo.getAll(userId, 25)
    expect(list).toHaveLength(1)
    expect(list[0].position).toBe('מתנגדים')
  })

  it('untrack() removes the tracking row but keeps the bill entity', async () => {
    const billId = await billsRepo.upsert(ENTITY)
    await repo.track(userId, billId, 'עוקבים', '', 25)
    await repo.untrack(userId, billId)
    expect(await repo.getAll(userId, 25)).toHaveLength(0)
    expect(await db.select().from(bills)).toHaveLength(1) // entity persists
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/server/tracked-bills-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `server/repositories/tracked-bills-repository.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedBills } from '../db/schema'
import { BillsRepository } from './bills-repository'
import type { Bill } from '../../src/types'

export class TrackedBillsRepository {
  private bills = new BillsRepository()

  async getAll(userId: number, currentKnesset: number): Promise<Bill[]> {
    const tracks = await db.select().from(trackedBills).where(eq(trackedBills.userId, userId))
    if (tracks.length === 0) return []
    const entities = await this.bills.getByIds(tracks.map((t) => t.billId), currentKnesset)
    const byId = new Map(entities.map((e) => [e.id, e]))
    return tracks
      .map((t) => {
        const e = byId.get(t.billId)
        if (!e) return null
        return { ...e, position: t.position, notes: t.notes } as Bill
      })
      .filter((b): b is Bill => b !== null)
  }

  async track(userId: number, billId: number, position: string, notes: string, _currentKnesset?: number): Promise<void> {
    await db
      .insert(trackedBills)
      .values({ userId, billId, position, notes, createdAt: new Date() })
      .onConflictDoUpdate({ target: [trackedBills.userId, trackedBills.billId], set: { position, notes } })
  }

  async untrack(userId: number, billId: number): Promise<void> {
    await db.delete(trackedBills).where(and(eq(trackedBills.userId, userId), eq(trackedBills.billId, billId)))
  }

  async isTracked(userId: number, billId: number): Promise<boolean> {
    const rows = await db.select().from(trackedBills).where(and(eq(trackedBills.userId, userId), eq(trackedBills.billId, billId)))
    return rows.length > 0
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/server/tracked-bills-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/repositories/bills-repository.ts server/repositories/tracked-bills-repository.ts tests/server/tracked-bills-repository.test.ts
git commit -m "feat(db): add TrackedBillsRepository + BillsRepository.getByIds"
```

---

## Task 4: TrackedCommitteesRepository + TrackedMksRepository

**Files:**
- Create: `server/repositories/tracked-committees-repository.ts`
- Create: `server/repositories/tracked-mks-repository.ts`
- Test: `tests/server/tracked-committees-repository.test.ts`, `tests/server/tracked-mks-repository.test.ts`

- [ ] **Step 1: Write `tests/server/tracked-committees-repository.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, trackedCommittees, committees, committeeSessions } from '../../server/db/schema'
import { CommitteesRepository } from '../../server/repositories/committees-repository'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedCommitteesRepository } from '../../server/repositories/tracked-committees-repository'

const C = {
  oknesset_id: '', name: 'ועדת הכספים', chair: '', lastSessionDate: null,
  lastSessionSummary: null, lastSessionDocumentUrl: null, sourceUrl: 'https://x',
  hasNewData: false, lastPolledAt: null, recentSessions: [],
}

describe('TrackedCommitteesRepository', () => {
  const usersRepo = new UsersRepository()
  const cRepo = new CommitteesRepository()
  const repo = new TrackedCommitteesRepository()
  let userId: number
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(trackedCommittees); await db.delete(committeeSessions)
    await db.delete(committees); await db.delete(users)
    usersRepo['cachedId'] = null
    userId = await usersRepo.getSharedUserId()
  })

  it('track/getAll/untrack round-trips; entity persists after untrack', async () => {
    const id = await cRepo.upsert(C)
    await repo.track(userId, id)
    const list = await repo.getAll(userId)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('ועדת הכספים')
    await repo.untrack(userId, id)
    expect(await repo.getAll(userId)).toHaveLength(0)
    expect(await db.select().from(committees)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Write `tests/server/tracked-mks-repository.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, trackedMks, mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../../server/db/schema'
import { MksRepository } from '../../server/repositories/mks-repository'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedMksRepository } from '../../server/repositories/tracked-mks-repository'

const MK = {
  oknesset_id: '4395', knesset_site_id: '771', name: 'אבי דיכטר', email: null,
  photoUrl: null, votingSummary: null, sourceUrl: 'https://x', hasNewData: false,
  lastPolledAt: null, terms: [{ knessetNumber: 25, faction: 'הליכוד' }],
  currentRoles: [], activity: [], recentVotes: [],
}

describe('TrackedMksRepository', () => {
  const usersRepo = new UsersRepository()
  const mksRepo = new MksRepository()
  const repo = new TrackedMksRepository()
  let userId: number
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(trackedMks); await db.delete(mkVotes); await db.delete(mkActivity)
    await db.delete(mkRoles); await db.delete(mkKnessetTerms); await db.delete(mks); await db.delete(users)
    usersRepo['cachedId'] = null
    userId = await usersRepo.getSharedUserId()
  })

  it('track/getAll/untrack round-trips; derives party; entity persists', async () => {
    const id = await mksRepo.upsert(MK)
    await repo.track(userId, id)
    const list = await repo.getAll(userId, 25)
    expect(list).toHaveLength(1)
    expect(list[0].party).toBe('הליכוד')
    await repo.untrack(userId, id)
    expect(await repo.getAll(userId, 25)).toHaveLength(0)
    expect(await db.select().from(mks)).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run tests/server/tracked-committees-repository.test.ts tests/server/tracked-mks-repository.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `server/repositories/tracked-committees-repository.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedCommittees } from '../db/schema'
import { CommitteesRepository } from './committees-repository'
import type { Committee } from '../../src/types'

export class TrackedCommitteesRepository {
  private committees = new CommitteesRepository()

  async getAll(userId: number): Promise<Committee[]> {
    const tracks = await db.select().from(trackedCommittees).where(eq(trackedCommittees.userId, userId))
    const out: Committee[] = []
    for (const t of tracks) {
      const c = await this.committees.getById(t.committeeId)
      if (c) out.push(c)
    }
    return out
  }

  async track(userId: number, committeeId: number): Promise<void> {
    await db
      .insert(trackedCommittees)
      .values({ userId, committeeId, createdAt: new Date() })
      .onConflictDoNothing({ target: [trackedCommittees.userId, trackedCommittees.committeeId] })
  }

  async untrack(userId: number, committeeId: number): Promise<void> {
    await db.delete(trackedCommittees).where(and(eq(trackedCommittees.userId, userId), eq(trackedCommittees.committeeId, committeeId)))
  }

  async isTracked(userId: number, committeeId: number): Promise<boolean> {
    const rows = await db.select().from(trackedCommittees).where(and(eq(trackedCommittees.userId, userId), eq(trackedCommittees.committeeId, committeeId)))
    return rows.length > 0
  }
}
```

- [ ] **Step 5: Write `server/repositories/tracked-mks-repository.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedMks } from '../db/schema'
import { MksRepository } from './mks-repository'
import type { Mk } from '../../src/types'

export class TrackedMksRepository {
  private mks = new MksRepository()

  async getAll(userId: number, currentKnesset: number): Promise<Mk[]> {
    const tracks = await db.select().from(trackedMks).where(eq(trackedMks.userId, userId))
    const out: Mk[] = []
    for (const t of tracks) {
      const m = await this.mks.getById(t.mkId, currentKnesset)
      if (m) out.push(m)
    }
    return out
  }

  async track(userId: number, mkId: number): Promise<void> {
    await db
      .insert(trackedMks)
      .values({ userId, mkId, createdAt: new Date() })
      .onConflictDoNothing({ target: [trackedMks.userId, trackedMks.mkId] })
  }

  async untrack(userId: number, mkId: number): Promise<void> {
    await db.delete(trackedMks).where(and(eq(trackedMks.userId, userId), eq(trackedMks.mkId, mkId)))
  }

  async isTracked(userId: number, mkId: number): Promise<boolean> {
    const rows = await db.select().from(trackedMks).where(and(eq(trackedMks.userId, userId), eq(trackedMks.mkId, mkId)))
    return rows.length > 0
  }
}
```

- [ ] **Step 6: Run both to verify they pass**

Run: `npx vitest run tests/server/tracked-committees-repository.test.ts tests/server/tracked-mks-repository.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/repositories/tracked-committees-repository.ts server/repositories/tracked-mks-repository.ts tests/server/tracked-committees-repository.test.ts tests/server/tracked-mks-repository.test.ts
git commit -m "feat(db): add TrackedCommittees/TrackedMks repositories"
```

---

## Task 5: Knesset config in-memory load from DB (sync `getCurrentKnesset`)

**Files:**
- Modify: `server/services/knesset-config.ts`
- Test: `tests/server/knesset-config.test.ts` (update)

> `getCurrentKnesset()` is called synchronously across routes. Keep it sync by caching the value in a module variable loaded from `KnessetConfigRepository` at startup, instead of reading `knesset-config.json`.

- [ ] **Step 1: Open `server/services/knesset-config.ts` and read its current shape**

Run: `grep -n "config\|getCurrentKnesset\|CONFIG_PATH\|loadConfig\|export" server/services/knesset-config.ts`
Note the module-level `config` variable and `getCurrentKnesset()`.

- [ ] **Step 2: Replace the JSON load with a repo-backed in-memory load**

Replace the file-read initialization with:
```ts
import { KnessetConfigRepository } from '../repositories/knesset-config-repository'

const configRepo = new KnessetConfigRepository()
let config: { currentKnesset: number; detectedAt: string } = { currentKnesset: 25, detectedAt: new Date().toISOString() }

export async function loadConfig(): Promise<void> {
  const stored = await configRepo.get()
  if (stored) config = stored
}

export function getCurrentKnesset(): number {
  return config.currentKnesset
}
```
Replace only the **config load** (`CONFIG_PATH` read → `configRepo`) and `getCurrentKnesset`. **Leave the transition functions (`markInactiveMks`, `runTransition`, `detectKnessetTransition`) and their file writes untouched in this task** — Task 10 rewrites them. This keeps the module runnable between tasks (the transition still writes JSON until Task 10, which is harmless interim duplication). Keep the OData-fetch helpers and all current public exports.

- [ ] **Step 3: Call `loadConfig()` at startup**

In `server/index.ts`, after `runMigrations()` resolves and before/at listen, add `await loadConfig()` (import it). Concretely, inside the `runMigrations().then(...)` chain, call `loadConfig()` before `app.listen` (chain it: `.then(() => loadConfig()).then(() => { app.listen(...) })`), or `await` it in an async wrapper.

- [ ] **Step 4: Type check + run existing config test**

Run: `npx tsc --noEmit` (fix any now-broken references to removed file paths in this file).
Run: `npx vitest run tests/server/knesset-config.test.ts`
Expected: PASS (update the test if it asserted file reads — replace with seeding `knessetConfig` via repo + `loadConfig()` then asserting `getCurrentKnesset()`).

- [ ] **Step 5: Commit**

```bash
git add server/services/knesset-config.ts server/index.ts tests/server/knesset-config.test.ts
git commit -m "feat(db): load current Knesset from DB into in-memory cache (sync getCurrentKnesset)"
```

---

## Task 6: Rewire read route `parliament.ts`

**Files:**
- Modify: `server/routes/parliament.ts`
- Test: `tests/server/parliament-route.test.ts` (create or update)

- [ ] **Step 1: Write/Update the failing test** — `tests/server/parliament-route.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, bills, trackedBills } from '../../server/db/schema'
import { UsersRepository } from '../../server/repositories/users-repository'
import { BillsRepository } from '../../server/repositories/bills-repository'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'
import parliamentRouter from '../../server/routes/parliament'

const app = express()
app.use(express.json())
app.use('/api/parliament', parliamentRouter)

describe('GET /api/parliament/:type', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(trackedBills); await db.delete(bills); await db.delete(users) })

  it('returns tracked bills for the shared user', async () => {
    const userId = await new UsersRepository().getSharedUserId()
    const billId = await new BillsRepository().upsert({
      oknessetId: '', number: '1', title: 'חוק', status: 'בוועדה', committee: '',
      sourceUrl: '', documentUrl: null, knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
    })
    await new TrackedBillsRepository().track(userId, billId, 'תומכים', '', 25)
    const res = await request(app).get('/api/parliament/bill')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].position).toBe('תומכים')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/parliament-route.test.ts`
Expected: FAIL (route still reads JSON; returns file contents or 500).

- [ ] **Step 3: Rewrite `server/routes/parliament.ts`**

```ts
import { Router } from 'express'
import type { TrackingType } from '../../src/types'
import { UsersRepository } from '../repositories/users-repository'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { TrackedCommitteesRepository } from '../repositories/tracked-committees-repository'
import { TrackedMksRepository } from '../repositories/tracked-mks-repository'
import { getCurrentKnesset } from '../services/knesset-config'

const router = Router()
const users = new UsersRepository()
const trackedBills = new TrackedBillsRepository()
const trackedCommittees = new TrackedCommitteesRepository()
const trackedMks = new TrackedMksRepository()

router.get('/:type', async (req, res) => {
  const type = req.params.type as TrackingType
  try {
    const userId = await users.getSharedUserId()
    if (type === 'bill') return res.json(await trackedBills.getAll(userId, getCurrentKnesset()))
    if (type === 'committee') return res.json(await trackedCommittees.getAll(userId))
    if (type === 'mk') return res.json(await trackedMks.getAll(userId, getCurrentKnesset()))
    return res.status(400).json({ error: 'סוג לא ידוע' })
  } catch (err) {
    console.error('parliament read error:', err)
    res.status(500).json({ error: 'שגיאה בקריאת נתונים' })
  }
})

export default router
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/parliament-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/parliament.ts tests/server/parliament-route.test.ts
git commit -m "feat(db): serve parliament reads from tracked repos"
```

---

## Task 7: Rewire `tracking.ts` (add/delete)

**Files:**
- Modify: `server/routes/tracking.ts`
- Test: `tests/server/tracking-route.test.ts` (update/create)

> Preserve the URL-parse + metadata-fetch logic; replace JSON read/write with: upsert the shared entity via the entity repo, then `track()` the shared user. DELETE → `untrack()`.

- [ ] **Step 1: Update the route — replace the JSON helpers and handlers**

Rewrite `server/routes/tracking.ts` to:
- Drop `readItems`/`writeItems`/`FILE_MAP`/`fs` imports.
- Add imports: `UsersRepository`, `BillsRepository`, `CommitteesRepository`, `MksRepository`, `TrackedBillsRepository`, `TrackedCommitteesRepository`, `TrackedMksRepository`, `getCurrentKnesset`.
- In `POST /add`, keep the parse + `oknesset.getBill/Committee/Mk` / Knesset-site identity fetch exactly as today, but instead of building a JSON item and pushing, do:

```ts
const userId = await users.getSharedUserId()

// bill branch — after fetching `data`:
const billId = await billsRepo.upsert({
  oknessetId: id, number: String(data.law_id ?? ''), title: data.title,
  status: 'בוועדה', committee: data.committee ?? '', sourceUrl: url ?? '',
  documentUrl: null, knessetUrl: null, knessetNumber: getCurrentKnesset(),
  hasNewData: false, lastPolledAt: null,
})
await trackedBills.track(userId, billId, 'עוקבים', '')
return res.json({ ok: true })

// committee branch — after fetching `data`:
const committeeId = await committeesRepo.upsert({
  oknesset_id: id, name: data.name, chair: data.chairperson ?? '',
  lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null,
  sourceUrl: url ?? '', hasNewData: false, lastPolledAt: null, recentSessions: [],
})
await trackedCommittees.track(userId, committeeId)
return res.json({ ok: true })

// mk branch — build the MkInput from the identity/oknesset fetch (same fields as today,
// mapping currentRoles/activity/recentVotes), then:
const mkId = await mksRepo.upsert(mkInput)
await trackedMks.track(userId, mkId)
return res.json({ ok: true })
```
For the MK branch, construct `MkInput` (the shape `MksRepository.upsert` accepts): `{ oknesset_id, knesset_site_id, name, email, photoUrl, votingSummary: null, sourceUrl, hasNewData: false, lastPolledAt, terms: [{ knessetNumber: getCurrentKnesset(), faction: identity.faction ?? data.party ?? '' }], currentRoles, activity, recentVotes: [] }` — reusing the exact `currentRoles`/`activity` mapping the current code builds.

- In `DELETE /:type/:id`:
```ts
const userId = await users.getSharedUserId()
const entityId = Number(req.params.id)
if (type === 'bill') await trackedBills.untrack(userId, entityId)
else if (type === 'committee') await trackedCommittees.untrack(userId, entityId)
else if (type === 'mk') await trackedMks.untrack(userId, entityId)
else return res.status(400).json({ error: 'סוג לא ידוע' })
res.json({ ok: true })
```

- [ ] **Step 2: Write/Update `tests/server/tracking-route.test.ts`**

Mock the external services (`OknessetClient`, `getMkBySiteId`, `fetchMkActivity`, `parseKnessetUrl`) as the existing test does, seed a pglite DB, and assert: `POST /add` with a bill URL → a `bills` row + a `tracked_bills` row for the shared user; `DELETE /bill/:id` → `tracked_bills` empty but `bills` row remains. (Follow the existing tracking-route test's mocking pattern; the assertions now query the DB via repos instead of reading JSON.)

```ts
// core assertions after a successful POST /add (bill):
const userId = await new UsersRepository().getSharedUserId()
const tracked = await new TrackedBillsRepository().getAll(userId, 25)
expect(tracked).toHaveLength(1)
// after DELETE /bill/<tracked[0].id>:
expect(await new TrackedBillsRepository().getAll(userId, 25)).toHaveLength(0)
expect(await db.select().from(bills)).toHaveLength(1)
```

- [ ] **Step 3: Run — fail then pass**

Run: `npx vitest run tests/server/tracking-route.test.ts`
Implement until PASS.

- [ ] **Step 4: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add server/routes/tracking.ts tests/server/tracking-route.test.ts
git commit -m "feat(db): tracking add/delete via entity + tracked repos"
```

---

## Task 8: Rewire `bills.ts` `/track`

**Files:**
- Modify: `server/routes/bills.ts`
- Test: `tests/server/bills-route.test.ts` (update)

- [ ] **Step 1: Replace the JSON helpers + `/track` handler**

In `server/routes/bills.ts`: remove `readBills`/`writeBills`/`fs`/`DATA_PATH`; add repo imports. Rewrite `/track`:
```ts
const { billId, name, knessetUrl } = req.body as { billId?: number; name?: string; knessetUrl?: string }
if (!billId || !name) return res.status(400).json({ error: 'billId and name required' })
const userId = await users.getSharedUserId()
const k = getCurrentKnesset()
// find existing entity by number to avoid duplicate pool rows:
const existing = (await billsRepo.getAll(k)).find((b) => b.number === String(billId) || b.title?.trim() === name.trim())
let id: number
if (existing?.id) {
  id = existing.id
} else {
  id = await billsRepo.upsert({
    oknessetId: '', number: String(billId), title: name.trim(), status: 'בוועדה',
    committee: '', sourceUrl: knessetUrl ?? '', documentUrl: null, knessetUrl: knessetUrl ?? null,
    knessetNumber: k, hasNewData: false, lastPolledAt: null,
  })
}
if (await trackedBills.isTracked(userId, id)) return res.json({ ok: true, duplicate: true })
await trackedBills.track(userId, id, 'עוקבים', '')
res.json({ ok: true })
```
The `/search`, `/recent`, `/trending`, `/policy-aligned` handlers are unchanged except `/policy-aligned` updates with Task 11's flag API.

- [ ] **Step 2: Update `tests/server/bills-route.test.ts`** to seed pglite and assert `/track` creates a tracked row (and dedups on second call). Keep existing `/search` test (mocks `fetch`).

- [ ] **Step 3: Run — fail then pass; tsc**

Run: `npx vitest run tests/server/bills-route.test.ts && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add server/routes/bills.ts tests/server/bills-route.test.ts
git commit -m "feat(db): bills /track via entity + tracked repos"
```

---

## Task 9: Rewire `committees.ts` `/track`

**Files:**
- Modify: `server/routes/committees.ts`
- Test: `tests/server/committees-route.test.ts` (update)

- [ ] **Step 1: Replace the JSON read/write in `/track`**

Remove `readCommittees`/`DATA_PATH` and the `writeFile` calls. Rewrite `/track`: dedup by finding an existing committee entity (via `committeesRepo.getAll()` matching `oknesset_id === String(committeeId)` or name), upsert if absent, then `trackedCommittees.track(userId, id)`. Move the background enrichment to update the committee **entity** via `committeesRepo.upsert(existingInputWithSessions, id)` instead of rewriting `committees.json`:
```ts
enrichCommitteeSessions(name.trim(), [], aiEnabled)
  .then(async (sessions) => {
    if (!sessions.length) return
    const c = await committeesRepo.getById(id)
    if (!c) return
    await committeesRepo.upsert({
      oknesset_id: c.oknesset_id, name: c.name, chair: c.chair,
      lastSessionDate: sessions[0].date, lastSessionSummary: c.lastSessionSummary,
      lastSessionDocumentUrl: c.lastSessionDocumentUrl, sourceUrl: c.sourceUrl,
      hasNewData: c.hasNewData, lastPolledAt: c.lastPolledAt, recentSessions: sessions,
    }, id)
  })
  .catch(() => { /* non-critical */ })
```
The `/list` handler (uses `CommitteeListRepository`) is unchanged.

- [ ] **Step 2: Update `tests/server/committees-route.test.ts`** to seed pglite and assert `/track` creates a tracked row + dedups.

- [ ] **Step 3: Run — fail then pass; tsc**

Run: `npx vitest run tests/server/committees-route.test.ts && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add server/routes/committees.ts tests/server/committees-route.test.ts
git commit -m "feat(db): committees /track via entity + tracked repos"
```

---

## Task 10: Rewire poller + transition service

**Files:**
- Modify: `server/services/poller.ts`
- Modify: `server/services/knesset-config.ts` (transition logic)
- Test: `tests/server/poller.test.ts` (update)

- [ ] **Step 1: Rewire `poller.ts` reads/writes to entity repos**

Replace `readJson('bills.json')`/`writeJson('bills.json', …)` (and committees/mks) with the entity repos:
- `const bills = await billsRepo.getAll(getCurrentKnesset())` → enrich → for each changed bill `await billsRepo.upsert({ ...mappedEntityInput }, bill.id)`.
- Same for committees (`committeesRepo.getAll()` / `.upsert(input, id)`) and mks (`mksRepo.getAll(getCurrentKnesset())` / `.upsert(input, id)`).
Keep the enrichment logic (oknesset status, committee-session-enricher, knesset-scraper) unchanged; only the read/write boundary changes. The summaries cache already uses `SummariesRepository`.

> The poller maps a full `Bill`/`Committee`/`Mk` back to the repo's `*Input`/`Entity` shape when upserting (the same field mapping the seed uses). Pass the existing `id` so it updates in place.

- [ ] **Step 2: Rewrite the transition logic in `knesset-config.ts`**

Replace `markInactiveMks` (which rewrote `mks.json`) and the cache `unlink`s with:
- On transition: `await configRepo.set(newKnesset)` then `config = { currentKnesset: newKnesset, detectedAt: new Date().toISOString() }`.
- Re-stamp terms: for each MK active in the new Knesset (from the existing OData fetch of active site IDs), ensure an `mk_knesset_terms` row for `newKnesset` — done by re-polling (the poller upserts MKs with a term for `getCurrentKnesset()`), so the transition just bumps the number and triggers a poll; currency derives from terms.
- "Clear caches": `await new MkListRepository().clear()` and `await new CommitteeListRepository().clear()`. Add a `clear()` method to each repo:
  ```ts
  // mk-list-repository.ts
  async clear(): Promise<void> { await db.delete(knessetMembersCache); this['cachedAt'] = 0 }
  // committee-list-repository.ts
  async clear(): Promise<void> { await db.delete(knessetCommitteesCache); this['cachedAt'] = 0 }
  ```

**Preserve the public exports** `detectKnessetTransition` and `runTransition` (called by `server/index.ts`) — rewrite their *bodies* to use repos, but keep the same names/signatures so callers don't break.

- [ ] **Step 3: Update `tests/server/poller.test.ts`** to seed a pglite DB with entities and assert the poller upserts changes (replace fs mocks with DB-backed assertions; keep the network mocks).

- [ ] **Step 4: Run — fail then pass; tsc**

Run: `npx vitest run tests/server/poller.test.ts tests/server/knesset-config.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add server/services/poller.ts server/services/knesset-config.ts server/repositories/mk-list-repository.ts server/repositories/committee-list-repository.ts tests/server/poller.test.ts
git commit -m "feat(db): poller + Knesset transition operate on repositories"
```

---

## Task 11: Global feature flags repo + endpoint + consumers

**Files:**
- Modify: `server/repositories/feature-flags-repository.ts`
- Create: `server/routes/feature-flags.ts`
- Modify: `server/index.ts`, `server/services/knesset-bills.ts`, `server/routes/bills.ts`, `src/types.ts`
- Test: `tests/server/feature-flags-repository.test.ts` (update), `tests/server/feature-flags-route.test.ts` (create)

- [ ] **Step 1: Update `src/types.ts`** — remove `BillsFeatureFlags`; add:
```ts
export interface FeatureFlag { enabled: boolean; value: string | null }
export type FeatureFlags = Record<string, FeatureFlag>
```

- [ ] **Step 2: Rework `feature-flags-repository.ts` to a flat global API**

```ts
import { db } from '../db/client'
import { featureFlags } from '../db/schema'
import type { FeatureFlags } from '../../src/types'

export class FeatureFlagsRepository {
  async getAll(): Promise<FeatureFlags> {
    const rows = await db.select().from(featureFlags)
    return Object.fromEntries(rows.map((r) => [r.name, { enabled: r.enabled, value: r.value }]))
  }

  async setFlag(name: string, enabled: boolean, value: string | null, description: string | null = null): Promise<void> {
    const now = new Date()
    await db
      .insert(featureFlags)
      .values({ name, enabled, value, description, updatedAt: now })
      .onConflictDoUpdate({ target: featureFlags.name, set: { enabled, value, updatedAt: now } })
  }
}
```

- [ ] **Step 3: Update `feature-flags-repository.test.ts`** to use the flat API (round-trip `setFlag('policyFilter', true, null)` then `getAll()` returns `{ policyFilter: { enabled: true, value: null } }`).

- [ ] **Step 4: Add `server/routes/feature-flags.ts`**

```ts
import { Router } from 'express'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'

const router = Router()
const repo = new FeatureFlagsRepository()

router.get('/', async (_req, res) => {
  try { res.json(await repo.getAll()) }
  catch (err) { console.error('feature-flags error:', err); res.status(500).json({ error: 'Server error' }) }
})

export default router
```
Mount it in `server/index.ts`: `import featureFlagsRouter from './routes/feature-flags'` and `app.use('/api/feature-flags', featureFlagsRouter)`.

- [ ] **Step 5: Update `knesset-bills.ts` + `bills.ts` consumers**

In `knesset-bills.ts`, replace `getBillsFlags()` usages: read the flat flags and use them by name. Where the code used `flags.trendingAlgorithm` / `flags.recentRanking` / `flags.policyFilterEnabled`, change to read from `new FeatureFlagsRepository().getAll()`:
```ts
const flags = await new FeatureFlagsRepository().getAll()
const trendingAlgorithm = flags['trendingAlgorithm']?.value ?? 'manual'
const recentRanking = flags['recentRanking']?.value ?? 'newest'
const policyFilterEnabled = flags['policyFilter']?.enabled ?? false
```
In `bills.ts` `/policy-aligned`: `const flags = await new FeatureFlagsRepository().getAll(); if (!(flags['policyFilter']?.enabled)) return res.status(404)…`. Remove the old `getBillsFlags` export/import.

- [ ] **Step 6: Add `tests/server/feature-flags-route.test.ts`** — seed flags, `GET /api/feature-flags` returns the flat map.

- [ ] **Step 7: Run — fail then pass; tsc**

Run: `npx vitest run tests/server/feature-flags-repository.test.ts tests/server/feature-flags-route.test.ts && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add server/repositories/feature-flags-repository.ts server/routes/feature-flags.ts server/index.ts server/services/knesset-bills.ts server/routes/bills.ts src/types.ts tests/server/feature-flags-repository.test.ts tests/server/feature-flags-route.test.ts
git commit -m "feat(db): flat global feature flags + GET /api/feature-flags"
```

---

## Task 12: Frontend — `useFeatureFlags` + `useBillsOverview`

**Files:**
- Create: `src/hooks/useFeatureFlags.ts`
- Modify: `src/hooks/useBillsOverview.ts`, `src/lib/api-client.ts`
- Test: `tests/components/*` as needed

- [ ] **Step 1: Add an API client method** in `src/lib/api-client.ts` for `GET /api/feature-flags` (follow the existing `api.parliament.*` pattern), returning `FeatureFlags`.

- [ ] **Step 2: Write `src/hooks/useFeatureFlags.ts`**

```ts
import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { FeatureFlags } from '@/types'

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({})
  useEffect(() => {
    let alive = true
    api.featureFlags.get().then((f) => { if (alive) setFlags(f) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return flags
}
```

- [ ] **Step 3: Update `useBillsOverview.ts`** — remove `import flagsConfig from '@/data/feature-flags.json'` and the top-level `const policyEnabled = …`. Inside the hook, call `const flags = useFeatureFlags()` and derive `const policyEnabled = flags['policyFilter']?.enabled ?? false`. Pass `policyEnabled` to the policy tab's `enabled` arg as before (now reactive once flags load).

- [ ] **Step 4: Type check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (update any test that imported `feature-flags.json` or asserted the old shape).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFeatureFlags.ts src/hooks/useBillsOverview.ts src/lib/api-client.ts tests
git commit -m "feat(web): read feature flags from API via useFeatureFlags"
```

---

## Task 13: Frontend — `useParliament` empty-init + `CommitteeCard` prop

**Files:**
- Modify: `src/hooks/useParliament.ts`, `src/components/parliament/CommitteeCard.tsx`
- Test: `tests/components/*` for these

- [ ] **Step 1: `useParliament.ts`** — remove the three `@/data/*.json` imports; change the initial state to empty arrays:
```ts
const [bills, setBills] = useState<Bill[]>([])
const [committees, setCommittees] = useState<Committee[]>([])
const [mks, setMks] = useState<Mk[]>([])
```
The existing `useEffect(() => { refresh() }, [refresh])` already loads from the API; nothing else changes.

- [ ] **Step 2: `CommitteeCard.tsx`** — remove `import trackedMksData from '@/data/mks.json'`. Add a prop `trackedMks: { knesset_site_id?: string; name: string }[]` and use it where `trackedMksData` was used (line ~10). Thread the prop from the parent that renders `CommitteeCard` (it already has the MKs from `useParliament`); update that parent and any other `CommitteeCard` usages to pass `trackedMks={mks}`.

- [ ] **Step 3: Update component tests** that rendered `CommitteeCard` (pass the new prop) or `useParliament` (no longer seeded from JSON — they should mock `api.parliament.*`).

- [ ] **Step 4: Type check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useParliament.ts src/components/parliament/CommitteeCard.tsx tests
git commit -m "feat(web): load parliament data from API only; CommitteeCard MKs via prop"
```

---

## Task 14: Seed fixtures move + `seed-db.ts` update

**Files:**
- Create: `scripts/seed-data/{bills,committees,mks,knesset-config,feature-flags,mk-annotations}.json` (moved from `src/data/`)
- Modify: `scripts/seed-db.ts`

- [ ] **Step 1: Move the curated baseline to `scripts/seed-data/`**

```bash
mkdir -p scripts/seed-data
git mv src/data/bills.json scripts/seed-data/bills.json
git mv src/data/committees.json scripts/seed-data/committees.json
git mv src/data/mks.json scripts/seed-data/mks.json
git mv src/data/knesset-config.json scripts/seed-data/knesset-config.json
git mv src/data/feature-flags.json scripts/seed-data/feature-flags.json
git mv src/data/mk-annotations.json scripts/seed-data/mk-annotations.json
```

- [ ] **Step 2: Update `scripts/seed-db.ts`**

- Change `DATA` to `path.join(process.cwd(), 'scripts/seed-data')`.
- Add `users`, `trackedBills`, `trackedCommittees`, `trackedMks` to the truncation list (children before parents: tracked_* before entities; users after tracked_*).
- Seed the shared user + tracking rows: after upserting each bill/committee/mk entity, capture its new id and insert a tracking row for the shared user. For bills, carry `position`/`notes` from the baseline JSON into `tracked_bills`.
- Replace `setBillsFlags(flagsRaw.bills)` with `setFlag` calls for the flat global flags read from `feature-flags.json` (which still has the `{ bills: {...} }` shape in the fixture — read `flagsRaw.bills` and write three flags: `setFlag('trendingAlgorithm', true, bills.trendingAlgorithm)`, `setFlag('recentRanking', true, bills.recentRanking)`, `setFlag('policyFilter', bills.policyFilterEnabled, null)`).

Concretely, the entity loops become:
```ts
const usersRepo = new UsersRepository()
const sharedUserId = await usersRepo.getSharedUserId()
const trackedBillsRepo = new TrackedBillsRepository()
// per bill:
const billId = await billsRepo.upsert({ ...mapped })
await trackedBillsRepo.track(sharedUserId, billId, b.position ?? 'עוקבים', b.notes ?? '')
// committees/mks similarly via TrackedCommittees/TrackedMks repos
```

- [ ] **Step 3: Verify the seed against the local Docker DB**

Run:
```bash
docker compose up -d --wait db
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev npm run db:reset >/dev/null 2>&1 || true
docker compose up -d --wait db
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev npm run db:seed
```
Expected: `Seeded: …` and no errors. Then check tracking rows exist:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev npx tsx -e "import {Pool} from 'pg'; const p=new Pool({connectionString:process.env.DATABASE_URL}); (async()=>{for(const t of ['tracked_bills','tracked_committees','tracked_mks','users']){const r=await p.query('select count(*)::int n from '+t);console.log(t,r.rows[0].n)}await p.end()})()"
```
Expected: `users 1`, and tracked_* counts matching the baseline.

- [ ] **Step 4: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add scripts/seed-data scripts/seed-db.ts
git commit -m "feat(db): move baseline to scripts/seed-data; seed users + tracking rows + flat flags"
```

---

## Task 15: Delete runtime JSON + final verification

**Files:**
- Delete: dormant `src/data/*.json`

- [ ] **Step 1: Confirm nothing imports/reads the doomed files**

Run:
```bash
grep -rn "data/bills.json\|data/committees.json\|data/mks.json\|data/knesset-config.json\|data/feature-flags.json\|data/mk-annotations.json\|knesset-members-cache.json\|knesset-committees-cache.json\|summaries-cache.json" src/ server/ scripts/ --include="*.ts" --include="*.tsx"
```
Expected: **no matches** (Tasks 5–14 removed them all). If anything remains, fix that consumer before deleting.

- [ ] **Step 2: Delete the dormant runtime JSON**

```bash
git rm src/data/knesset-members-cache.json src/data/knesset-committees-cache.json src/data/summaries-cache.json
# bills/committees/mks/knesset-config/feature-flags/mk-annotations were already `git mv`d to scripts/seed-data in Task 14
```
(If any of those still exist in `src/data/`, `git rm` them too.)

- [ ] **Step 3: Full verification**

Run: `npm test` → all pass.
Run: `npx tsc --noEmit` → pass.
Run: `npm run lint` → no new errors.
Run: `npm run build` → succeeds (confirms no dangling JSON imports in the frontend bundle).

- [ ] **Step 4: End-to-end smoke against local Docker**

```bash
docker compose up -d --wait db
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev npm run db:seed
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev npx tsx server/index.ts > /tmp/p2.log 2>&1 &
SRV=$!; sleep 6
curl -fsS http://localhost:3001/api/parliament/mk | head -c 200; echo
curl -fsS http://localhost:3001/api/feature-flags; echo
kill $SRV 2>/dev/null || true
```
Expected: the MK endpoint returns the seeded tracked MKs (DB-served), and `/api/feature-flags` returns the flat map. This proves the cutover end-to-end.

- [ ] **Step 5: Docs + commit**

Update `docs/data-schema.md` (add `users` + `tracked_*`, global feature flags, note the JSON is gone), `docs/architecture.md` (data flow now DB end-to-end), and `CLAUDE.md` (the Data model section: `src/data/*.json` is now static content only; curated baseline lives in `scripts/seed-data/`). Then:
```bash
git add -A
git commit -m "feat(db): remove runtime JSON datastore; Phase 2 cutover complete + docs"
```

---

## Done

After Task 15: every route, the poller, the transition service, config, and feature flags read/write Postgres; the frontend loads only from the API; the runtime JSON datastore is deleted and the curated baseline lives in `scripts/seed-data/`. Tracking is per-user against a single shared account, ready for multi-user as an additive change.
