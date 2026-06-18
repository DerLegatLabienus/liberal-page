import { text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { analyticsSchema } from './schemas'

// Single-table Join-section click-through analytics.
// One reserved row (bucket = 'lifetime') holds all-time totals; every other row is one
// day (bucket = 'YYYY-MM-DD') within a 1-year sliding window, pruned on write.
export const joinAnalytics = analyticsSchema.table('join_analytics', {
  bucket: text('bucket').primaryKey(), // 'YYYY-MM-DD' or 'lifetime'
  total: integer('total').notNull().default(0),
  breakdown: jsonb('breakdown').$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})
