import { pgTable, text, boolean } from 'drizzle-orm/pg-core'

export const mkAnnotations = pgTable('mk_annotations', {
  knessetSiteId: text('knesset_site_id').primaryKey(),
  isLiberal: boolean('is_liberal').notNull(),
  isSupporter: boolean('is_supporter').notNull(),
})
