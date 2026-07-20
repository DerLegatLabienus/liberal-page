/**
 * Import every current-Knesset MK into `letters.letter_contacts` as an email contact
 * (name + official @knesset.gov.il email + photo + mk_site_id, category 'mk'), leaving the
 * ~12 Norwegian-Law ministers (no email) as photo-only. Idempotent and reconciling: it collapses
 * pre-existing duplicate/partial MK rows to exactly one contact per MK, enriching a matched row and
 * deleting only *unreferenced* duplicates — a row used by a letter is never deleted.
 *
 * Source of truth: `knesset_members_cache` (clean names + photos) + `GetMkdetailsHeader.Email`.
 *
 * Run against the target DB (dry-run first):
 *   DATABASE_URL='<neon>' npm run db:import-mks -- --dry-run
 *   DATABASE_URL='<neon>' npm run db:import-mks
 */
import { db } from '../server/db/client'
import { knessetMembersCache } from '../server/db/schema'
import { fetchMkEmail } from '../server/services/knesset-scraper'
import { LetterContactsRepository, type ContactInput } from '../server/repositories/letter-contacts-repository'
import { LetterChannelsRepository } from '../server/repositories/letter-channels-repository'

const contactsRepo = new LetterContactsRepository()
const channelsRepo = new LetterChannelsRepository()
const EMAIL_CONCURRENCY = 8

type Existing = Awaited<ReturnType<LetterContactsRepository['list']>>[number]
interface Desired { siteId: number; name: string; photoUrl: string | null; email: string | null }

/** Read the MK cache and attach each MK's live email (null for Norwegian-Law ministers). */
async function assembleDesired(): Promise<Desired[]> {
  const cache = await db.select().from(knessetMembersCache)
  const out: Desired[] = []
  for (let i = 0; i < cache.length; i += EMAIL_CONCURRENCY) {
    const chunk = cache.slice(i, i + EMAIL_CONCURRENCY)
    const emails = await Promise.all(chunk.map((m) => fetchMkEmail(m.siteId)))
    chunk.forEach((m, j) => out.push({ siteId: m.siteId, name: m.name, photoUrl: m.photoUrl, email: emails[j] }))
  }
  return out
}

/** An existing row represents this MK if it shares the Site ID, the (live) email, or the exact name. */
function matches(row: Existing, d: Desired): boolean {
  return row.mkSiteId === d.siteId || (!!d.email && row.email === d.email) || row.displayName === d.name
}

interface Plan {
  inserts: Desired[]
  updates: Array<{ id: number; input: ContactInput; from: Existing }>
  deletes: Array<{ id: number; name: string }>
  collisions: string[]
}

async function buildPlan(desired: Desired[], existing: Existing[]): Promise<Plan> {
  const referenced = new Map<number, boolean>()
  for (const c of existing) referenced.set(c.id, await channelsRepo.contactReferenced(c.id))

  const claimed = new Set<number>()
  const plan: Plan = { inserts: [], updates: [], deletes: [], collisions: [] }

  for (const d of desired) {
    const matched = existing.filter((r) => !claimed.has(r.id) && matches(r, d))
    if (matched.length === 0) {
      plan.inserts.push(d)
      continue
    }
    matched.forEach((r) => claimed.add(r.id))
    // Canonical = the row we keep: prefer a referenced row (can't be deleted), then one already
    // carrying a Site ID, then the lowest id.
    const canonical = [...matched].sort((a, b) =>
      Number(referenced.get(b.id)) - Number(referenced.get(a.id)) ||
      Number(b.mkSiteId != null) - Number(a.mkSiteId != null) ||
      a.id - b.id,
    )[0]
    const others = matched.filter((r) => r.id !== canonical.id)
    for (const o of others) {
      if (referenced.get(o.id)) plan.collisions.push(`kept referenced dup #${o.id} "${o.displayName}" for MK ${d.siteId}`)
      else plan.deletes.push({ id: o.id, name: o.displayName })
    }
    // A referenced dup we can't delete might still hold the desired email → don't collide on UNIQUE(email).
    const emailHeldByKept = others.some((o) => referenced.get(o.id) && o.email === d.email)
    const email = d.email && !emailHeldByKept ? d.email : canonical.email
    if (d.email && emailHeldByKept) plan.collisions.push(`email ${d.email} kept on referenced dup; MK ${d.siteId} canonical #${canonical.id} left as ${canonical.email ?? 'null'}`)
    plan.updates.push({
      id: canonical.id,
      from: canonical,
      // Preserve manually-added phone/hasWhatsapp; overwrite the MK-derived fields.
      input: {
        displayName: d.name, email, phone: canonical.phone, hasWhatsapp: canonical.hasWhatsapp,
        photoUrl: d.photoUrl, mkSiteId: d.siteId, category: 'mk',
      },
    })
  }
  return plan
}

export async function run(dryRun: boolean): Promise<Plan> {
  console.log(`\nimport-mk-contacts ${dryRun ? '(DRY RUN)' : ''}`)

  const desired = await assembleDesired()
  const withEmail = desired.filter((d) => d.email).length
  console.log(`MKs in cache: ${desired.length} (with email: ${withEmail}, photo-only: ${desired.length - withEmail})`)

  const existing = await contactsRepo.list()
  const plan = await buildPlan(desired, existing)

  console.log(`\nPlan: insert ${plan.inserts.length}, enrich ${plan.updates.length}, delete ${plan.deletes.length}, collisions ${plan.collisions.length}`)
  if (plan.deletes.length) console.log('  delete:', plan.deletes.map((d) => `#${d.id} ${d.name}`).join(', '))
  plan.collisions.forEach((c) => console.log('  ⚠️ ', c))

  if (dryRun) { console.log('\nDry run — no changes written.'); return plan }

  // Deletes first so a freed email can be reassigned to the canonical row without a UNIQUE collision.
  for (const d of plan.deletes) await contactsRepo.delete(d.id)
  for (const u of plan.updates) await contactsRepo.update(u.id, u.input)
  for (const d of plan.inserts) {
    await contactsRepo.create({
      displayName: d.name, email: d.email, phone: null, hasWhatsapp: false,
      photoUrl: d.photoUrl, mkSiteId: d.siteId, category: 'mk',
    })
  }
  console.log(`\nDone: inserted ${plan.inserts.length}, enriched ${plan.updates.length}, deleted ${plan.deletes.length}.`)
  return plan
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.includes('import-mk-contacts')) {
  run(process.argv.includes('--dry-run')).then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
}
