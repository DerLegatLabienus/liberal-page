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
import { verifyMicrosoftIdToken } from '../../server/services/auth-providers/microsoft'
import { AuthError } from '../../server/services/auth-service'

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
  })

  beforeEach(() => { process.env.MICROSOFT_CLIENT_ID = CLIENT_ID })
  afterEach(() => {
    if (originalClientId === undefined) delete process.env.MICROSOFT_CLIENT_ID
    else process.env.MICROSOFT_CLIENT_ID = originalClientId
  })

  it('maps a valid token to a ProviderIdentity, using the email claim', async () => {
    const token = await signMsToken({ sub: 'ms-sub-1', email: 'a@x.com', name: 'Alice' })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity).toEqual({ provider: 'microsoft', sub: 'ms-sub-1', email: 'a@x.com', name: 'Alice' })
  })

  it('falls back to preferred_username when email is absent (work/school accounts)', async () => {
    const token = await signMsToken({ sub: 'ms-sub-2', preferred_username: 'b@x.com', name: 'Bob' })
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity.email).toBe('b@x.com')
  })

  it('rejects a token audience-bound to a different app', async () => {
    const token = await signMsToken({ sub: 'ms-sub-1', email: 'a@x.com' }, { audience: 'someone-elses-app' })
    await expect(verifyMicrosoftIdToken(token)).rejects.toThrow(AuthError)
  })

  it('succeeds with no tid claim at all, as long as iss is a valid Microsoft issuer', async () => {
    const token = await signMsTokenNoTid(
      { sub: 'ms-sub-3', email: 'c@x.com', name: 'Carol' },
      `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    )
    const identity = await verifyMicrosoftIdToken(token)
    expect(identity).toEqual({ provider: 'microsoft', sub: 'ms-sub-3', email: 'c@x.com', name: 'Carol' })
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
})
