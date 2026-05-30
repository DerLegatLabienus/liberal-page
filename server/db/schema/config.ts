import { pgTable, integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const knessetConfig = pgTable('knesset_config', {
  id: integer('id').primaryKey(), // always 1
  currentKnesset: integer('current_knesset').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
})

export const featureFlags = pgTable('feature_flags', {
  name: text('name').primaryKey(),
  enabled: boolean('enabled').notNull(),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})
