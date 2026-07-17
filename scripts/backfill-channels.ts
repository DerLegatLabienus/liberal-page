import { eq } from 'drizzle-orm'
import { db } from '../server/db/client'
import { letters, letterChannels, letterContacts } from '../server/db/schema'
import type { LetterAddress } from '../server/db/schema'

/** Find-or-create a contact by email; returns its id. Emails are unique. */
async function contactIdForAddress(addr: LetterAddress): Promise<number> {
  const [existing] = await db.select().from(letterContacts).where(eq(letterContacts.email, addr.email))
  if (existing) return existing.id
  const [created] = await db
    .insert(letterContacts)
    .values({ displayName: addr.display_name || addr.email, email: addr.email, category: 'custom' })
    .returning()
  return created.id
}

async function idsFor(addrs: LetterAddress[]): Promise<number[]> {
  const ids: number[] = []
  for (const a of addrs) ids.push(await contactIdForAddress(a))
  return ids
}

export async function backfillChannels(): Promise<{ migrated: number }> {
  const all = await db.select().from(letters)
  let migrated = 0
  for (const l of all) {
    const [hasChannel] = await db.select().from(letterChannels).where(eq(letterChannels.letterId, l.id)).limit(1)
    if (hasChannel) continue // idempotent
    const recipientIds = await idsFor((l.toAddresses ?? []) as LetterAddress[])
    const ccIds = await idsFor((l.ccAddresses ?? []) as LetterAddress[])
    const bccIds = await idsFor((l.bccAddresses ?? []) as LetterAddress[])
    await db.insert(letterChannels).values({
      letterId: l.id,
      kind: 'email',
      enabled: true,
      recipientIds, ccIds, bccIds,
      bodyText: l.bodyPlain ?? '',
      subject: l.subject ?? '',
      bodyHtml: l.bodyHtml ?? '',
      templateId: l.templateId ?? null,
    })
    migrated++
  }
  return { migrated }
}

// Allow `tsx scripts/backfill-channels.ts` to run it directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillChannels()
    .then((r) => { console.log(`[backfill] migrated ${r.migrated} letters`); process.exit(0) })
    .catch((e) => { console.error('[backfill] failed:', e); process.exit(1) })
}
