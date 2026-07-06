import { serial, integer, text, timestamp, unique, boolean } from 'drizzle-orm/pg-core'
import { bills } from './bills'
import { committees } from './committees'
import { mks } from './mks'
import { authSchema, parliamentSchema } from './schemas'

export const users = authSchema.table('users', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  email: text('email').unique(),
  name: text('name'),
  googleSub: text('google_sub').unique(),
  role: text('role').notNull().default('member'), // 'admin' | 'member' | 'group'
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  emailAlerts: boolean('email_alerts').notNull().default(true),
})

// One row per (provider, provider_sub) link to a user — the foundation for multi-provider
// login. `google_sub` on `users` remains for now (existing callers/tests); this table is the
// source of truth going forward and is backfilled from it in migration 0025.
export const userIdentities = authSchema.table('user_identities', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerSub: text('provider_sub').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqProviderSub: unique('user_identities_provider_sub_unique').on(t.provider, t.providerSub),
}))

export const trackedBills = parliamentSchema.table('tracked_bills', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  billId: integer('bill_id').notNull().references(() => bills.id, { onDelete: 'restrict' }),
  position: text('position').notNull().default('עוקבים'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserBill: unique('uniq_user_bill').on(t.userId, t.billId) }))

export const trackedCommittees = parliamentSchema.table('tracked_committees', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  committeeId: integer('committee_id').notNull().references(() => committees.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserCommittee: unique('uniq_user_committee').on(t.userId, t.committeeId) }))

export const trackedMks = parliamentSchema.table('tracked_mks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserMk: unique('uniq_user_mk').on(t.userId, t.mkId) }))
