# Storage Pressure (Orphan Purge) — Implementation Plan (#10)

> TDD. The eviction logic is tested in pglite with a **stubbed `usedBytes`**; the real
> `getDatabaseSizeBytes` (pg_database_size) is only wired into the poller.

**Goal:** Each poll cycle, if `pg_database_size > (STORAGE_LIMIT_MB − STORAGE_SLACK_MB)`,
delete at most `ORPHAN_PURGE_BATCH` (default 5) stalest orphan entities (tracked by no one),
their children, and an orphaned committee's session summary. Preserve everything else.

---

### Task 1: Repo — `findUntracked` + `deleteCascade` (TDD)
**Files:** `server/repositories/{bills,committees,mks}-repository.ts`, `server/repositories/summaries-repository.ts`; tests in `tests/server/orphan-purge-repos.test.ts`.

- `BillsRepository.findUntracked(): {id, lastPolledAt: Date|null}[]` — `notExists` anti-join on `trackedBills`.
- `BillsRepository.deleteCascade(id)` — tx: delete `trackedBills` rows → `bills` row.
- `CommitteesRepository.findUntracked(): {id, lastPolledAt, documentUrl}[]` — anti-join; `documentUrl = lastSessionDocumentUrl`.
- `CommitteesRepository.deleteCascade(id)` — tx: delete `committeeSessions`, `trackedCommittees` → `committees`.
- `MksRepository.findUntracked(): {id, lastPolledAt}[]` — anti-join on `trackedMks`.
- `MksRepository.deleteCascade(id)` — tx: delete `mkActivity, mkVotes, mkRoles, mkKnessetTerms, trackedMks` → `mks`.
- `SummariesRepository.deleteBySourceUrl(url: string|null): Promise<number>` — no-op on null/empty; else delete where `sourceUrl = url`.
- Tests: anti-join excludes tracked & multi-user (second tracker keeps it); deleteCascade removes children w/o FK error; deleteBySourceUrl deletes matching only.

### Task 2: DB size helper
**File:** `server/db/size.ts`
- `getDatabaseSizeBytes(): Promise<number|null>` — `db.execute(sql\`SELECT pg_database_size(current_database()) AS bytes\`)`, parse `rows[0].bytes` to Number; `try/catch → null` (covers pglite/local failure).

### Task 3: Service — `purgeOrphansIfNeeded` (TDD)
**Files:** `server/services/storage-manager.ts`; `tests/server/storage-manager.test.ts` (pglite, stubbed `usedBytes`).
- Signature: `purgeOrphansIfNeeded(usedBytes: () => Promise<number|null>)`.
- No-op: `STORAGE_LIMIT_MB` unset, `usedBytes()===null`, or `used ≤ (LIMIT−SLACK)·1MB`.
- Else: gather untracked from all three repos (tag type), sort by `lastPolledAt` ASC (null first) then `id` ASC, take `ORPHAN_PURGE_BATCH`; for each: committee → `summariesRepo.deleteBySourceUrl(documentUrl)`; `repo.deleteCascade(id)`; `console.log` one line. Return counts. **No re-measure.**
- Tests: no-op cases; over budget deletes ≤ batch stalest-first; second call sheds next batch; tracked never deleted; multi-user safe; committee summary matched-only deleted, caches untouched; logs per deletion.

### Task 4: Poller integration
**File:** `server/services/poller.ts`
- Import `purgeOrphansIfNeeded` + `getDatabaseSizeBytes`. In `runPollCycle`, own try/catch step: `await purgeOrphansIfNeeded(getDatabaseSizeBytes)`. Not counted toward success/backoff.

### Task 5: `.env.example` + verify
- Document `STORAGE_LIMIT_MB`, `STORAGE_SLACK_MB`, `ORPHAN_PURGE_BATCH` in `.env.example`.
- `npx tsc --noEmit` clean; `npm test` green; `npm run lint` no new errors.

### Docs (CLAUDE.md requirement)
- `docs/architecture.md`: note the orphan-purge poller step + storage-manager.
- `docs/data-schema.md`: no schema change — nothing to add (note untrack leaves orphans reclaimed by poller).
- `BACKLOG.md`: mark #10 (Storage Pressure) complete.
