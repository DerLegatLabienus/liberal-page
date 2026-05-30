# Database Migration — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Drizzle + Neon Postgres and move the entity, cache, and config data out of `src/data/*.json` into the database, accessed through repositories — with a pglite-backed test harness and a one-time seed script.

**Architecture:** A `server/db/` module owns the schema (split per domain), a driver-selecting client singleton, and migrations. Repositories wrap the tables and own reassembly of normalized aggregates (`Committee`, `Mk`) back into `src/types.ts` shapes. Tests run against an in-memory pglite instance, never touching Neon or disk. This phase covers entities + caches + config; the tracking-table split and the route/transition rewrites are **Phase 2** (separate plan).

**Tech Stack:** Drizzle ORM, `@neondatabase/serverless` (WebSocket Pool driver), `@electric-sql/pglite` (test only), Drizzle Kit, Vitest, tsx, Express 5.

**Spec:** `docs/superpowers/specs/2026-05-30-database-migration-design.md`

---

## File Structure

**Created:**
- `server/db/client.ts` — driver-selecting `db` singleton
- `server/db/migrate.ts` — runs migrations on startup
- `server/db/schema/index.ts` — re-exports all schema modules
- `server/db/schema/config.ts` — `knesset_config`, `feature_flags`
- `server/db/schema/bills.ts` — `bills`
- `server/db/schema/committees.ts` — `committees`, `committee_sessions`
- `server/db/schema/mks.ts` — `mks`, `mk_knesset_terms`, `mk_roles`, `mk_activity`, `mk_votes`
- `server/db/schema/caches.ts` — `knesset_members_cache`, `knesset_committees_cache`, `summaries_cache`
- `server/db/schema/annotations.ts` — `mk_annotations`
- `server/repositories/knesset-config-repository.ts`
- `server/repositories/feature-flags-repository.ts`
- `server/repositories/bills-repository.ts`
- `server/repositories/committees-repository.ts`
- `server/repositories/mks-repository.ts`
- `server/repositories/summaries-repository.ts`
- `drizzle.config.ts` — Drizzle Kit config (repo root)
- `tests/server/db-harness.ts` — pglite test helper
- One test file per repository under `tests/server/`
- `scripts/seed-db.ts` — one-time JSON → DB seed

**Modified:**
- `server/db/schema/caches.ts`-backed reworks of `server/repositories/mk-list-repository.ts`, `committee-list-repository.ts`, `mk-annotations-repository.ts`
- `server/index.ts` — call `runMigrations()` before listen
- `package.json` — add deps + `db:generate` / `db:seed` scripts
- `.env.example` — document `DATABASE_URL`

**Note on the driver seam:** `client.ts` selects pglite when `NODE_ENV === 'test'`, else Neon Pool. Because Vitest isolates module registries per file, the module-level pglite instance is effectively per-file. `db` is typed as the Neon database type; the pglite instance is assigned with an `as` cast (structurally compatible at runtime).

---

## Task 1: Install dependencies and Drizzle Kit config

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Create: `.env.example`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit @electric-sql/pglite
```
Expected: packages added, no peer-dep errors.

- [ ] **Step 2: Add scripts to package.json**

In `package.json` `"scripts"`, add:
```json
"db:generate": "drizzle-kit generate",
"db:seed": "tsx scripts/seed-db.ts"
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
```

- [ ] **Step 4: Create `.env.example`**

```
# Neon serverless Postgres connection string (WebSocket Pool driver)
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts .env.example
git commit -m "chore(db): add drizzle + neon + pglite deps and config"
```

---

## Task 2: Schema — config tables

**Files:**
- Create: `server/db/schema/config.ts`
- Create: `server/db/schema/index.ts`

- [ ] **Step 1: Write `server/db/schema/config.ts`**

```ts
import { pgTable, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const knessetConfig = pgTable('knesset_config', {
  id: integer('id').primaryKey(), // always 1
  currentKnesset: integer('current_knesset').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
})

export const featureFlags = pgTable('feature_flags', {
  name: text('name').primaryKey(),
  enabled: boolean('enabled').notNull(),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})
```

- [ ] **Step 2: Write `server/db/schema/index.ts`**

```ts
export * from './config'
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from new files).

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/config.ts server/db/schema/index.ts
git commit -m "feat(db): add config schema (knesset_config, feature_flags)"
```

---

## Task 3: DB client + test harness

**Files:**
- Create: `server/db/client.ts`
- Create: `server/db/migrate.ts`
- Create: `tests/server/db-harness.ts`

- [ ] **Step 1: Write `server/db/client.ts`**

```ts
import { createRequire } from 'module'
import { drizzle as drizzleNeon, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import * as schema from './schema'

export type DB = NeonDatabase<typeof schema>

function createDb(): DB {
  if (process.env.NODE_ENV === 'test') {
    // createRequire gives a working `require` under ESM (tsx/Vite), so pglite —
    // a devDependency absent in production — is only loaded in test mode.
    const require = createRequire(import.meta.url)
    const { PGlite } = require('@electric-sql/pglite')
    const { drizzle: drizzlePglite } = require('drizzle-orm/pglite')
    return drizzlePglite(new PGlite(), { schema }) as unknown as DB
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return drizzleNeon(pool, { schema })
}

export const db: DB = createDb()
```

- [ ] **Step 2: Write `server/db/migrate.ts`**

```ts
import path from 'path'
import { db } from './client'

const MIGRATIONS_DIR = path.join(process.cwd(), 'server/db/migrations')

export async function runMigrations(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR })
    return
  }
  const { migrate } = await import('drizzle-orm/neon-serverless/migrator')
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}
```

- [ ] **Step 3: Write `tests/server/db-harness.ts`**

```ts
import { runMigrations } from '../../server/db/migrate'
import { db } from '../../server/db/client'

