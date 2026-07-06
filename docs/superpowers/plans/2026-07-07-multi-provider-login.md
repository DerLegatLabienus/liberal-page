# Multi-Provider Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let members sign in with Apple, Facebook, Microsoft, and an email magic-link in addition to Google — all funnelled through the existing invite-only email allowlist.

**Architecture:** Every provider resolves to a verified `{ provider, sub, email, name }`, then a shared `loginWithIdentity()` runs the unchanged allowlist gate, upserts the email-keyed user, records the provider identity in a new `user_identities` table, and issues the existing JWTs. OIDC id_tokens (Google/Microsoft/Apple) verify via `jose`+JWKS; Facebook via the Graph API; magic-link is a signed, single-use, emailed token.

**Tech Stack:** Express 5 + tsx, Drizzle/Postgres (pglite in tests), `jose` (new), `@azure/msal-browser` (frontend, new), Resend (existing), React 18, Vitest + supertest.

**Design doc:** `docs/superpowers/specs/2026-07-07-multi-provider-login-design.md`

## Global Constraints

- **Invite-only is preserved exactly.** Every path calls the same gate: `getAllowedEmail(email) || findUserByEmail(email)`, else `403`. No provider widens access.
- **Account key is `email`.** Providers link to one account by verified email; `user_identities(provider, provider_sub)` records each linkage.
- **Trust email only from a verified, audience-bound assertion** — OIDC signature + `iss` + `aud`, or Facebook `debug_token` app-id match. Never from an unverified token.
- **Each provider is independently optional:** unset env → that route returns `503` and the frontend hides its button. Existing Google login must never regress.
- **Magic-link token:** random 32 bytes, stored hashed, 15-min TTL, single-use (deleted on verify); the request endpoint is neutral (no email enumeration).
- Migrations are idempotent-friendly and registered in `meta/_journal.json`; next number is `0025`.

---

### Task 1: Foundation — `user_identities`, `upsertUserFromIdentity`, `loginWithIdentity`, generalized route

**Files:**
- Create: `server/db/migrations/0025_user_identities.sql`, edit `server/db/migrations/meta/_journal.json`
- Modify: `server/db/schema/tracking.ts` (add `userIdentities` table), `server/repositories/auth-repository.ts`, `server/services/auth-service.ts`, `server/routes/auth.ts`, `src/lib/api-client.ts`, `src/contexts/AuthContext.tsx`
- Test: `tests/server/auth-login-identity.test.ts`, extend `tests/server/auth-route.test.ts` if present

**Interfaces produced:**
- `loginWithIdentity(identity: ProviderIdentity): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }>` — throws `AuthError('not_invited'|'no_email')`.
- `ProviderIdentity = { provider: string; sub: string; email: string; name: string | null }`.
- `AuthRepository.upsertUserFromIdentity(input: { email; provider; sub; name; role }): Promise<AuthUser>`.
- Route `POST /api/auth/:provider` (google case live).

- [ ] **Step 1: Migration** — `0025_user_identities.sql`:
```sql
CREATE TABLE IF NOT EXISTS "auth"."user_identities" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_sub" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_identities_provider_sub_unique" UNIQUE ("provider", "provider_sub")
);
-- Backfill existing Google identities so linked accounts survive.
INSERT INTO "auth"."user_identities" ("user_id", "provider", "provider_sub", "created_at")
SELECT "id", 'google', "google_sub", now() FROM "auth"."users" WHERE "google_sub" IS NOT NULL
ON CONFLICT ("provider", "provider_sub") DO NOTHING;
```
Register in `_journal.json` (idx 25, tag `0025_user_identities`, `when` ≥ previous). Add the `userIdentities` Drizzle table to `server/db/schema/tracking.ts` mirroring the columns (import into schema barrel as the others are).

- [ ] **Step 2: Failing test** — `tests/server/auth-login-identity.test.ts`: seed an allowlisted email → `loginWithIdentity({ provider:'google', sub:'s1', email:'a@x.com', name:'A' })` returns tokens + user and creates a `user_identities` row; a not-allowlisted, non-existing email → rejects with `not_invited`; an existing-but-not-allowlisted user → succeeds (grandfather). Run → FAIL.

