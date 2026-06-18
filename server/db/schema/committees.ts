import { serial, integer, text, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { parliamentSchema } from './schemas'

export const committees = parliamentSchema.table('committees', {
  id: serial('id').primaryKey(),
  oknessetId: text('oknesset_id').notNull().default(''),
  name: text('name').notNull(),
  chair: text('chair').notNull().default(''),
  lastSessionDate: timestamp('last_session_date', { withTimezone: true }),
  lastSessionSummary: text('last_session_summary'),
  lastSessionDocumentUrl: text('last_session_document_url'),
  sourceUrl: text('source_url').notNull(),
  hasNewData: boolean('has_new_data').notNull().default(false),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  inactive: boolean('inactive').notNull().default(false),
})

export const committeeSessions = parliamentSchema.table('committee_sessions', {
  sessionId: integer('session_id').primaryKey(),
  committeeId: integer('committee_id')
    .notNull()
    .references(() => committees.id, { onDelete: 'restrict' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  knessetNum: integer('knesset_num').notNull(),
  title: text('title').notNull(),
  sessionUrl: text('session_url').notNull(),
  attendingSiteIds: text('attending_site_ids').array().notNull().default([]),
  aiSummary: text('ai_summary'),
}, (t) => ({ byCommitteeId: index('idx_committee_sessions_committee_id').on(t.committeeId) }))
