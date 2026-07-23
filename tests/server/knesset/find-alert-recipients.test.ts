import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { users, bills, trackedBills } from '../../../server/db/schema'
import { TrackedBillsRepository } from '../../../server/repositories/tracked-bills-repository'

const repo = new TrackedBillsRepository()

async function addUser(email: string | null, role: string, emailAlerts: boolean) {
  const [u] = await db.insert(users).values({ label: email ?? role, email, role, emailAlerts, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}
async function addBill(num: string) {
  const [b] = await db.insert(bills).values({ number: num, title: `b${num}`, status: 'בוועדה', sourceUrl: `https://x/${num}`, knessetNumber: 25 }).returning({ id: bills.id })
  return b.id
}

describe('findAlertRecipients', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(trackedBills); await db.delete(bills); await db.delete(users) })

  it('returns only personal trackers with an email and alerts on', async () => {
    const member = await addUser('m@x.com', 'member', true)
    const muted = await addUser('mute@x.com', 'member', false)
    const group = await addUser(null, 'group', true)
    const b1 = await addBill('1')
    for (const uid of [member, muted, group]) await db.insert(trackedBills).values({ userId: uid, billId: b1, createdAt: new Date() })

    const rows = await repo.findAlertRecipients([b1])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: member, email: 'm@x.com', billId: b1 })
  })

  it('returns [] for empty input', async () => {
    expect(await repo.findAlertRecipients([])).toEqual([])
  })
})
