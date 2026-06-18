import fs from 'fs'
import { runMigrations } from '../../server/db/migrate'
import { db } from '../../server/db/client'
import { PGLITE_SNAPSHOT_PATH } from '../../server/db/pglite-snapshot'

// The per-file in-memory pglite is created from the globalSetup snapshot when it
// exists (server/db/client.ts), so it is already migrated — skip runMigrations in
// that case. Fall back to migrating from scratch if there is no snapshot (e.g. the
// harness is used without globalSetup). Call once in beforeAll; the same `db` is
// shared across the file's tests.
export async function setupTestDb() {
  if (!fs.existsSync(PGLITE_SNAPSHOT_PATH)) await runMigrations()
  return db
}
