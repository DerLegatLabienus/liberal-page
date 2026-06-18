import { integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { parliamentSchema } from './schemas'

export const knessetMembersCache = parliamentSchema.table('knesset_members_cache', {
  siteId: integer('site_id').primaryKey(),
  name: text('name').notNull(),
  party: text('party').notNull(),
  photoUrl: text('photo_url'),
  isLiberal: boolean('is_liberal').notNull(),
  isSupporter: boolean('is_supporter').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull(),
})

export const knessetCommitteesCache = parliamentSchema.table('knesset_committees_cache', {
  committeeId: integer('committee_id').primaryKey(),
  name: text('name').notNull(),
  knessetUrl: text('knesset_url').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull(),
})

export const summariesCache = parliamentSchema.table('summaries_cache', {
  md5: text('md5').primaryKey(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  sourceUrl: text('source_url').notNull(),
  attendees: text('attendees').array(),
  derivedTitle: text('derived_title'),
})
