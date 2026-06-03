import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../services/auth-service'

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

/** Requires a valid bearer token with the admin role; 401/403 otherwise. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = readBearer(req)
  const claims = token ? verifyAccessToken(token) : null
  if (!claims) { res.status(401).json({ error: 'Authentication required' }); return }
  if (claims.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return }
  req.user = { id: claims.userId, role: claims.role }
  next()
}
