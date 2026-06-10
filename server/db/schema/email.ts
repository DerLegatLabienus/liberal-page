import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Editable email templates, keyed by name. '_layout' is the shared wrapper.
export const emailTemplates = pgTable('email_templates', {
  name: text('name').primaryKey(),          // 'invite' | 'bill_digest' | 'bill_digest_item' | '_layout'
  subject: text('subject').notNull().default(''),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// One row per attempted send; status updated by the Resend webhook.
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),              // Resend message id, or `failed:<uuid>`
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  // Resolved subject captured at send time (templates are editable; preserve what was actually sent).
  subject: text('subject').notNull().default(''),
  status: text('status').notNull().default('sent'), // sent|delivered|bounced|complained|delivery_delayed|failed
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
