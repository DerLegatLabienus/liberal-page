import type { Request } from 'express'
import { UsersRepository } from '../repositories/users-repository'

const users = new UsersRepository()

export type ScopeResult =
  | { ok: true; userId: number }
  | { ok: false; status: number; error: string }

/**
 * Which list a READ targets. `?scope=personal` → the authenticated caller's list (401 if
 * anonymous); anything else (default) → the public group list.
 */
export async function resolveReadScope(req: Request): Promise<ScopeResult> {
  if (req.query.scope === 'personal') {
    if (!req.user) return { ok: false, status: 401, error: 'Authentication required' }
    return { ok: true, userId: req.user.id }
  }
  return { ok: true, userId: await users.getGroupUserId() }
}

/**
 * Which list a WRITE targets. Runs after requireAuth, so `req.user` is set.
 * `?scope=group` → the public group list, **admins only** (403 otherwise);
 * anything else (default) → the caller's personal list.
 */
export async function resolveWriteScope(req: Request): Promise<ScopeResult> {
  if (req.query.scope === 'group') {
    if (req.user!.role !== 'admin') return { ok: false, status: 403, error: 'Admins only' }
    return { ok: true, userId: await users.getGroupUserId() }
  }
  return { ok: true, userId: req.user!.id }
}
