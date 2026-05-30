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
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}
