import { createRemoteJWKSet, jwtVerify } from 'jose'

/** Verified OIDC identity, prior to the provider-specific `ProviderIdentity` mapping. */
export interface OidcIdentity {
  sub: string
  email: string | null
  name: string | null
  emailVerified: boolean
}

export interface OidcVerifyConfig {
  jwksUrl: string
  issuer: string | string[]
  audience: string
}

// Cached per JWKS URL: `createRemoteJWKSet` keeps its own in-memory key cache (with cooldown
// on refetch), so reusing one instance per provider avoids refetching the JWKS on every login.
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * Verifies an OIDC id_token's signature (against the provider's live JWKS), `iss`, `aud`, and
 * `exp`, then extracts a provider-agnostic identity. Shared by every OIDC provider (Google,
 * Microsoft, Apple) — provider-specific quirks (issuer shape, email fallback) live in each
 * provider's own adapter, not here.
 */
export async function verifyOidcIdToken(cfg: OidcVerifyConfig, idToken: string): Promise<OidcIdentity> {
  let set = jwks.get(cfg.jwksUrl)
  if (!set) {
    set = createRemoteJWKSet(new URL(cfg.jwksUrl))
    jwks.set(cfg.jwksUrl, set)
  }

  const { payload } = await jwtVerify(idToken, set, { issuer: cfg.issuer, audience: cfg.audience })

  return {
    sub: String(payload.sub),
    email: (payload.email as string | undefined) ?? (payload.preferred_username as string | undefined) ?? null,
    name: (payload.name as string | undefined) ?? null,
    emailVerified: payload.email_verified !== false,
  }
}
