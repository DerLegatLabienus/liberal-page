import { serial, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { parliamentSchema } from './schemas'

export const bills = parliamentSchema.table('bills', {
  id: serial('id').primaryKey(),
  oknessetId: text('oknesset_id').notNull().default(''),
  number: text('number').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  committee: text('committee').notNull().default(''),
  sourceUrl: text('source_url').notNull(),
  documentUrl: text('document_url'),
  knessetUrl: text('knesset_url'),
  knessetNumber: integer('knesset_number').notNull(),
  hasNewData: boolean('has_new_data').notNull().default(false),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
})
