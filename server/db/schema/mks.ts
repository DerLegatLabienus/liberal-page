import { pgTable, serial, integer, text, boolean, timestamp, unique } from 'drizzle-orm/pg-core'

export const mks = pgTable('mks', {
  id: serial('id').primaryKey(),
  oknessetId: text('oknesset_id').notNull().default(''),
  knessetSiteId: text('knesset_site_id'),
  name: text('name').notNull(),
  email: text('email'),
  photoUrl: text('photo_url'),
  votingSummary: text('voting_summary'),
  sourceUrl: text('source_url').notNull(),
  hasNewData: boolean('has_new_data').notNull().default(false),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
})

export const mkKnessetTerms = pgTable('mk_knesset_terms', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  knessetNumber: integer('knesset_number').notNull(),
  faction: text('faction').notNull(),
}, (t) => ({
  uniqMkKnesset: unique('uniq_mk_knesset').on(t.mkId, t.knessetNumber),
}))

export const mkRoles = pgTable('mk_roles', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  positionId: integer('position_id').notNull(),
  description: text('description').notNull(),
  committeeName: text('committee_name'),
  isCurrent: boolean('is_current').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }),
})

export const mkActivity = pgTable('mk_activity', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  type: text('type').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  sourceUrl: text('source_url'),
})

export const mkVotes = pgTable('mk_votes', {
  id: serial('id').primaryKey(),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  billTitle: text('bill_title').notNull(),
  vote: text('vote').notNull(),
})
