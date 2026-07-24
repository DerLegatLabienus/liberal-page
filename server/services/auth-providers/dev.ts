import type { ProviderIdentity } from '../auth-service'
import { AuthRepository } from '../../repositories/auth-repository'

const authRepo = new AuthRepository()

/**
 * Whether the `dev` identity provider may be registered at all. Three independent
 * conditions, all required, so no single misconfiguration exposes it: an explicit
 * opt-in flag (never implied by NODE_ENV alone), NODE_ENV not literally 'production',
 * and Render's own auto-set `RENDER` env var absent (an unspoofable-by-.env signal
 * tied to where this app is actually deployed).
 */
export function isDevLoginAllowed(): boolean {
  return process.env.ALLOW_DEV_LOGIN === 'true'
    && process.env.NODE_ENV !== 'production'
    && !process.env.RENDER
}

/**
 * A local-only stand-in for a real identity provider: `idToken` here is a sentinel the
 * dev-only frontend button sends ('dev-admin' | 'dev-member'), not a real token — there
 * is nothing to cryptographically verify since no real provider is involved. Upserts an
 * allowlist entry for the synthetic email first so the very first sign-in never hits
 * `not_invited` (no manual seeding step); re-running is a harmless no-op.
 */
export async function verifyDevIdentity(idToken: string): Promise<ProviderIdentity> {
  const role = idToken === 'dev-admin' ? 'admin' : 'member'
  const email = `${idToken}@localhost`
  await authRepo.addInvite(email, role, null)
  return { provider: 'dev', sub: email, email, name: `Local Dev (${role})`, emailVerified: true }
}