// Applies the schema to the per-file in-memory pglite instance.
// Call once in beforeAll; the same `db` is shared across the file's tests.
export async function setupTestDb() {
  await runMigrations()
  return db
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db/client.ts server/db/migrate.ts tests/server/db-harness.ts
git commit -m "feat(db): add driver-selecting client, migrator, test harness"
```

---

## Task 4: Generate the first migration

**Files:**
- Create: `server/db/migrations/*` (generated)

- [ ] **Step 1: Generate migration from the config schema**

Run: `npm run db:generate`
Expected: creates `server/db/migrations/0000_*.sql` and `server/db/migrations/meta/_journal.json` containing `CREATE TABLE knesset_config` and `CREATE TABLE feature_flags`.

> Note: this command reads only the schema files, not `DATABASE_URL`. It works offline. We will regenerate (a new numbered migration) as we add tables in later tasks.

- [ ] **Step 2: Verify the migration applies under pglite**

Create a temporary check by running the first repository test in Task 5 — but for now, confirm the files exist:
Run: `ls server/db/migrations`
Expected: a `.sql` file and a `meta/` directory.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations
git commit -m "feat(db): generate initial migration (config tables)"
```

---

## Task 5: KnessetConfigRepository

**Files:**
- Create: `server/repositories/knesset-config-repository.ts`
- Test: `tests/server/knesset-config-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetConfig } from '../../server/db/schema'
import { KnessetConfigRepository } from '../../server/repositories/knesset-config-repository'

describe('KnessetConfigRepository', () => {
  const repo = new KnessetConfigRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(knessetConfig) })

  it('get() returns null when unset', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('set() then get() round-trips currentKnesset', async () => {
    await repo.set(25)
    const cfg = await repo.get()
    expect(cfg?.currentKnesset).toBe(25)
    expect(cfg?.detectedAt).toBeTruthy()
  })

  it('set() is upsert (single row id=1)', async () => {
    await repo.set(25)
    await repo.set(26)
    const rows = await db.select().from(knessetConfig)
    expect(rows).toHaveLength(1)
    expect(rows[0].currentKnesset).toBe(26)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/knesset-config-repository.test.ts`
Expected: FAIL — module `knesset-config-repository` not found.

- [ ] **Step 3: Write `server/repositories/knesset-config-repository.ts`**

```ts
import { db } from '../db/client'
import { knessetConfig } from '../db/schema'

export interface KnessetConfigValue {
  currentKnesset: number
  detectedAt: string
}

export class KnessetConfigRepository {
  async get(): Promise<KnessetConfigValue | null> {
    const rows = await db.select().from(knessetConfig)
    const row = rows[0]
    if (!row) return null
    return { currentKnesset: row.currentKnesset, detectedAt: row.detectedAt.toISOString() }
  }

  async set(currentKnesset: number): Promise<void> {
    await db
      .insert(knessetConfig)
      .values({ id: 1, currentKnesset, detectedAt: new Date() })
      .onConflictDoUpdate({
        target: knessetConfig.id,
        set: { currentKnesset, detectedAt: new Date() },
      })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/knesset-config-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/knesset-config-repository.ts tests/server/knesset-config-repository.test.ts
git commit -m "feat(db): add KnessetConfigRepository with round-trip tests"
```

---

## Task 6: FeatureFlagsRepository (rows ↔ BillsFeatureFlags)

**Files:**
- Create: `server/repositories/feature-flags-repository.ts`
- Test: `tests/server/feature-flags-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { featureFlags } from '../../server/db/schema'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

describe('FeatureFlagsRepository', () => {
  const repo = new FeatureFlagsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(featureFlags) })

  it('getBillsFlags() returns defaults when empty', async () => {
    const flags = await repo.getBillsFlags()
    expect(flags).toEqual({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: false })
  })

  it('round-trips a full flag set', async () => {
    await repo.setBillsFlags({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true })
    const flags = await repo.getBillsFlags()
    expect(flags).toEqual({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/feature-flags-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/repositories/feature-flags-repository.ts`**

```ts
import { db } from '../db/client'
import { featureFlags } from '../db/schema'
import type { BillsFeatureFlags } from '../../src/types'

const DEFAULTS: BillsFeatureFlags = {
  trendingAlgorithm: 'manual',
  recentRanking: 'newest',
  policyFilterEnabled: false,
}

export class FeatureFlagsRepository {
  async getBillsFlags(): Promise<BillsFeatureFlags> {
    const rows = await db.select().from(featureFlags)
    const byName = new Map(rows.map((r) => [r.name, r]))
    return {
      trendingAlgorithm:
        (byName.get('trendingAlgorithm')?.value as BillsFeatureFlags['trendingAlgorithm']) ??
        DEFAULTS.trendingAlgorithm,
      recentRanking:
        (byName.get('recentRanking')?.value as BillsFeatureFlags['recentRanking']) ??
        DEFAULTS.recentRanking,
      policyFilterEnabled: byName.get('policyFilter')?.enabled ?? DEFAULTS.policyFilterEnabled,
    }
  }

  async setBillsFlags(flags: BillsFeatureFlags): Promise<void> {
    const now = new Date()
    const rows = [
      { name: 'trendingAlgorithm', enabled: true, value: flags.trendingAlgorithm, description: 'Trending tab ranking source', updatedAt: now },
      { name: 'recentRanking', enabled: true, value: flags.recentRanking, description: 'Recent tab ordering', updatedAt: now },
      { name: 'policyFilter', enabled: flags.policyFilterEnabled, value: null, description: 'Policy-aligned tab toggle', updatedAt: now },
    ]
    for (const row of rows) {
      await db
        .insert(featureFlags)
        .values(row)
        .onConflictDoUpdate({ target: featureFlags.name, set: { enabled: row.enabled, value: row.value, updatedAt: now } })
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/feature-flags-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/feature-flags-repository.ts tests/server/feature-flags-repository.test.ts
git commit -m "feat(db): add FeatureFlagsRepository (rows <-> BillsFeatureFlags)"
```

---

## Task 7: Schema — bills + regenerate migration

**Files:**
- Create: `server/db/schema/bills.ts`
- Modify: `server/db/schema/index.ts`
- Create: `server/db/migrations/*` (regenerated)

- [ ] **Step 1: Write `server/db/schema/bills.ts`**

```ts
import { pgTable, serial, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const bills = pgTable('bills', {
  id: serial('id').primaryKey(),
  oknessetId: text('oknesset_id').notNull().default(''),
  number: text('number').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  committee: text('committee').notNull().default(''),
  sourceUrl: text('source_url').notNull(),
  documentUrl: text('document_url'),
  knessetUrl: text('knesset_url'),
  knessetNumber: integer('knesset_number').notNull(),
  hasNewData: boolean('has_new_data').notNull().default(false),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
})
```

- [ ] **Step 2: Add to `server/db/schema/index.ts`**

```ts
export * from './config'
export * from './bills'
```

- [ ] **Step 3: Regenerate migration**

Run: `npm run db:generate`
Expected: a new `0001_*.sql` adding `CREATE TABLE bills`.

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/bills.ts server/db/schema/index.ts server/db/migrations
git commit -m "feat(db): add bills entity schema"
```

---

## Task 8: BillsRepository (entity pool + derived inactive)

**Files:**
- Create: `server/repositories/bills-repository.ts`
- Test: `tests/server/bills-repository.test.ts`

> Phase 1 stores bill *entities* (no `position`/`notes` — those are Phase 2 tracking fields). The repository maps the entity row to a partial `Bill` and derives `inactive` against the current Knesset.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { bills } from '../../server/db/schema'
import { BillsRepository } from '../../server/repositories/bills-repository'

const ENTITY = {
  oknessetId: '', number: '1044632', title: 'הצעת חוק', status: 'בוועדה',
  committee: '', sourceUrl: 'https://example.gov.il/bill', documentUrl: null,
  knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
}

describe('BillsRepository', () => {
  const repo = new BillsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(bills) })

  it('upsert() then getById() round-trips entity fields', async () => {
    const id = await repo.upsert(ENTITY)
    const bill = await repo.getById(id, 25)
    expect(bill?.number).toBe('1044632')
    expect(bill?.status).toBe('בוועדה')
  })

  it('derives inactive=false for current Knesset, true for older', async () => {
    const id = await repo.upsert({ ...ENTITY, knessetNumber: 25 })
    expect((await repo.getById(id, 25))?.inactive).toBe(false)
    expect((await repo.getById(id, 26))?.inactive).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/bills-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/repositories/bills-repository.ts`**

```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { bills } from '../db/schema'
import type { Bill } from '../../src/types'

export type BillEntity = typeof bills.$inferInsert

export class BillsRepository {
  async upsert(entity: BillEntity): Promise<number> {
    const [row] = await db.insert(bills).values(entity).returning({ id: bills.id })
    return row.id
  }

  async getById(id: number, currentKnesset: number): Promise<Partial<Bill> | null> {
    const rows = await db.select().from(bills).where(eq(bills.id, id))
    const row = rows[0]
    if (!row) return null
    return this.toBill(row, currentKnesset)
  }

  async getAll(currentKnesset: number): Promise<Partial<Bill>[]> {
    const rows = await db.select().from(bills)
    return rows.map((r) => this.toBill(r, currentKnesset))
  }

  private toBill(row: typeof bills.$inferSelect, currentKnesset: number): Partial<Bill> {
    return {
      id: row.id,
      oknesset_id: row.oknessetId,
      number: row.number,
      title: row.title,
      status: row.status as Bill['status'],
      committee: row.committee,
      sourceUrl: row.sourceUrl,
      documentUrl: row.documentUrl,
      knessetUrl: row.knessetUrl ?? undefined,
      hasNewData: row.hasNewData,
      lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
      inactive: row.knessetNumber !== currentKnesset,
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/bills-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/bills-repository.ts tests/server/bills-repository.test.ts
git commit -m "feat(db): add BillsRepository with derived inactive"
```

---

## Task 9: Schema — committees + committee_sessions

**Files:**
- Create: `server/db/schema/committees.ts`
- Modify: `server/db/schema/index.ts`
- Regenerate migration

- [ ] **Step 1: Write `server/db/schema/committees.ts`**

```ts
import { pgTable, serial, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const committees = pgTable('committees', {
  id: serial('id').primaryKey(),
  oknessetId: text('oknesset_id').notNull().default(''),
  name: text('name').notNull(),
  chair: text('chair').notNull().default(''),
  lastSessionDate: timestamp('last_session_date', { withTimezone: true }),
  lastSessionSummary: text('last_session_summary'),
  lastSessionDocumentUrl: text('last_session_document_url'),
  sourceUrl: text('source_url').notNull(),
  hasNewData: boolean('has_new_data').notNull().default(false),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
})

export const committeeSessions = pgTable('committee_sessions', {
  sessionId: integer('session_id').primaryKey(),
  committeeId: integer('committee_id')
    .notNull()
    .references(() => committees.id, { onDelete: 'restrict' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  knessetNum: integer('knesset_num').notNull(),
  title: text('title').notNull(),
  sessionUrl: text('session_url').notNull(),
  attendingSiteIds: text('attending_site_ids').array().notNull().default([]),
  aiSummary: text('ai_summary'),
})
```

- [ ] **Step 2: Add `export * from './committees'` to `server/db/schema/index.ts`**

- [ ] **Step 3: Regenerate + type check**

Run: `npm run db:generate && npx tsc --noEmit`
Expected: new migration adds both tables; tsc PASS.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/committees.ts server/db/schema/index.ts server/db/migrations
git commit -m "feat(db): add committees + committee_sessions schema"
```

---

## Task 10: CommitteesRepository (reassembly)

**Files:**
- Create: `server/repositories/committees-repository.ts`
- Test: `tests/server/committees-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { committees, committeeSessions } from '../../server/db/schema'
import { CommitteesRepository } from '../../server/repositories/committees-repository'

const COMMITTEE = {
  oknesset_id: '', name: 'ועדת הכספים', chair: '',
  lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null,
  sourceUrl: 'https://example.gov.il/c/2213', hasNewData: false, lastPolledAt: null,
  recentSessions: [
    { sessionId: 9001, date: '2026-05-27T10:15:00.000Z', knessetNum: 25, title: 'דיון', sessionUrl: 'https://example.gov.il/s/9001', attendingSiteIds: ['1116'], aiSummary: 'תקציר' },
  ],
}

describe('CommitteesRepository', () => {
  const repo = new CommitteesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(committeeSessions); await db.delete(committees) })

  it('upsert() then getById() reassembles committee with sessions', async () => {
    const id = await repo.upsert(COMMITTEE)
    const c = await repo.getById(id)
    expect(c?.name).toBe('ועדת הכספים')
    expect(c?.recentSessions).toHaveLength(1)
    expect(c?.recentSessions?.[0].sessionId).toBe(9001)
    expect(c?.recentSessions?.[0].attendingSiteIds).toEqual(['1116'])
  })

  it('re-upsert replaces sessions (replace-set)', async () => {
    const id = await repo.upsert(COMMITTEE)
    await repo.upsert({ ...COMMITTEE, recentSessions: [] }, id)
    const c = await repo.getById(id)
    expect(c?.recentSessions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/committees-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/repositories/committees-repository.ts`**

```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { committees, committeeSessions } from '../db/schema'
import type { Committee, CommitteeSession } from '../../src/types'

export interface CommitteeInput {
  oknesset_id: string
  name: string
  chair: string
  lastSessionDate: string | null
  lastSessionSummary: string | null
  lastSessionDocumentUrl: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
  recentSessions: CommitteeSession[]
}

export class CommitteesRepository {
  async upsert(input: CommitteeInput, id?: number): Promise<number> {
    return db.transaction(async (tx) => {
      const values = {
        oknessetId: input.oknesset_id,
        name: input.name,
        chair: input.chair,
        lastSessionDate: input.lastSessionDate ? new Date(input.lastSessionDate) : null,
        lastSessionSummary: input.lastSessionSummary,
        lastSessionDocumentUrl: input.lastSessionDocumentUrl,
        sourceUrl: input.sourceUrl,
        hasNewData: input.hasNewData,
        lastPolledAt: input.lastPolledAt ? new Date(input.lastPolledAt) : null,
      }
      let committeeId = id
      if (committeeId) {
        await tx.update(committees).set(values).where(eq(committees.id, committeeId))
      } else {
        const [row] = await tx.insert(committees).values(values).returning({ id: committees.id })
        committeeId = row.id
      }
      await tx.delete(committeeSessions).where(eq(committeeSessions.committeeId, committeeId))
      if (input.recentSessions.length > 0) {
        await tx.insert(committeeSessions).values(
          input.recentSessions.map((s) => ({
            sessionId: s.sessionId,
            committeeId: committeeId!,
            date: new Date(s.date),
            knessetNum: s.knessetNum,
            title: s.title,
            sessionUrl: s.sessionUrl,
            attendingSiteIds: s.attendingSiteIds,
            aiSummary: s.aiSummary ?? null,
          })),
        )
      }
      return committeeId
    })
  }

  async getById(id: number): Promise<Committee | null> {
    const rows = await db.select().from(committees).where(eq(committees.id, id))
    const row = rows[0]
    if (!row) return null
    const sessions = await db.select().from(committeeSessions).where(eq(committeeSessions.committeeId, id))
    return this.toCommittee(row, sessions)
  }

  async getAll(): Promise<Committee[]> {
    const rows = await db.select().from(committees)
    const out: Committee[] = []
    for (const row of rows) {
      const sessions = await db.select().from(committeeSessions).where(eq(committeeSessions.committeeId, row.id))
      out.push(this.toCommittee(row, sessions))
    }
    return out
  }

  private toCommittee(
    row: typeof committees.$inferSelect,
    sessions: (typeof committeeSessions.$inferSelect)[],
  ): Committee {
    return {
      id: row.id,
      oknesset_id: row.oknessetId,
      name: row.name,
      chair: row.chair,
      lastSessionDate: row.lastSessionDate ? row.lastSessionDate.toISOString() : null,
      lastSessionSummary: row.lastSessionSummary,
      lastSessionDocumentUrl: row.lastSessionDocumentUrl,
      sourceUrl: row.sourceUrl,
      hasNewData: row.hasNewData,
      lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
      recentSessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        date: s.date.toISOString(),
        knessetNum: s.knessetNum,
        title: s.title,
        sessionUrl: s.sessionUrl,
        attendingSiteIds: s.attendingSiteIds,
        aiSummary: s.aiSummary ?? undefined,
      })),
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/committees-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/committees-repository.ts tests/server/committees-repository.test.ts
git commit -m "feat(db): add CommitteesRepository with session reassembly"
```

---

## Task 11: Schema — mks + terms/roles/activity/votes

**Files:**
- Create: `server/db/schema/mks.ts`
- Modify: `server/db/schema/index.ts`
- Regenerate migration

- [ ] **Step 1: Write `server/db/schema/mks.ts`**

```ts
import { pgTable, serial, integer, text, boolean, timestamp, unique } from 'drizzle-orm/pg-core'

export const mks = pgTable('mks', {
  id: serial('id').primaryKey(),
  oknessetId: text('oknesset_id').notNull().default(''),
  knessetSiteId: text('knesset_site_id'),
  name: text('name').notNull(),
  email: text('email'),
  photoUrl: text('photo_url'),
  votingSummary: text('voting_summary'),
  sourceUrl: text('source_url').notNull(),
  hasNewData: boolean('has_new_data').notNull().default(false),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
})

export const mkKnessetTerms = pgTable('mk_knesset_terms', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  knessetNumber: integer('knesset_number').notNull(),
  faction: text('faction').notNull(),
}, (t) => ({
  uniqMkKnesset: unique('uniq_mk_knesset').on(t.mkId, t.knessetNumber),
}))

export const mkRoles = pgTable('mk_roles', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  positionId: integer('position_id').notNull(),
  description: text('description').notNull(),
  committeeName: text('committee_name'),
  isCurrent: boolean('is_current').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }),
})

export const mkActivity = pgTable('mk_activity', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  type: text('type').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  sourceUrl: text('source_url'),
})

export const mkVotes = pgTable('mk_votes', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  billTitle: text('bill_title').notNull(),
  vote: text('vote').notNull(),
})
```

- [ ] **Step 2: Add `export * from './mks'` to `server/db/schema/index.ts`**

- [ ] **Step 3: Regenerate + type check**

Run: `npm run db:generate && npx tsc --noEmit`
Expected: new migration adds the five tables + unique constraint; tsc PASS.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/mks.ts server/db/schema/index.ts server/db/migrations
git commit -m "feat(db): add mks + terms/roles/activity/votes schema"
```

---

## Task 12: MksRepository (reassembly + derived party/inactive)

**Files:**
- Create: `server/repositories/mks-repository.ts`
- Test: `tests/server/mks-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../../server/db/schema'
import { MksRepository } from '../../server/repositories/mks-repository'

const MK = {
  oknesset_id: '4395', knesset_site_id: '771', name: 'אבי דיכטר',
  email: 'x@knesset.gov.il', photoUrl: 'https://example.gov.il/p/771',
  votingSummary: null, sourceUrl: 'https://example.gov.il/mk/771',
  hasNewData: false, lastPolledAt: null,
  terms: [{ knessetNumber: 25, faction: 'הליכוד' }],
  currentRoles: [{ positionId: 43, description: 'חבר כנסת', committeeName: undefined, isCurrent: true, startDate: '2006-04-17T00:00:00.000Z' }],
  activity: [{ type: 'bill_initiated' as const, date: '2026-05-01T00:00:00.000Z', title: 'הצעת חוק', detail: undefined, sourceUrl: undefined }],
  recentVotes: [{ date: '2026-05-02T00:00:00.000Z', billTitle: 'חוק', vote: 'בעד' as const }],
}

describe('MksRepository', () => {
  const repo = new MksRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(mkVotes); await db.delete(mkActivity); await db.delete(mkRoles)
    await db.delete(mkKnessetTerms); await db.delete(mks)
  })

  it('upsert() then getById() reassembles full MK', async () => {
    const id = await repo.upsert(MK)
    const mk = await repo.getById(id, 25)
    expect(mk?.name).toBe('אבי דיכטר')
    expect(mk?.currentRoles).toHaveLength(1)
    expect(mk?.activity).toHaveLength(1)
    expect(mk?.recentVotes).toHaveLength(1)
  })

  it('derives party from current-Knesset term', async () => {
    const id = await repo.upsert(MK)
    expect((await repo.getById(id, 25))?.party).toBe('הליכוד')
  })

  it('derives inactive when no term for current Knesset', async () => {
    const id = await repo.upsert(MK)
    expect((await repo.getById(id, 25))?.inactive).toBe(false)
    expect((await repo.getById(id, 26))?.inactive).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/mks-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/repositories/mks-repository.ts`**

```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../db/schema'
import type { Mk, MkRole, MkActivity, MkVote } from '../../src/types'

export interface MkTermInput { knessetNumber: number; faction: string }
export interface MkInput {
  oknesset_id: string
  knesset_site_id?: string
  name: string
  email?: string | null
  photoUrl?: string | null
  votingSummary: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
  terms: MkTermInput[]
  currentRoles: MkRole[]
  activity: MkActivity[]
  recentVotes: MkVote[]
}

export class MksRepository {
  async upsert(input: MkInput, id?: number): Promise<number> {
    return db.transaction(async (tx) => {
      const values = {
        oknessetId: input.oknesset_id,
        knessetSiteId: input.knesset_site_id ?? null,
        name: input.name,
        email: input.email ?? null,
        photoUrl: input.photoUrl ?? null,
        votingSummary: input.votingSummary,
        sourceUrl: input.sourceUrl,
        hasNewData: input.hasNewData,
        lastPolledAt: input.lastPolledAt ? new Date(input.lastPolledAt) : null,
      }
      let mkId = id
      if (mkId) {
        await tx.update(mks).set(values).where(eq(mks.id, mkId))
      } else {
        const [row] = await tx.insert(mks).values(values).returning({ id: mks.id })
        mkId = row.id
      }
      await tx.delete(mkKnessetTerms).where(eq(mkKnessetTerms.mkId, mkId))
      await tx.delete(mkRoles).where(eq(mkRoles.mkId, mkId))
      await tx.delete(mkActivity).where(eq(mkActivity.mkId, mkId))
      await tx.delete(mkVotes).where(eq(mkVotes.mkId, mkId))

      if (input.terms.length) {
        await tx.insert(mkKnessetTerms).values(input.terms.map((t) => ({ mkId: mkId!, knessetNumber: t.knessetNumber, faction: t.faction })))
      }
      if (input.currentRoles.length) {
        await tx.insert(mkRoles).values(input.currentRoles.map((r) => ({
          mkId: mkId!, positionId: r.positionId, description: r.description,
          committeeName: r.committeeName ?? null, isCurrent: r.isCurrent,
          startDate: r.startDate ? new Date(r.startDate) : null,
        })))
      }
      if (input.activity.length) {
        await tx.insert(mkActivity).values(input.activity.map((a) => ({
          mkId: mkId!, type: a.type, date: new Date(a.date), title: a.title,
          detail: a.detail ?? null, sourceUrl: a.sourceUrl ?? null,
        })))
      }
      if (input.recentVotes.length) {
        await tx.insert(mkVotes).values(input.recentVotes.map((v) => ({
          mkId: mkId!, date: new Date(v.date), billTitle: v.billTitle, vote: v.vote,
        })))
      }
      return mkId
    })
  }

  async getById(id: number, currentKnesset: number): Promise<Mk | null> {
    const rows = await db.select().from(mks).where(eq(mks.id, id))
    const row = rows[0]
    if (!row) return null
    const terms = await db.select().from(mkKnessetTerms).where(eq(mkKnessetTerms.mkId, id))
    const roles = await db.select().from(mkRoles).where(eq(mkRoles.mkId, id))
    const activity = await db.select().from(mkActivity).where(eq(mkActivity.mkId, id))
    const votes = await db.select().from(mkVotes).where(eq(mkVotes.mkId, id))
    const currentTerm = terms.find((t) => t.knessetNumber === currentKnesset)
    return {
      id: row.id,
      oknesset_id: row.oknessetId,
      knesset_site_id: row.knessetSiteId ?? undefined,
      name: row.name,
      party: currentTerm?.faction ?? terms[terms.length - 1]?.faction ?? '',
      email: row.email,
      photoUrl: row.photoUrl,
      currentRoles: roles.map((r) => ({
        positionId: r.positionId, description: r.description,
        committeeName: r.committeeName ?? undefined, isCurrent: r.isCurrent,
        startDate: r.startDate ? r.startDate.toISOString() : null,
      })),
      activity: activity.map((a) => ({
        type: a.type as MkActivity['type'], date: a.date.toISOString(),
        title: a.title, detail: a.detail ?? undefined, sourceUrl: a.sourceUrl ?? undefined,
      })),
      recentVotes: votes.map((v) => ({ date: v.date.toISOString(), billTitle: v.billTitle, vote: v.vote as MkVote['vote'] })),
      votingSummary: row.votingSummary,
      sourceUrl: row.sourceUrl,
      hasNewData: row.hasNewData,
      lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
      inactive: !currentTerm,
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/mks-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/mks-repository.ts tests/server/mks-repository.test.ts
git commit -m "feat(db): add MksRepository with reassembly + derived party/inactive"
```

---

## Task 13: Schema — caches + annotations

**Files:**
- Create: `server/db/schema/caches.ts`
- Create: `server/db/schema/annotations.ts`
- Modify: `server/db/schema/index.ts`
- Regenerate migration

- [ ] **Step 1: Write `server/db/schema/caches.ts`**

```ts
import { pgTable, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const knessetMembersCache = pgTable('knesset_members_cache', {
  siteId: integer('site_id').primaryKey(),
  name: text('name').notNull(),
  party: text('party').notNull(),
  photoUrl: text('photo_url'),
  isLiberal: boolean('is_liberal').notNull(),
  isSupporter: boolean('is_supporter').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull(),
})

export const knessetCommitteesCache = pgTable('knesset_committees_cache', {
  committeeId: integer('committee_id').primaryKey(),
  name: text('name').notNull(),
  knessetUrl: text('knesset_url').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull(),
})

export const summariesCache = pgTable('summaries_cache', {
  md5: text('md5').primaryKey(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  sourceUrl: text('source_url').notNull(),
  attendees: text('attendees').array(),
  derivedTitle: text('derived_title'),
})
```

- [ ] **Step 2: Write `server/db/schema/annotations.ts`**

```ts
import { pgTable, text, boolean } from 'drizzle-orm/pg-core'

export const mkAnnotations = pgTable('mk_annotations', {
  knessetSiteId: text('knesset_site_id').primaryKey(),
  isLiberal: boolean('is_liberal').notNull(),
  isSupporter: boolean('is_supporter').notNull(),
})
```

- [ ] **Step 3: Add both to `server/db/schema/index.ts`**

```ts
export * from './config'
export * from './bills'
export * from './committees'
export * from './mks'
export * from './caches'
export * from './annotations'
```

- [ ] **Step 4: Regenerate + type check**

Run: `npm run db:generate && npx tsc --noEmit`
Expected: new migration adds four tables; tsc PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/caches.ts server/db/schema/annotations.ts server/db/schema/index.ts server/db/migrations
git commit -m "feat(db): add caches + annotations schema"
```

---

## Task 14: Rework cache/annotation repositories to DB

**Files:**
- Modify: `server/repositories/mk-list-repository.ts`
- Modify: `server/repositories/committee-list-repository.ts`
- Modify: `server/repositories/mk-annotations-repository.ts`
- Create: `server/repositories/summaries-repository.ts`
- Test: update `tests/server/mk-list-repository.test.ts`, `tests/server/mk-annotations-repository.test.ts`; create `tests/server/summaries-repository.test.ts`

> The existing cache/annotation repos use `fs/promises` and are tested with `vi.mock('fs/promises')`. Rework them to the DB and replace the fs-mock tests with pglite round-trip tests, preserving the public method names so callers are unaffected. (`committee-list-repository.ts` has no dedicated test today — add one.)

- [ ] **Step 1: Rewrite `server/repositories/mk-annotations-repository.ts`**

```ts
import { db } from '../db/client'
import { mkAnnotations } from '../db/schema'

interface Annotation { isLiberal: boolean; isSupporter: boolean }

export class MkAnnotationsRepository {
  async getAll(): Promise<Record<string, Annotation>> {
    const rows = await db.select().from(mkAnnotations)
    return Object.fromEntries(rows.map((r) => [r.knessetSiteId, { isLiberal: r.isLiberal, isSupporter: r.isSupporter }]))
  }

  async set(siteId: string, annotation: Annotation): Promise<void> {
    await db
      .insert(mkAnnotations)
      .values({ knessetSiteId: siteId, isLiberal: annotation.isLiberal, isSupporter: annotation.isSupporter })
      .onConflictDoUpdate({ target: mkAnnotations.knessetSiteId, set: { isLiberal: annotation.isLiberal, isSupporter: annotation.isSupporter } })
  }
}
```

- [ ] **Step 2: Replace `tests/server/mk-annotations-repository.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { mkAnnotations } from '../../server/db/schema'
import { MkAnnotationsRepository } from '../../server/repositories/mk-annotations-repository'

describe('MkAnnotationsRepository', () => {
  const repo = new MkAnnotationsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(mkAnnotations) })

  it('set() then getAll() round-trips', async () => {
    await repo.set('1116', { isLiberal: true, isSupporter: false })
    expect(await repo.getAll()).toEqual({ '1116': { isLiberal: true, isSupporter: false } })
  })

  it('set() upserts existing site id', async () => {
    await repo.set('1116', { isLiberal: true, isSupporter: false })
    await repo.set('1116', { isLiberal: false, isSupporter: true })
    expect((await repo.getAll())['1116']).toEqual({ isLiberal: false, isSupporter: true })
  })
})
```

- [ ] **Step 3: Rewrite `server/repositories/mk-list-repository.ts`**

```ts
import { db } from '../db/client'
import { knessetMembersCache } from '../db/schema'
import type { KnessetMember } from '../../src/types'

export class MkListRepository {
  private cachedAt = 0

  async get(): Promise<KnessetMember[] | null> {
    const rows = await db.select().from(knessetMembersCache)
    if (rows.length === 0) return null
    this.cachedAt = rows[0].cachedAt.getTime()
    return rows.map((r) => ({
      siteId: r.siteId, name: r.name, party: r.party,
      photoUrl: r.photoUrl, isLiberal: r.isLiberal, isSupporter: r.isSupporter,
    }))
  }

  async set(members: KnessetMember[]): Promise<void> {
    const cachedAt = new Date()
    this.cachedAt = cachedAt.getTime()
    await db.transaction(async (tx) => {
      await tx.delete(knessetMembersCache)
      if (members.length) {
        await tx.insert(knessetMembersCache).values(members.map((m) => ({
          siteId: m.siteId, name: m.name, party: m.party,
          photoUrl: m.photoUrl, isLiberal: m.isLiberal, isSupporter: m.isSupporter, cachedAt,
        })))
      }
    })
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
```

- [ ] **Step 4: Replace `tests/server/mk-list-repository.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetMembersCache } from '../../server/db/schema'
import { MkListRepository } from '../../server/repositories/mk-list-repository'

const MEMBER = { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false }

describe('MkListRepository', () => {
  const repo = new MkListRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(knessetMembersCache) })

  it('get() returns null when cache empty', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('set() then get() round-trips members', async () => {
    await repo.set([MEMBER])
    const result = await repo.get()
    expect(result).toHaveLength(1)
    expect(result![0].siteId).toBe(1116)
  })

  it('set() replaces previous members wholesale', async () => {
    await repo.set([MEMBER])
    await repo.set([{ ...MEMBER, siteId: 1117, name: 'אחר' }])
    const result = await repo.get()
    expect(result).toHaveLength(1)
    expect(result![0].siteId).toBe(1117)
  })
})
```

- [ ] **Step 5: Rewrite `server/repositories/committee-list-repository.ts`**

Open the existing file to confirm its public methods, then mirror the `MkListRepository` shape against `knessetCommitteesCache`:

```ts
import { db } from '../db/client'
import { knessetCommitteesCache } from '../db/schema'
import type { CommitteeListItem } from '../../src/types'

export class CommitteeListRepository {
  private cachedAt = 0

  async get(): Promise<CommitteeListItem[] | null> {
    const rows = await db.select().from(knessetCommitteesCache)
    if (rows.length === 0) return null
    this.cachedAt = rows[0].cachedAt.getTime()
    return rows.map((r) => ({ committeeId: r.committeeId, name: r.name, knessetUrl: r.knessetUrl }))
  }

  async set(items: CommitteeListItem[]): Promise<void> {
    const cachedAt = new Date()
    this.cachedAt = cachedAt.getTime()
    await db.transaction(async (tx) => {
      await tx.delete(knessetCommitteesCache)
      if (items.length) {
        await tx.insert(knessetCommitteesCache).values(items.map((c) => ({
          committeeId: c.committeeId, name: c.name, knessetUrl: c.knessetUrl, cachedAt,
        })))
      }
    })
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
```

> If the existing `committee-list-repository.ts` exposes additional methods or a different `CommitteeListItem` shape, preserve those signatures — adjust the mapping above rather than the public API.

- [ ] **Step 6: Create `server/repositories/summaries-repository.ts`**

```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { summariesCache } from '../db/schema'

export interface SummaryEntry {
  summary: string
  createdAt: string
  sourceUrl: string
  attendees?: string[]
  derivedTitle?: string
}

export class SummariesRepository {
  async get(md5: string): Promise<SummaryEntry | null> {
    const rows = await db.select().from(summariesCache).where(eq(summariesCache.md5, md5))
    const row = rows[0]
    if (!row) return null
    return {
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      sourceUrl: row.sourceUrl,
      attendees: row.attendees ?? undefined,
      derivedTitle: row.derivedTitle ?? undefined,
    }
  }

  async set(md5: string, entry: SummaryEntry): Promise<void> {
    await db
      .insert(summariesCache)
      .values({
        md5, summary: entry.summary, createdAt: new Date(entry.createdAt),
        sourceUrl: entry.sourceUrl, attendees: entry.attendees ?? null, derivedTitle: entry.derivedTitle ?? null,
      })
      .onConflictDoUpdate({
        target: summariesCache.md5,
        set: { summary: entry.summary, createdAt: new Date(entry.createdAt), sourceUrl: entry.sourceUrl, attendees: entry.attendees ?? null, derivedTitle: entry.derivedTitle ?? null },
      })
  }
}
```

- [ ] **Step 7: Create `tests/server/summaries-repository.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { summariesCache } from '../../server/db/schema'
import { SummariesRepository } from '../../server/repositories/summaries-repository'

describe('SummariesRepository', () => {
  const repo = new SummariesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(summariesCache) })

  it('get() returns null for a missing md5', async () => {
    expect(await repo.get('abc')).toBeNull()
  })

  it('set() then get() round-trips, including attendees', async () => {
    await repo.set('abc', { summary: 'תקציר', createdAt: '2026-05-01T00:00:00.000Z', sourceUrl: 'https://x', attendees: ['1116'] })
    const e = await repo.get('abc')
    expect(e?.summary).toBe('תקציר')
    expect(e?.attendees).toEqual(['1116'])
  })
})
```

- [ ] **Step 8: Run all reworked repository tests**

Run: `npx vitest run tests/server/mk-annotations-repository.test.ts tests/server/mk-list-repository.test.ts tests/server/summaries-repository.test.ts`
Expected: PASS.

- [ ] **Step 9: Type check + commit**

Run: `npx tsc --noEmit`
```bash
git add server/repositories tests/server
git commit -m "feat(db): move cache/annotation repos to Postgres + add SummariesRepository"
```

---

## Task 15: Wire migrations into server startup

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Read `server/index.ts` to find the listen call**

Run: `grep -n "listen\|app\b\|startPoller\|import" server/index.ts`
Expected: identify where the server starts listening and the poller is kicked off.

- [ ] **Step 2: Import and call `runMigrations()` before listen**

At the top of `server/index.ts` add:
```ts
import { runMigrations } from './db/migrate'
```
Wrap the listen/poller startup so migrations run first. Replace the bare `app.listen(...)` startup with:
```ts
runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on :${PORT}`)
      // existing poller startup call stays here
    })
  })
  .catch((err) => {
    console.error('Migration failed, server not started:', err)
    process.exit(1)
  })
```
> Match `PORT` and the poller-start call to whatever the existing file uses; only the migration wrapper is new.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(db): run migrations on server startup"
```

---

## Task 16: Seed script (JSON → DB)

**Files:**
- Create: `scripts/seed-db.ts`

> Loads the existing mutable JSON and writes through the repositories. Phase 1 seeds entities + config (`knesset_config`, `feature_flags`) + `mk_annotations`. The two list caches (`knesset_members_cache`, `knesset_committees_cache`) and `summaries_cache` are **not** seeded — the poller and summarizer repopulate them on first run. Bill `position`/`notes` from `bills.json` are **not** seeded here — they belong to `tracked_bills` in Phase 2; this script seeds bill entities only. Existing rows are stamped with the current Knesset.

- [ ] **Step 1: Write `scripts/seed-db.ts`**

```ts
import 'dotenv/config'
import { readFile } from 'fs/promises'
import path from 'path'
import { runMigrations } from '../server/db/migrate'
import { KnessetConfigRepository } from '../server/repositories/knesset-config-repository'
import { FeatureFlagsRepository } from '../server/repositories/feature-flags-repository'
import { BillsRepository } from '../server/repositories/bills-repository'
import { CommitteesRepository } from '../server/repositories/committees-repository'
import { MksRepository } from '../server/repositories/mks-repository'
import { MkAnnotationsRepository } from '../server/repositories/mk-annotations-repository'
import type { Bill, BillsFeatureFlags, Committee, Mk } from '../src/types'

const DATA = path.join(process.cwd(), 'src/data')
const readJson = async <T>(f: string): Promise<T> => JSON.parse(await readFile(path.join(DATA, f), 'utf-8'))

async function main() {
  await runMigrations()

  const cfgRaw = await readJson<{ currentKnesset: number }>('knesset-config.json')
  const currentKnesset = cfgRaw.currentKnesset
  await new KnessetConfigRepository().set(currentKnesset)

  const flagsRaw = await readJson<{ bills: BillsFeatureFlags }>('feature-flags.json')
  await new FeatureFlagsRepository().setBillsFlags(flagsRaw.bills)

  const bills = await readJson<Bill[]>('bills.json')
  const billsRepo = new BillsRepository()
  for (const b of bills) {
    await billsRepo.upsert({
      oknessetId: b.oknesset_id, number: b.number, title: b.title, status: b.status,
      committee: b.committee, sourceUrl: b.sourceUrl, documentUrl: b.documentUrl,
      knessetUrl: b.knessetUrl ?? null, knessetNumber: currentKnesset,
      hasNewData: b.hasNewData, lastPolledAt: b.lastPolledAt ? new Date(b.lastPolledAt) : null,
    })
  }

  const committees = await readJson<Committee[]>('committees.json')
  const committeesRepo = new CommitteesRepository()
  for (const c of committees) {
    await committeesRepo.upsert({
      oknesset_id: c.oknesset_id, name: c.name, chair: c.chair,
      lastSessionDate: c.lastSessionDate, lastSessionSummary: c.lastSessionSummary,
      lastSessionDocumentUrl: c.lastSessionDocumentUrl, sourceUrl: c.sourceUrl,
      hasNewData: c.hasNewData, lastPolledAt: c.lastPolledAt,
      recentSessions: c.recentSessions ?? [],
    })
  }

  const mksData = await readJson<Mk[]>('mks.json')
  const mksRepo = new MksRepository()
  for (const m of mksData) {
    await mksRepo.upsert({
      oknesset_id: m.oknesset_id, knesset_site_id: m.knesset_site_id, name: m.name,
      email: m.email, photoUrl: m.photoUrl, votingSummary: m.votingSummary, sourceUrl: m.sourceUrl,
      hasNewData: m.hasNewData, lastPolledAt: m.lastPolledAt,
      terms: [{ knessetNumber: currentKnesset, faction: m.party.trim() }],
      currentRoles: m.currentRoles ?? [], activity: m.activity ?? [], recentVotes: m.recentVotes ?? [],
    })
  }

  const annotations = await readJson<Record<string, { isLiberal: boolean; isSupporter: boolean }>>('mk-annotations.json')
  const annRepo = new MkAnnotationsRepository()
  for (const [siteId, ann] of Object.entries(annotations)) {
    await annRepo.set(siteId, ann)
  }

  console.log(`Seeded: ${bills.length} bills, ${committees.length} committees, ${mksData.length} MKs.`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

> `dotenv` is already transitively available via tsx env loading; if `import 'dotenv/config'` fails, run with `DATABASE_URL=... npx tsx scripts/seed-db.ts` instead. The script targets the **real** DB (not test) — set `DATABASE_URL` and leave `NODE_ENV` unset.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Dry-run note**

The seed requires a live `DATABASE_URL` (Neon). With it set:
Run: `npm run db:seed`
Expected: `Seeded: N bills, M committees, K MKs.` This step is operational (needs the Neon instance) and may be deferred to deployment; the type check above is the gate for the plan.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-db.ts
git commit -m "feat(db): add one-time JSON -> Postgres seed script (entities + config)"
```

---

## Task 17: Full suite + docs

**Files:**
- Modify: `docs/architecture.md`, `docs/data-schema.md` (if present)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (new repository tests + unchanged component tests).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Update docs**

In `docs/data-schema.md` (create if missing), document the new tables and the entity-vs-tracking split. In `docs/architecture.md`, note the `server/db/` module, the driver seam, and that migrations run on startup. In root `CLAUDE.md`, add `npm run db:generate` and `npm run db:seed` to the Commands section and `DATABASE_URL` to required env.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: document DB module, schema, and db scripts (phase 1)"
```

---

## Phase 1 Done — What's Next (Phase 2)

Phase 2 gets its own plan and covers:
- `tracked_bills` / `tracked_committees` / `tracked_mks` tables + repositories (with `position`/`notes`).
- Rewrite `server/routes/tracking.ts` to entity-pool + tracking-row semantics (delete = remove tracking row).
- Wire `GET /api/parliament/:type`, bills/committees/mks routes, and the poller to the new repositories.
- Rewrite `server/services/knesset-config.ts` transition logic (bump `current_knesset` + re-poll terms; truncate cache tables instead of `unlink`).
- Extend the seed to write `tracked_*` rows (bill `position`/`notes`).
- Remove runtime JSON writes once routes/poller are fully on the DB.
