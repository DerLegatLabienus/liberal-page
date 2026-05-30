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
