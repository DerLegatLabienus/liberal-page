import { pgTable, serial, integer, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { bills } from './bills'
import { committees } from './committees'
import { mks } from './mks'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const trackedBills = pgTable('tracked_bills', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  billId: integer('bill_id').notNull().references(() => bills.id, { onDelete: 'restrict' }),
  position: text('position').notNull().default('עוקבים'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserBill: unique('uniq_user_bill').on(t.userId, t.billId) }))

export const trackedCommittees = pgTable('tracked_committees', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  committeeId: integer('committee_id').notNull().references(() => committees.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserCommittee: unique('uniq_user_committee').on(t.userId, t.committeeId) }))

export const trackedMks = pgTable('tracked_mks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  mkId: integer('mk_id').notNull().references(() => mks.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => ({ uniqUserMk: unique('uniq_user_mk').on(t.userId, t.mkId) }))
