import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../services/auth-service'
import { AuthRepository } from '../repositories/auth-repository'

const authRepo = new AuthRepository()

export interface AuthedUser { id: number; role: string }

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthedUser }
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

/** Attaches req.user if a valid bearer token is present; otherwise continues anonymously. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req)
  const claims = token ? verifyAccessToken(token) : null
  if (claims) req.user = { id: claims.userId, role: claims.role }
  next()
}

/** Requires a valid bearer token; 401 otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readBearer(req)
  const claims = token ? verifyAccessToken(token) : null
  if (!claims) { res.status(401).json({ error: 'Authentication required' }); return }
  req.user = { id: claims.userId, role: claims.role }
  next()
}

/**
 * Requires a valid bearer token AND a current admin role read fresh from the DB — so a demoted
 * admin loses access immediately rather than within the 15-min access-token window (the JWT role
 * claim alone could be stale). One extra query per admin request; admin traffic is tiny.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readBearer(req)
  const claims = token ? verifyAccessToken(token) : null
  if (!claims) { res.status(401).json({ error: 'Authentication required' }); return }
  try {
    const user = await authRepo.findUserById(claims.userId)
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return }
    if (user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return }
    req.user = { id: user.id, role: user.role }
    next()
  } catch (err) {
    console.error('[auth] requireAdmin role check failed:', err)
    res.status(500).json({ error: 'Server error' })
  }
}
