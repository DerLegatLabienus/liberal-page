import { serial, integer, text, timestamp, jsonb, primaryKey, boolean, unique } from 'drizzle-orm/pg-core'
import { users } from './tracking'
import { lettersSchema, analyticsSchema } from './schemas'

export type LetterAddress = { email: string; display_name: string; contact_id?: number }

export const letterIssueTags = lettersSchema.table('letter_issue_tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const letterContacts = lettersSchema.table('letter_contacts', {
  id: serial('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').unique(),                 // now nullable (many NULLs allowed under unique index)
  phone: text('phone'),                          // E.164
  hasWhatsapp: boolean('has_whatsapp').notNull().default(false),
  photoUrl: text('photo_url'),
  mkSiteId: integer('mk_site_id'),
  category: text('category').notNull().default('custom'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const letterTemplates = lettersSchema.table('letter_templates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const letters = lettersSchema.table('letters', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  bodyPlain: text('body_plain').notNull(),
  templateId: integer('template_id').references(() => letterTemplates.id, { onDelete: 'set null' }),
  toAddresses: jsonb('to_addresses').$type<LetterAddress[]>().notNull().default([]),
  ccAddresses: jsonb('cc_addresses').$type<LetterAddress[]>().notNull().default([]),
  bccAddresses: jsonb('bcc_addresses').$type<LetterAddress[]>().notNull().default([]),
  issueTagIds: jsonb('issue_tag_ids').$type<number[]>().notNull().default([]),
  status: text('status').notNull().default('draft'),
  priority: text('priority').notNull().default('normal'),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  pinNotifiedAt: timestamp('pin_notified_at', { withTimezone: true }),
  activityScore: integer('activity_score').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const letterChannels = lettersSchema.table('letter_channels', {
  id: serial('id').primaryKey(),
  letterId: integer('letter_id').notNull().references(() => letters.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                  // 'email' | 'sms' | 'whatsapp'
  enabled: boolean('enabled').notNull().default(true),
  recipientIds: jsonb('recipient_ids').$type<number[]>().notNull().default([]),
  ccIds: jsonb('cc_ids').$type<number[]>().notNull().default([]),
  bccIds: jsonb('bcc_ids').$type<number[]>().notNull().default([]),
  bodyText: text('body_text').notNull().default(''),
  subject: text('subject'),                      // email-only
  bodyHtml: text('body_html'),                   // email-only
  templateId: integer('template_id').references(() => letterTemplates.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqLetterKind: unique().on(t.letterId, t.kind),
}))

export const letterMediaAssets = lettersSchema.table('letter_media_assets', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const letterAnalytics = analyticsSchema.table('letter_analytics', {
  letterId: integer('letter_id').notNull().references(() => letters.id, { onDelete: 'cascade' }),
  bucket: text('bucket').notNull(),
  total: integer('total').notNull().default(0),
  breakdown: jsonb('breakdown').$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.letterId, t.bucket] }),
}))
