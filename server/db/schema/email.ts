import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Editable email templates, keyed by name. '_layout' is the shared wrapper.
export const emailTemplates = pgTable('email_templates', {
  name: text('name').primaryKey(),          // 'invite' | 'bill_digest' | 'bill_digest_item' | '_layout'
  subject: text('subject').notNull().default(''),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Minimal send ledger: recorded once at send time, never updated. Delivery lifecycle is
// logged only (the webhook stores nothing). First table trimmed under storage pressure.
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),              // Resend message id, or `failed:<uuid>` on send error
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  status: text('status').notNull().default('sent'), // 'sent' | 'failed' (set once, at send time)
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