- [ ] **Step 3: Repository** — add to `AuthRepository`:
```ts
async upsertUserFromIdentity(input: { email: string; provider: string; sub: string; name: string | null; role: string }): Promise<AuthUser> {
  const now = new Date()
  const [u] = await db.insert(users)
    .values({ label: input.email, email: input.email, name: input.name, role: input.role, lastLoginAt: now, ...(input.provider === 'google' ? { googleSub: input.sub } : {}) })
    .onConflictDoUpdate({ target: users.email, set: { name: input.name, lastLoginAt: now } })
    .returning()
  await db.insert(userIdentities)
    .values({ userId: u.id, provider: input.provider, providerSub: input.sub, createdAt: now })
    .onConflictDoUpdate({ target: [userIdentities.provider, userIdentities.providerSub], set: { userId: u.id } })
  return toAuthUser(u)
}
```
(Keep `upsertUserFromGoogle` as a thin caller or delete once the route no longer uses it. `toAuthUser` is the existing row→AuthUser mapper.)

- [ ] **Step 4: Service** — add to `auth-service.ts`:
```ts
export interface ProviderIdentity { provider: string; sub: string; email: string; name: string | null }
export class AuthError extends Error { constructor(public code: 'not_invited' | 'no_email' | 'invalid_token' | 'provider_unconfigured') { super(code) } }

export async function loginWithIdentity(id: ProviderIdentity) {
  const email = id.email?.trim().toLowerCase()
  if (!email) throw new AuthError('no_email')
  const allowed = await authRepo.getAllowedEmail(email)
  const existing = await authRepo.findUserByEmail(email)
  if (!allowed && !existing) throw new AuthError('not_invited')
  const role = existing?.role ?? allowed?.role ?? 'member'
  const user = await authRepo.upsertUserFromIdentity({ email, provider: id.provider, sub: id.sub, name: id.name, role })
  return { user, accessToken: issueAccessToken(user), refreshToken: await issueRefreshToken(user.id) }
}
```

- [ ] **Step 5: Generalize the route** — replace the `POST /google` handler with `POST /:provider` that verifies per provider then calls `loginWithIdentity`. For Task 1 only `google` is wired (verify via existing `verifyGoogleIdToken`); unknown providers → `400`. Map `AuthError` codes → `403` (`not_invited`), `401` (`invalid_token`), `503` (`provider_unconfigured`), `403`+message (`no_email`). Keep the `AuthResponse` shape identical (`{ accessToken, refreshToken, user: publicUser(user) }`).

- [ ] **Step 6: Frontend client** — `api.auth.oauth(provider, token)` → `POST /auth/${provider}` `{ idToken: token }`; keep `api.auth.google = (t) => oauth('google', t)`. `AuthContext.signIn` unchanged externally (still calls the Google path). Run the suite green.

- [ ] **Step 7: Gate + commit** — `npx vitest run tests/server/auth-login-identity.test.ts`, then targeted suites; commit `feat(auth): identity foundation — user_identities, loginWithIdentity, /auth/:provider`.

---

### Task 2: Email magic-link

**Files:**
- Create: `server/db/migrations/0026_magic_link_tokens.sql` (+ journal), `server/services/auth-providers/magic-link.ts`, `src/pages/MagicLinkPage.tsx`
- Modify: `server/db/schema/tracking.ts` (`magicLinkTokens`), `server/routes/auth.ts`, `server/services/email-service.ts` (or wherever Resend sends), `src/components/layout/AuthControl.tsx`, `src/lib/api-client.ts`, `src/contexts/AuthContext.tsx`, `src/App.tsx` (route)
- Test: `tests/server/auth-magic-link.test.ts`

**Interfaces:** `requestMagicLink(email)`, `verifyMagicLink(token) → ProviderIdentity`-like `{ email }` for `loginWithIdentity` (provider omitted → login by email without an identity row).

- [ ] **Step 1** — migration `magic_link_tokens(id, email text, token_hash text unique, expires_at timestamptz, created_at timestamptz)`; journal idx 26. Drizzle table.
- [ ] **Step 2: Failing tests** — request stores a hashed token + calls the (mocked) mailer, and is neutral (`200`) for an unknown/not-invited email while storing/emailing nothing usable; verify consumes single-use (second use fails), rejects expired + unknown; a verified token for an allowlisted email → `loginWithIdentity` succeeds.
- [ ] **Step 3: Service** `magic-link.ts`:
  - `requestMagicLink(email)`: normalize; if `getAllowedEmail || findUserByEmail`: `token = randomBytes(32).hex`, store `sha256(token)` + `expiresAt = now+15m`, email `${APP_PUBLIC_URL}/auth/magic-link?token=${token}` via Resend. Always return void (neutral).
  - `verifyMagicLink(token)`: `hash = sha256(token)`; look up; if missing/expired → throw `AuthError('invalid_token')`; **delete row**; return `{ email }`.
