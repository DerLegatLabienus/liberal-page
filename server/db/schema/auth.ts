import { pgTable, serial, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './tracking'

// Invite allowlist for the closed group. Presence here lets an email sign in;
// `role` is granted to the user on first Google login.
export const allowedEmails = pgTable('allowed_emails', {
  email: text('email').primaryKey(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  invitedBy: integer('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

// Active refresh tokens. Only the sha256 hash of the raw token is stored. A row's existence
// (with expiresAt > now) IS its validity — invalidation is row deletion, never a flag.
export const refreshTokens = pgTable('refresh_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})
