# Database — Domain Schemas (Full Split A) — Design

**Date:** 2026-06-18
**Backlog:** §23
**Status:** Approved (full split A) — implementing inline.

## Goal

Move all 28 tables from the single Postgres `public` schema into 6 cohesive domain schemas on
Neon, so tables that change together live together and cross-domain references are explicit and
minimized. Organizational only — no behavior change.

## Mapping (full split A)

| Schema | Tables |
|--------|--------|
| `parliament` | bills, committees, committee_sessions, mks, mk_knesset_terms, mk_roles, mk_activity, mk_votes, mk_annotations, tracked_bills, tracked_committees, tracked_mks, knesset_members_cache, knesset_committees_cache, summaries_cache, knesset_config (16) |
| `auth` | users, refresh_tokens, allowed_emails (3) |
| `email` | email_templates, sent_emails (2) |
| `letters` | letters, letter_contacts, letter_issue_tags, letter_templates (4) |
| `analytics` | join_analytics, letter_analytics (2) |
| `config` | feature_flags (1) |

Note the Drizzle **file** grouping crosses domains, so assignment is strictly per-table:
`users` lives in `tracking.ts` but → `auth`; `letter_analytics` in `letters.ts` but → `analytics`;
`config.ts` splits (`knesset_config` → parliament, `feature_flags` → config); `tracking.ts`,
`caches.ts`, `annotations.ts` → parliament.

Remaining cross-schema FKs after the move (intentional, explicit): `parliament.tracked_* →
auth.users`, `letters.letters.created_by → auth.users`, `analytics.letter_analytics →
letters.letters`. Everything else is intra-schema.

## Approach

1. **Declare schemas:** new `server/db/schema/schemas.ts` exporting the 6 `pgSchema(...)` objects.
2. **Convert tables:** each `pgTable('name', …)` → `<domain>.table('name', …)` using the schema
   objects. Repositories reference table *objects*, so Drizzle emits schema-qualified SQL with
   **zero repository changes**.
3. **Migration 0021:** run `npm run db:generate`. Trust the generated **snapshot** (serialized
   from code). Inspect the generated `.sql`: keep it iff it is `CREATE SCHEMA IF NOT EXISTS` ×6 +
   non-destructive `ALTER TABLE … SET SCHEMA` ×28; otherwise replace the `.sql` body with the
   hand-written equivalent and keep drizzle's snapshot + journal entry. `SET SCHEMA` carries
   sequences/FKs/indexes along automatically and is fresh-DB safe (0000–0020 build in public,
   0021 moves).
4. **Audit raw SQL:** confirm `scripts/seed-db.ts` and any `sql\`…\`` in repos use no unqualified
   table names (`pg_database_size(current_database())` is schema-independent — fine).

## Verification gates (both required)

1. `npm test` — pglite applies 0021 from scratch and every Drizzle-qualified query resolves.
2. Re-run `npm run db:generate` → must report **"No schema changes."** (definitive proof the
   snapshot ↔ code are consistent; catches a half-correct snapshot that tests won't).
3. `npm run lint` && `npx tsc --noEmit` && `npm run build`.

## Production safety (BLOCKS the finish)

Unlike §22, §23 mutates the **prod** schema: `runMigrations()` runs on boot and master→Render
auto-deploys, so pushing master executes 0021 against prod Neon automatically and is hard to
reverse. Therefore: verify both gates locally → **dry-run 0021 against a throwaway Neon branch**
→ **explicit user confirmation** before the prod-affecting push/deploy. Do NOT push on the §22
reflex.