- [ ] **Step 4: Routes** — `POST /auth/magic-link/request` (rate-limited per email/IP; always `200 { ok: true }`); `POST /auth/magic-link/verify` `{ token }` → `verifyMagicLink` → `loginWithIdentity({ provider: 'magic-link', sub: email, email, name: null })` (or a variant that skips the identity row) → `AuthResponse`.
- [ ] **Step 5: Frontend** — `AuthControl` email field + "Send me a sign-in link" → `api.auth.magicLink.request(email)` → neutral confirmation. `MagicLinkPage` (route `/auth/magic-link`) reads `?token`, calls `api.auth.magicLink.verify`, stores session via `AuthContext`, redirects home.
- [ ] **Step 6** — gate + commit `feat(auth): email magic-link sign-in`.

---

### Task 3: Microsoft (adds the shared OIDC verifier)

**Files:**
- Add dep `jose`. Create `server/services/auth-providers/oidc.ts`, `server/services/auth-providers/microsoft.ts`. Modify `server/routes/auth.ts` (dispatch `microsoft`), `AuthControl.tsx`, `.env.example`, add `@azure/msal-browser`.
- Test: `tests/server/auth-oidc.test.ts`, `tests/server/auth-microsoft.test.ts`.

- [ ] **Step 1: `oidc.ts`**:
```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
export async function verifyOidcIdToken(cfg: { jwksUrl: string; issuer: string | string[]; audience: string }, idToken: string) {
  const set = jwks.get(cfg.jwksUrl) ?? jwks.set(cfg.jwksUrl, createRemoteJWKSet(new URL(cfg.jwksUrl))).get(cfg.jwksUrl)!
  const { payload } = await jwtVerify(idToken, set, { issuer: cfg.issuer, audience: cfg.audience })
  return { sub: String(payload.sub), email: (payload.email as string) ?? (payload.preferred_username as string) ?? null,
           name: (payload.name as string) ?? null, emailVerified: payload.email_verified !== false }
}
```
- [ ] **Step 2: Failing tests** — `oidc.test.ts` signs a token with a local JWKS (via `jose` `generateKeyPair` + `SignJWT`), stubs `createRemoteJWKSet`, asserts valid → identity and bad `aud`/`iss`/expiry → throws. `auth-microsoft.test.ts`: `verifyMicrosoftIdToken` maps claims (email fallback to `preferred_username`); unconfigured env → `provider_unconfigured`.
- [ ] **Step 3: `microsoft.ts`** — `verifyMicrosoftIdToken(idToken)`: require `MICROSOFT_CLIENT_ID` (else `AuthError('provider_unconfigured')`); `verifyOidcIdToken({ jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys', issuer: <MS issuers>, audience: MICROSOFT_CLIENT_ID }, idToken)` → `ProviderIdentity{ provider:'microsoft' }`.
- [ ] **Step 4: Route** — dispatch `microsoft` in `POST /auth/:provider`.
- [ ] **Step 5: Frontend** — MSAL popup (`@azure/msal-browser`) → `idToken` → `api.auth.oauth('microsoft', idToken)`; button hidden when `VITE_MICROSOFT_CLIENT_ID` unset.
- [ ] **Step 6** — gate + commit `feat(auth): Microsoft sign-in (+ shared OIDC verifier)`.

---

### Task 4: Apple

**Files:** Create `server/services/auth-providers/apple.ts`; modify route dispatch, `AuthControl.tsx` (Sign in with Apple JS), `.env.example`. Test: `tests/server/auth-apple.test.ts`.

