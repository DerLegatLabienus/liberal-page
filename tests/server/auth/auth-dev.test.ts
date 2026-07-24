import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { allowedEmails } from '../../../server/db/schema'
import { isDevLoginAllowed, verifyDevIdentity } from '../../../server/services/auth-providers/dev'

describe('isDevLoginAllowed', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is false when ALLOW_DEV_LOGIN is unset', () => {
    vi.stubEnv('ALLOW_DEV_LOGIN', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RENDER', '')
    expect(isDevLoginAllowed()).toBe(false)
  })

  it('is true only when the flag is set, NODE_ENV is not production, and RENDER is unset', () => {
    vi.stubEnv('ALLOW_DEV_LOGIN', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RENDER', '')
    expect(isDevLoginAllowed()).toBe(true)
  })

  it('is false when NODE_ENV is production, even with the flag on', () => {
    vi.stubEnv('ALLOW_DEV_LOGIN', 'true')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RENDER', '')
    expect(isDevLoginAllowed()).toBe(false)
  })

  it('is false when RENDER is set, even with the flag on and NODE_ENV not production', () => {
    vi.stubEnv('ALLOW_DEV_LOGIN', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RENDER', 'true')
    expect(isDevLoginAllowed()).toBe(false)
  })
})

describe('verifyDevIdentity', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(allowedEmails) })

  it('maps the dev-admin sentinel to an admin identity and allowlists it', async () => {
    const identity = await verifyDevIdentity('dev-admin')
    expect(identity).toEqual({
      provider: 'dev', sub: 'dev-admin@localhost', email: 'dev-admin@localhost',
      name: 'Local Dev (admin)', emailVerified: true,
    })
    const [row] = await db.select().from(allowedEmails)
    expect(row.email).toBe('dev-admin@localhost')
    expect(row.role).toBe('admin')
  })

  it('maps any other sentinel to a member identity and allowlists it', async () => {
    const identity = await verifyDevIdentity('dev-member')
    expect(identity.email).toBe('dev-member@localhost')
    expect(identity.emailVerified).toBe(true)
    const [row] = await db.select().from(allowedEmails)
    expect(row.role).toBe('member')
  })

  it('is idempotent on repeated calls (no duplicate/conflict error)', async () => {
    await verifyDevIdentity('dev-admin')
    await expect(verifyDevIdentity('dev-admin')).resolves.toBeDefined()
    expect(await db.select().from(allowedEmails)).toHaveLength(1)
  })
})
