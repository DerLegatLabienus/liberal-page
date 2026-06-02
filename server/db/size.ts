import { sql } from 'drizzle-orm'
import { db } from './client'

/**
 * Current database size in bytes via `pg_database_size`. Returns null on any failure
 * (e.g. pglite in tests, where the function is unavailable) so callers treat the size as
 * unknown and skip eviction rather than crash.
 */
export async function getDatabaseSizeBytes(): Promise<number | null> {
  try {
    const result = await db.execute(sql`SELECT pg_database_size(current_database()) AS bytes`)
    // node-postgres returns { rows: [{ bytes }] }; bytes may be a string or bigint.
    const rows = (result as unknown as { rows?: Array<{ bytes: string | number | bigint }> }).rows
    const raw = rows?.[0]?.bytes
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
