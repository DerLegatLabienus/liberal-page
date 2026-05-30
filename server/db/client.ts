import { createRequire } from 'module'
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export type DB = NodePgDatabase<typeof schema>

function createDb(): DB {
  if (process.env.NODE_ENV === 'test') {
    // createRequire gives a working `require` under ESM (tsx/Vite), so pglite —
    // a devDependency absent in production — is only loaded in test mode.
    const require = createRequire(import.meta.url)
    const { PGlite } = require('@electric-sql/pglite')
    const { drizzle: drizzlePglite } = require('drizzle-orm/pglite')
    return drizzlePglite(new PGlite(), { schema }) as unknown as DB
  }
  // One driver for both local Docker and Neon. SSL is driven by the connection
  // string (the Neon URL carries `?sslmode=require`; the local URL carries none).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return drizzleNodePg(pool, { schema })
}

export const db: DB = createDb()
