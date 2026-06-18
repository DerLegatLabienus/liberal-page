import { integer, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { parliamentSchema, configSchema } from './schemas'

export const knessetConfig = parliamentSchema.table('knesset_config', {
  id: integer('id').primaryKey(), // always 1
  currentKnesset: integer('current_knesset').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
})

export const featureFlags = configSchema.table('feature_flags', {
  name: text('name').primaryKey(),
  enabled: boolean('enabled').notNull(),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})
