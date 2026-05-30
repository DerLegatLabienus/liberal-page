import { runMigrations } from '../../server/db/migrate'
import { db } from '../../server/db/client'

// Applies the schema to the per-file in-memory pglite instance.
// Call once in beforeAll; the same `db` is shared across the file's tests.
export async function setupTestDb() {
  await runMigrations()
  return db
}
