import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letters, letterChannels } from '../../server/db/schema'
import { LetterChannelsRepository } from '../../server/repositories/letter-channels-repository'

const repo = new LetterChannelsRepository()

async function newLetter(): Promise<number> {
  const [row] = await db.insert(letters).values({ title: 'T', status: 'draft', priority: 'normal' }).returning()
  return row.id
}

describe('LetterChannelsRepository', () => {
  beforeEach(async () => {
    await db.delete(letterChannels)
    await db.delete(letters)
  })

  it('replaceForLetter inserts channels and is idempotent (full replace)', async () => {
    const id = await newLetter()
    await repo.replaceForLetter(id, [
      { kind: 'email', recipientIds: [1], ccIds: [2], bodyText: 'plain', subject: 'S', bodyHtml: '<p>x</p>' },
      { kind: 'sms', recipientIds: [1, 3], bodyText: 'קצר' },
    ])
    expect((await repo.listByLetter(id)).map((c) => c.kind).sort()).toEqual(['email', 'sms'])

    await repo.replaceForLetter(id, [{ kind: 'whatsapp', recipientIds: [4], bodyText: 'hi' }])
    const after = await repo.listByLetter(id)
    expect(after.map((c) => c.kind)).toEqual(['whatsapp'])
  })

  it('contactReferenced finds a contact used in any recipient list', async () => {
    const id = await newLetter()
    await repo.replaceForLetter(id, [{ kind: 'sms', recipientIds: [7], bodyText: 'x' }])
    expect(await repo.contactReferenced(7)).toBe(true)
    expect(await repo.contactReferenced(99)).toBe(false)
  })
})
