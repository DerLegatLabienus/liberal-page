import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

/** Verified OIDC identity, prior to the provider-specific `ProviderIdentity` mapping. */
export interface OidcIdentity {
  sub: string
  email: string | null
  name: string | null
  emailVerified: boolean
  /**
   * Raw verified claims from the token payload, exposed so provider-specific adapters can
   * read claims outside the standard OIDC set (e.g. Microsoft's `xms_edov`) that this
   * shared verifier has no reason to know about. Signature/iss/aud/exp are already verified
   * by the time a caller sees this — reading a field off it is not itself a trust decision.
   */
  claims: JWTPayload
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

  // Pin the algorithm rather than trusting whatever `alg` the JWKS/token declare — closes
  // off algorithm-confusion attacks (e.g. a key meant for one algorithm being reinterpreted
  // under another). Every provider we verify here (Google, Microsoft, Apple) signs with RS256.
  const { payload } = await jwtVerify(idToken, set, {
    issuer: cfg.issuer,
    audience: cfg.audience,
    algorithms: ['RS256'],
  })

  return {
    sub: String(payload.sub),
    email: (payload.email as string | undefined) ?? (payload.preferred_username as string | undefined) ?? null,
    name: (payload.name as string | undefined) ?? null,
    // Fail closed: absent `email_verified` is NOT a verification. Every real consumer
    // derives its own signal (Microsoft → xms_edov, Google → its own `=== true`), but a
    // future OIDC provider reading this field naively must not inherit a fail-open default.
    emailVerified: payload.email_verified === true,
    claims: payload,
  }
}
