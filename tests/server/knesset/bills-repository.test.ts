import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { bills } from '../../../server/db/schema'
import { BillsRepository } from '../../../server/repositories/bills-repository'

const ENTITY = {
  oknessetId: '', number: '1044632', title: 'הצעת חוק', status: 'בוועדה',
  committee: '', sourceUrl: 'https://example.gov.il/bill', documentUrl: null,
  knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
}

describe('BillsRepository', () => {
  const repo = new BillsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(bills) })

  it('upsert() then getById() round-trips entity fields', async () => {
    const id = await repo.upsert(ENTITY)
    const bill = await repo.getById(id, 25)
    expect(bill?.number).toBe('1044632')
    expect(bill?.status).toBe('בוועדה')
  })

  it('derives inactive=false for current Knesset, true for older', async () => {
    const id = await repo.upsert({ ...ENTITY, knessetNumber: 25 })
    expect((await repo.getById(id, 25))?.inactive).toBe(false)
    expect((await repo.getById(id, 26))?.inactive).toBe(true)
  })
})
