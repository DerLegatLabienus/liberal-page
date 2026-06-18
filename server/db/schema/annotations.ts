import { text, boolean } from 'drizzle-orm/pg-core'
import { parliamentSchema } from './schemas'

export const mkAnnotations = parliamentSchema.table('mk_annotations', {
  knessetSiteId: text('knesset_site_id').primaryKey(),
  isLiberal: boolean('is_liberal').notNull(),
  isSupporter: boolean('is_supporter').notNull(),
})
