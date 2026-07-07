import { describe, it, expect, beforeAll, vi } from 'vitest'

const ISSUER = 'https://issuer.example.test'
const AUDIENCE = 'test-client-id'
const JWKS_URL = 'https://issuer.example.test/keys'

let publicJwk: Record<string, unknown>
let privateKey: CryptoKey

// `verifyOidcIdToken` fetches its JWKS over HTTPS via `createRemoteJWKSet`. For a hermetic
// unit test we keep the real `jwtVerify` (so signature/iss/aud/exp checks are genuinely
// exercised) but swap `createRemoteJWKSet` for a local JWK set built from a keypair we
// generate and sign with ourselves — no network access, no real provider.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => actual.createLocalJWKSet({ keys: [publicJwk as never] })),
  }
})

import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { verifyOidcIdToken } from '../../server/services/auth-providers/oidc'

async function signToken(claims: Record<string, unknown>, opts: { issuer?: string; audience?: string; expSecondsFromNow?: number } = {}) {
  const { issuer = ISSUER, audience = AUDIENCE, expSecondsFromNow = 3600 } = opts
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(privateKey)
}

describe('verifyOidcIdToken', () => {
  beforeAll(async () => {
    const { publicKey, privateKey: priv } = await generateKeyPair('RS256', { extractable: true })
    privateKey = priv
    publicJwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test-key', use: 'sig' }
  })

  it('valid token → identity', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@x.com', name: 'Alice', email_verified: true })
    const identity = await verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, token)
    expect(identity).toMatchObject({ sub: 'user-1', email: 'a@x.com', name: 'Alice', emailVerified: true })
  })

  it('exposes the raw verified claims so provider adapters can read non-standard fields', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@x.com', xms_edov: true })
    const identity = await verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, token)
    expect(identity.claims.xms_edov).toBe(true)
    expect(identity.claims.sub).toBe('user-1')
  })

  it('falls back to preferred_username when email is absent', async () => {
    const token = await signToken({ sub: 'user-2', preferred_username: 'b@x.com', name: 'Bob' })
    const identity = await verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, token)
    expect(identity.email).toBe('b@x.com')
  })

  it('emailVerified fails closed: true only when email_verified is explicitly true', async () => {
    // Explicit false → false, and — critically — an ABSENT claim → false. Never trust an
    // unstated claim as verification (a naive future OIDC provider must not inherit fail-open).
    const explicitFalse = await signToken({ sub: 'user-3', email: 'c@x.com', email_verified: false })
    expect((await verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, explicitFalse)).emailVerified).toBe(false)

    const absent = await signToken({ sub: 'user-4', email: 'd@x.com' })
    expect((await verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, absent)).emailVerified).toBe(false)
  })

  it('wrong audience → throws', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@x.com' }, { audience: 'someone-elses-client-id' })
    await expect(verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, token)).rejects.toThrow()
  })

  it('wrong issuer → throws', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@x.com' }, { issuer: 'https://not-the-real-issuer.test' })
    await expect(verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, token)).rejects.toThrow()
  })

  it('expired token → throws', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@x.com' }, { expSecondsFromNow: -10 })
    await expect(verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE }, token)).rejects.toThrow()
  })
})
