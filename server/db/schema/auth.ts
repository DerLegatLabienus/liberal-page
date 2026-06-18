import { serial, integer, text, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './tracking'
import { authSchema } from './schemas'

// Invite allowlist for the closed group. Presence here lets an email sign in;
// `role` is granted to the user on first Google login.
export const allowedEmails = authSchema.table('allowed_emails', {
  email: text('email').primaryKey(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  invitedBy: integer('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

// Active refresh tokens. Only the sha256 hash of the raw token is stored. A row's existence
// (with expiresAt > now) IS its validity — invalidation is row deletion, never a flag.
export const refreshTokens = authSchema.table('refresh_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({
  // token_hash is looked up on every /auth/refresh; user_id + expires_at on revoke/cleanup.
  byTokenHash: index('idx_refresh_tokens_token_hash').on(t.tokenHash),
  byUserId: index('idx_refresh_tokens_user_id').on(t.userId),
  byExpiresAt: index('idx_refresh_tokens_expires_at').on(t.expiresAt),
}))
