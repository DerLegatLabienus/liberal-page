import { describe, it, expect } from 'vitest'
import { closeDb } from '../../../server/db/client'
import { stopPoller } from '../../../server/services/poller'

describe('graceful shutdown helpers', () => {
  it('closeDb resolves without throwing (no-op under pglite/tests)', async () => {
    await expect(closeDb()).resolves.toBeUndefined()
  })

  it('stopPoller is idempotent and safe when no poller is running', () => {
    expect(() => { stopPoller(); stopPoller() }).not.toThrow()
  })
})
