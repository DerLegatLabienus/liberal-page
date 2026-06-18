import path from 'path'
import fs from 'fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../server/db/schema'
import { PGLITE_SNAPSHOT_PATH } from '../server/db/pglite-snapshot'

// Runs once per vitest invocation (i.e. once per CI shard), before any test file.
// Migrates a throwaway pglite, dumps the migrated data dir to a temp file, and
// removes it on teardown. Each test file then loads this snapshot instead of
// replaying all migrations (see server/db/client.ts + tests/server/db-harness.ts).
export default async function setup() {
  process.env.NODE_ENV = 'test'
  const pg = new PGlite()
  const db = drizzle(pg, { schema })
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'server/db/migrations') })

  const file = await pg.dumpDataDir()
  fs.writeFileSync(PGLITE_SNAPSHOT_PATH, Buffer.from(await file.arrayBuffer()))
  await pg.close()

  return async () => {
    fs.rmSync(PGLITE_SNAPSHOT_PATH, { force: true })
  }
}
