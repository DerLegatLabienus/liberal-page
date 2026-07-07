import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

const CLIENT_ID = 'test-ms-client-id'
const TENANT_ID = '11111111-2222-3333-4444-555555555555'

let publicJwk: Record<string, unknown>
let privateKey: CryptoKey

// Same hermetic-JWKS technique as auth-oidc.test.ts: `verifyMicrosoftIdToken` delegates
// signature/iss/aud/exp checking to the shared `verifyOidcIdToken`, so swapping
// `createRemoteJWKSet` for a local set built from our own keypair lets us sign genuinely
// verifiable tokens without hitting Microsoft's real endpoint.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => actual.createLocalJWKSet({ keys: [publicJwk as never] })),
  }
})

import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, allowedEmails, userIdentities, refreshTokens } from '../../server/db/schema'
import { verifyMicrosoftIdToken } from '../../server/services/auth-providers/microsoft'
import { AuthError, loginWithIdentity } from '../../server/services/auth-service'

async function signMsToken(claims: Record<string, unknown>, opts: { tid?: string; audience?: string } = {}) {
  const { tid = TENANT_ID, audience = CLIENT_ID } = opts
  return new SignJWT({ tid, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(`https://login.microsoftonline.com/${tid}/v2.0`)
    .setAudience(audience)
    .setExpirationTime('1h')
    .sign(privateKey)
}

/** Signs with an explicit `iss` and no `tid` claim at all — verifies the code path derives
 *  the expected issuer from `iss` (an OIDC-guaranteed claim), not from `tid` (a Microsoft
 *  extension claim not guaranteed to be present). */
async function signMsTokenNoTid(claims: Record<string, unknown>, issuer: string) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(CLIENT_ID)
    .setExpirationTime('1h')
    .sign(privateKey)
}

describe('verifyMicrosoftIdToken', () => {
  const originalClientId = process.env.MICROSOFT_CLIENT_ID

  beforeAll(async () => {
    const { publicKey, privateKey: priv } = await generateKeyPair('RS256', { extractable: true })
    privateKey = priv
    publicJwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test-key', use: 'sig' }
    await setupTestDb()
  })

  beforeEach(async () => {
    process.env.MICROSOFT_CLIENT_ID = CLIENT_ID
    // refresh_tokens FK-references users; a successful login (verified email) now creates
    // one, so it must be cleared before users or the delete trips the constraint.
    await db.delete(refreshTokens)
    await db.delete(userIdentities)
    await db.delete(allowedEmails)
    await db.delete(users)
  })
  afterEach(() => {
    if (originalClientId === undefined) delete process.env.MICROSOFT_CLIENT_ID
    else process.env.MICROSOFT_CLIENT_ID = originalClientId
  })

  it('maps a valid, domain-verified token to a ProviderIdentity, using the email claim', async () => {
    const token = await signMsToken({ sub: 'ms-sub-1', email: 'a@x.com', name: 'Alice', xms_edov: true })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity).toEqual({
      provider: 'microsoft', sub: 'ms-sub-1', email: 'a@x.com', name: 'Alice', emailVerified: true,
    })
  })

  it('falls back to preferred_username when email is absent (work/school accounts)', async () => {
    const token = await signMsToken({ sub: 'ms-sub-2', preferred_username: 'b@x.com', name: 'Bob', xms_edov: true })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.email).toBe('b@x.com')
  })

  it('rejects a token audience-bound to a different app', async () => {
    const token = await signMsToken({ sub: 'ms-sub-1', email: 'a@x.com' }, { audience: 'someone-elses-app' })
    await expect(verifyMicrosoftIdToken(token)).rejects.toThrow(AuthError)
  })

  it('succeeds with no tid claim at all, as long as iss is a valid Microsoft issuer', async () => {
    const token = await signMsTokenNoTid(
      { sub: 'ms-sub-3', email: 'c@x.com', name: 'Carol', xms_edov: true },
      `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    )
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity).toEqual({
      provider: 'microsoft', sub: 'ms-sub-3', email: 'c@x.com', name: 'Carol', emailVerified: true,
    })
  })

  it('rejects a token whose iss does not match Microsoft\'s issuer shape', async () => {
    const token = await signMsTokenNoTid({ sub: 'ms-sub-4', email: 'd@x.com' }, 'https://evil.example.com/v2.0')
    await expect(verifyMicrosoftIdToken(token)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('MICROSOFT_CLIENT_ID unset → provider_unconfigured', async () => {
    delete process.env.MICROSOFT_CLIENT_ID
    const token = await signMsToken({ sub: 'ms-sub-1', email: 'a@x.com' })
    await expect(verifyMicrosoftIdToken(token)).rejects.toMatchObject({ code: 'provider_unconfigured' })
  })

  // --- nOAuth account-takeover defense: `xms_edov` is the only trusted verified-email signal ---

  it('a token with no xms_edov claim maps to emailVerified: false (Microsoft never emits email_verified)', async () => {
    const token = await signMsToken({ sub: 'ms-sub-5', email: 'e@x.com', name: 'Eve' })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.emailVerified).toBe(false)
  })

  it('a token with xms_edov explicitly false maps to emailVerified: false', async () => {
    const token = await signMsToken({ sub: 'ms-sub-6', email: 'f@x.com', xms_edov: false })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.emailVerified).toBe(false)
  })

  it('a spoofed standard email_verified:true claim is ignored — only xms_edov counts', async () => {
    // Simulates an attacker-controlled tenant setting the generic OIDC claim, hoping the
    // verifier falls back to it. It must not: Microsoft never emits `email_verified`, so this
    // adapter must derive its verified-ownership signal from `xms_edov` alone.
    const token = await signMsToken({ sub: 'ms-sub-7', email: 'g@x.com', email_verified: true })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.emailVerified).toBe(false)
  })

  it('a token with xms_edov: true maps to emailVerified: true and logs in an allowlisted email', async () => {
    await db.insert(allowedEmails).values({ email: 'h@x.com', role: 'member', createdAt: new Date() })

    const token = await signMsToken({ sub: 'ms-sub-8', email: 'h@x.com', name: 'Hank', xms_edov: true })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.emailVerified).toBe(true)

    const result = await loginWithIdentity(identity)
    expect(result.accessToken).toBeTruthy()
    expect(result.user).toMatchObject({ email: 'h@x.com', role: 'member' })
  })

  it('takeover blocked: an unverified MS token claiming an allowlisted victim email is rejected, with no session and no identity merge', async () => {
    // The nOAuth scenario this whole change defends against: an attacker's self-registered
    // Entra tenant sets the `email` claim to an already-invited victim's address. The token is
    // genuinely signed by Microsoft and passes signature/aud/iss checks — but the tenant was
    // never verified to own that email domain, so `xms_edov` is absent.
    await db.insert(allowedEmails).values({ email: 'victim@x.com', role: 'admin', createdAt: new Date() })

    const token = await signMsToken({ sub: 'attacker-sub', email: 'victim@x.com', name: 'Attacker' })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.emailVerified).toBe(false)

    await expect(loginWithIdentity(identity)).rejects.toMatchObject({ code: 'email_not_verified' })

    // No user created, no user_identities row created — the attacker's token leaves no trace.
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await db.select().from(userIdentities)).toHaveLength(0)
  })
})
