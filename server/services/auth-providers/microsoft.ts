import { decodeJwt } from 'jose'
import { AuthError, type ProviderIdentity } from '../auth-service'
import { verifyOidcIdToken } from './oidc'

const JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys'

// Matches Microsoft's v2 issuer shape for any tenant: https://login.microsoftonline.com/{tenant}/v2.0
// (tenant is a GUID for work/school accounts, or the fixed consumers-tenant GUID for personal
// Microsoft accounts). Used only to constrain which issuer string we *ask* jwtVerify to check —
// see the doc comment below for why this isn't itself a trust decision.
const MS_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/[0-9a-fA-F-]+\/v2\.0$/

function microsoftClientId(): string | null {
  return process.env.MICROSOFT_CLIENT_ID || null
}

/**
 * Verifies a Microsoft (Azure AD / MSA) OIDC id_token and maps it to a `ProviderIdentity`.
 *
 * Issuer quirk: Microsoft's v2 endpoint issuer is tenant-specific
 * (`https://login.microsoftonline.com/{tenantGuid}/v2.0`) even for an app registered as
 * multi-tenant against the `common` authority — there is no single fixed issuer to pin ahead
 * of time. We read the token's own (unverified) `iss` claim — guaranteed present on any OIDC
 * id_token, unlike Microsoft's optional `tid` extension claim — check it matches Microsoft's
 * issuer shape, and hand that exact string to `verifyOidcIdToken` as the expected issuer. This
 * is safe because reading `iss` here is not itself the trust boundary: the actual security
 * boundary is the signature check against Microsoft's real JWKS plus the strict `audience`
 * (our client id) check inside `verifyOidcIdToken` — a forged `iss` still fails signature
 * verification, and a token minted for a different app still fails the audience check. We
 * deliberately do not otherwise restrict which tenant is accepted (see design doc: "validate
 * `aud` strictly; do not trust `tid`/`iss` beyond Microsoft's issuer set").
 */
export async function verifyMicrosoftIdToken(idToken: string): Promise<ProviderIdentity> {
  const clientId = microsoftClientId()
  if (!clientId) throw new AuthError('provider_unconfigured')

  let iss: string | undefined
  try {
    iss = decodeJwt(idToken).iss
  } catch {
    throw new AuthError('invalid_token')
  }
  if (!iss || !MS_ISSUER_RE.test(iss)) throw new AuthError('invalid_token')

  try {
    const identity = await verifyOidcIdToken({ jwksUrl: JWKS_URL, issuer: iss, audience: clientId }, idToken)
    return { provider: 'microsoft', sub: identity.sub, email: identity.email ?? '', name: identity.name }
  } catch (err) {
    if (err instanceof AuthError) throw err
    throw new AuthError('invalid_token')
  }
}