- [ ] **Step 1: Failing test** — `verifyAppleIdToken` via `oidc.ts` (JWKS `https://appleid.apple.com/auth/keys`, iss `https://appleid.apple.com`, aud `APPLE_SERVICE_ID`); unconfigured → `provider_unconfigured`; a `@privaterelay.appleid.com` email still returns an identity (the allowlist, not the verifier, rejects it downstream — assert via a `loginWithIdentity` not-invited case).
- [ ] **Step 2: `apple.ts`** — verify id_token; name is not in the token — accept an optional `name` argument from the route body (first-login payload) and pass it through; downstream upsert only fills `users.name` when empty.
- [ ] **Step 3: Route** — dispatch `apple`, threading the optional `{ user: { name } }` first-login field.
- [ ] **Step 4: Frontend** — Sign in with Apple JS button → id_token (+ first-login name) → `api.auth.oauth('apple', idToken, name?)`. Map the downstream `not_invited` for a relay address to the specific "Apple hid your email…" message.
- [ ] **Step 5** — gate + commit `feat(auth): Apple sign-in`.

---

### Task 5: Facebook

**Files:** Create `server/services/auth-providers/facebook.ts`; modify route dispatch, `AuthControl.tsx` (FB SDK), `.env.example`. Test: `tests/server/auth-facebook.test.ts`.

- [ ] **Step 1: Failing test** — mock `fetch`: `debug_token` returns `is_valid:true, app_id: FACEBOOK_APP_ID` and `/me` returns `{ id, name, email }` → identity; wrong `app_id` or `is_valid:false` → `invalid_token`; missing email → `no_email` (downstream 403 message). Unconfigured env → `provider_unconfigured`.
- [ ] **Step 2: `facebook.ts`** — `verifyFacebookToken(accessToken)`: require `FACEBOOK_APP_ID`+`FACEBOOK_APP_SECRET`; `GET /debug_token?input_token&access_token=APP_ID|APP_SECRET` → validate; `GET /me?fields=id,name,email&access_token`; return `ProviderIdentity{ provider:'facebook', sub:id }`.
- [ ] **Step 3: Route** — dispatch `facebook` (body `{ accessToken }`).
- [ ] **Step 4: Frontend** — FB SDK login → access token → `api.auth.oauth('facebook', accessToken)`; map `no_email` to "Facebook didn't share an email" message; button hidden when `VITE_FACEBOOK_APP_ID` unset.
- [ ] **Step 5** — gate + commit `feat(auth): Facebook sign-in`.

---

### Task 6: Polish — configured-gating, docs

**Files:** `src/components/layout/AuthControl.tsx` (hide unconfigured buttons via a small `/api/auth/providers` capability endpoint OR `VITE_*` presence checks), `server/routes/auth.ts` (`GET /auth/providers` → which are configured), `.env.example`, `docs/architecture.md`, `CLAUDE.md` (API table rows for the new endpoints).

- [ ] **Step 1** — `GET /api/auth/providers` returns `{ google, microsoft, apple, facebook, magicLink }` booleans from server env; frontend shows only configured buttons (magic-link always on when email is configured).
- [ ] **Step 2** — update `.env.example`, `docs/architecture.md` (Backend API + a "Multi-provider auth" subsection), `CLAUDE.md` API table.
- [ ] **Step 3** — full gate (`npm run lint && npm run build && npm test`); commit `feat(auth): provider capability gating + docs`.

---

## Owner setup (before the OAuth providers can go live)
- **Apple:** Apple Developer account → Service ID (client id) + registered domain/return URL. Set `APPLE_SERVICE_ID` / `VITE_APPLE_SERVICE_ID`.
- **Microsoft:** Azure app registration (SPA) → client id + redirect URI. Set `MICROSOFT_CLIENT_ID` / `VITE_MICROSOFT_CLIENT_ID`.
- **Facebook:** Meta app → App ID + App Secret; email-permission review. Set `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` / `VITE_FACEBOOK_APP_ID`.
- Magic-link needs only existing Resend + `JWT_SECRET`.

## Verification
- `npm test` green including the new per-provider verifier tests, magic-link single-use, and the `loginWithIdentity` gate; `npm run lint && npm run build`.
- Manual per provider (once env set): sign in → account created/linked, `user_identities` row present, tokens issued; a non-invited email → clear 403; Apple hidden-email / Facebook no-email → the specific messages.
- Regression: existing Google login still works end-to-end.

## Self-review notes
- Google login preserved (Task 1 keeps it green before any provider is added). `jose` introduced only in Task 3 where first needed. Each provider is independently env-gated. `loginWithIdentity` is the single choke point enforcing invite-only for all providers including magic-link.
