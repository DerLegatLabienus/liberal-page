import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Editable email templates, keyed by name. '_layout' is the shared wrapper.
export const emailTemplates = pgTable('email_templates', {
  name: text('name').primaryKey(),          // 'invite' | 'bill_digest' | 'bill_digest_item' | '_layout'
  subject: text('subject').notNull().default(''),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Send ledger. `created_at` is the send date; `status` is the LAST known delivery status
// (starts 'sent'/'failed', advanced to 'delivered'/'bounced'/... by the poller pulling
// Resend's last_event); `last_status_at` is when that status was last observed. First table
// trimmed under storage pressure.
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),              // Resend message id, or `failed:<uuid>` on send error
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  status: text('status').notNull().default('sent'), // last known status (Resend last_event)
  lastStatusAt: timestamp('last_status_at', { withTimezone: true }).notNull().defaultNow(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
