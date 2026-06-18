import { pgSchema } from 'drizzle-orm/pg-core'

// Domain schemas (§23). Tables are grouped by Low Coupling / High Cohesion.
// The Drizzle file grouping crosses domains, so each table picks its schema explicitly:
//   parliament — entities, tracking, caches, knesset_config
//   auth       — users, refresh_tokens, allowed_emails
//   email      — email_templates, sent_emails
//   letters    — letters, letter_contacts, letter_issue_tags, letter_templates
//   analytics  — join_analytics, letter_analytics
//   config     — feature_flags
export const parliamentSchema = pgSchema('parliament')
export const authSchema = pgSchema('auth')
export const emailSchema = pgSchema('email')
export const lettersSchema = pgSchema('letters')
export const analyticsSchema = pgSchema('analytics')
export const configSchema = pgSchema('config')
