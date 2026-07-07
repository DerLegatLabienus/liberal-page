# Multi-Provider Login — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan

> **Implementation note (2026-07-07): Microsoft login is disabled.** The nOAuth account-takeover
> mitigation below requires a provider-verified email signal before account-linking. For Microsoft,
> that signal is the `xms_edov` optional claim, which is only emitted when the Entra **app
> registration is explicitly configured to send it** — configuration the owner opted not to
> maintain. Rather than ship an unsafe or half-working flow, Microsoft is **not registered** in the
> route's `verifiers` map (so `POST /api/auth/microsoft` → `400`) and the frontend MSAL button is
> removed. The `microsoft.ts` adapter (with correct `xms_edov` handling) and its tests are kept
> **dormant** as the blueprint. To re-enable: configure `xms_edov` + `email` optional claims in
> Azure, add `microsoft` back to `verifiers`, and restore the frontend button.
> **Shipped today:** Google + email magic-link, both behind the verified-email gate.

## Goal

Let members sign in with **Apple, Facebook, Microsoft, and an email magic-link**, in addition to the existing Google Sign-In. **Login stays invite-only** — every provider funnels through the current email allowlist gate unchanged. Adding a provider must never widen who can log in; it only adds *ways* an already-invited email can authenticate.

## Background (current auth)

- Single provider: `POST /api/auth/google` → `verifyGoogleIdToken` → `{ email, sub, name }` → allowlist gate → upsert → issue JWT access/refresh tokens (`server/services/auth-service.ts`, `server/routes/auth.ts`).
- **Identity is email-keyed:** `users` upserts on `email` (unique); `google_sub` is stored but email is the account key. A second provider with the same invited email links to the same account.
- **Invite-only:** `authRepo.getAllowedEmail(email)`; sign-in is `403 "not invited"` unless the email is on the `allowedEmails` allowlist or already a user.
- Frontend: `AuthContext.signIn(googleIdToken)` → `api.auth.google(idToken)`; login UI in `src/components/layout/AuthControl.tsx`.

## Architecture

**One pipeline, many front doors.** Every provider resolves to a verified identity, then funnels through the existing gate:

```
provider credential → verify → { provider, sub, email, name } → loginWithIdentity()
   loginWithIdentity: allowlist gate (unchanged) → upsert user by email
                      → record (provider, sub) in user_identities → issue JWTs
```

**Verification is unified where possible.** Google, Microsoft, and Apple all issue **OIDC id_tokens** — a single helper verifies all three against each provider's JWKS with `jose`: signature + `iss` + `aud` (= that provider's client/service id) + `exp`. Facebook is not OIDC → verify its access token via the Graph API. Magic-link is our own signed, single-use token flow.

**Client-side token model (matches existing Google flow).** Each OAuth provider's browser SDK yields a token the frontend POSTs to the backend; the backend verifies it. No server-side OAuth redirect/callback or (except Facebook) provider secret is required.

## Identity model / schema

Add a `user_identities` table (new migration, `auth` schema):

```
user_identities(
  id            serial pk,
  user_id       int not null references users(id) on delete cascade,
  provider      text not null,          -- 'google' | 'apple' | 'microsoft' | 'facebook'
  provider_sub  text not null,          -- the provider's stable subject id
  created_at    timestamptz not null,
  unique(provider, provider_sub)
)
```

- **Backfill migration:** insert `('google', users.google_sub)` for every user with a non-null `google_sub`. Keep `users.google_sub` for now (no destructive drop).
- Account key remains **email**. `AuthRepository.upsertUserFromIdentity({ email, provider, sub, name, role })`: upsert the user by email (as today), then upsert the `(provider, provider_sub)` row pointing at `user.id` (`onConflict(provider, provider_sub) do update user_id`).
- Replaces `upsertUserFromGoogle` (which becomes a thin caller, or is removed once the route is generalized).

## Endpoints

- `POST /api/auth/:provider` where `provider ∈ {google, apple, microsoft, facebook}` — body carries the client-obtained credential (`{ idToken }` for OIDC providers, `{ accessToken }` for Facebook, plus Apple's first-login `{ user? }` name payload). Dispatches to the provider verifier → `loginWithIdentity()`. Returns the existing `AuthResponse` (user + tokens). The current `POST /api/auth/google` becomes this route's `google` case (frontend updated accordingly).
- `POST /api/auth/magic-link/request` `{ email }` — normalize email; **always respond `200` with a neutral message** (never reveal whether an email is invited/registered). If the email is allowlisted or an existing user, generate a random token, store its hash + expiry, and email the link via Resend.
- `POST /api/auth/magic-link/verify` `{ token }` — hash + look up; reject if missing/expired; **delete (single-use)**; then `loginWithIdentity({ provider: 'magic-link'? })`. Magic-link has no provider sub — it authenticates the *email* directly, so it upserts the user by email without a `user_identities` row (or records `('email', email)` — decide in plan; simplest: no identity row).
- `/refresh`, `/logout`, `/me` unchanged.

## Provider adapters (`server/services/auth-providers/`)

- **`oidc.ts`** — `verifyOidcIdToken({ jwksUrl, issuer, audience }, idToken) → { sub, email, name, emailVerified }` using `jose` (`createRemoteJWKSet` + `jwtVerify`). JWKS sets cached per provider.
- **`google.ts`** — reuse existing `verifyGoogleIdToken` (or route through `oidc.ts`: iss `https://accounts.google.com`, aud `GOOGLE_CLIENT_ID`).
- **`microsoft.ts`** — `oidc.ts` with JWKS `https://login.microsoftonline.com/common/discovery/v2.0/keys`, aud `MICROSOFT_CLIENT_ID`. Email from `email` claim, falling back to `preferred_username` (work/school accounts may omit `email`). Note tenant `common` — validate `aud` strictly; do not trust `tid`/`iss` beyond Microsoft's issuer set.
- **`apple.ts`** — `oidc.ts` with JWKS `https://appleid.apple.com/auth/keys`, iss `https://appleid.apple.com`, aud `APPLE_SERVICE_ID`. Name is **not** in the token — it arrives once in the first-login form payload; persist it only if `users.name` is empty. **"Hide My Email"** yields a `@privaterelay.appleid.com` address → fails the allowlist for invited users → surfaced as a specific "Apple hid your email; sign in another way or share your email" message (accepted limitation).
- **`facebook.ts`** — verify the access token: `GET graph.facebook.com/debug_token?input_token=TOKEN&access_token=APP_ID|APP_SECRET` → require `data.is_valid && data.app_id === FACEBOOK_APP_ID`; then `GET graph.facebook.com/me?fields=id,name,email&access_token=TOKEN`. **Email may be absent** → specific "Facebook didn't share an email" message (accepted limitation).

## Shared pipeline (`server/services/auth-service.ts`)

`loginWithIdentity({ provider, sub, email, name }) → { user, accessToken, refreshToken }`:
1. `email = normalize(email)`; if no email → throw `NoEmail`.
2. `allowed = getAllowedEmail(email)`, `existing = findUserByEmail(email)`; if `!allowed && !existing` → throw `NotInvited` (route → 403 with a clear reason).
3. `role = existing?.role ?? allowed.role`.
4. `user = upsertUserFromIdentity({ email, provider, sub, name, role })`.
5. Issue access + refresh tokens (existing helpers). Return.

The route maps `NotInvited`/`NoEmail`/`InvalidToken` to `403`/`401` with distinct messages so the frontend can explain provider-specific failures.

## Frontend

- **`AuthControl.tsx`** — add buttons: Google (existing), Microsoft, Apple, Facebook, and an **email magic-link** field ("Send me a sign-in link"). Each OAuth button uses its client SDK to obtain a token, then `api.auth.oauth(provider, token)`.
- **SDKs:** Microsoft `@azure/msal-browser` (npm); Apple *Sign in with Apple JS* and the Facebook *JS SDK* load as external scripts (documented; only where the app already tolerates third-party scripts — not inside the CSP-restricted artifact context).
- **`api-client.ts`** — `api.auth.oauth(provider, token)` → `POST /auth/:provider`; `api.auth.magicLink.request(email)` and `.verify(token)`. Keep `api.auth.google` as a thin wrapper over `oauth('google', …)` during migration.
- **Magic-link route** — a `/auth/magic-link` frontend route reads `?token=` and calls `verify`, then stores the returned session (same path as `signIn`).
- **`AuthContext`** — generalize `signIn` to accept `(provider, token)` and add a magic-link verify entry point.

## Config / env

- Frontend: `VITE_MICROSOFT_CLIENT_ID`, `VITE_APPLE_SERVICE_ID`, `VITE_FACEBOOK_APP_ID` (Google already present).
- Backend: `MICROSOFT_CLIENT_ID` (+ optional `MICROSOFT_TENANT`, default `common`), `APPLE_SERVICE_ID`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`. Magic-link reuses `JWT_SECRET` + Resend (`RESEND_API_KEY`, `EMAIL_FROM`).
- Each provider is independently optional: if its env is unset, the backend rejects that provider's route (`503 provider not configured`) and the frontend hides its button.

## Owner setup (external accounts)

- **Apple:** Apple Developer account → create a **Service ID** (= client id / `aud`); register the site domain + return URL. *(No signed client secret on the id_token path.)*
- **Microsoft:** Azure app registration (SPA platform) → client id; add the site redirect URI. *(Public client, no secret.)*
- **Facebook:** Meta app → App ID + **App Secret**; add the site domain; Meta review for the `email` permission before production.
- **Magic-link:** none.

## Security considerations

- Trust the email only from a **verified** provider assertion: OIDC signature + `aud` check binds the token to our app; Facebook `debug_token` binds the token to our app id. Never trust an email from an unverified/mismatched-audience token.
- **Email ownership must be verified before account-linking (nOAuth mitigation).** A valid, audience-bound token proves the caller went through the provider — NOT that they own the email in it. `ProviderIdentity` carries `emailVerified`, and `loginWithIdentity` **rejects** (`email_not_verified`) any identity whose email is not provably owned, since accounts are linked by email. Per provider: Google/Apple → the `email_verified` claim; **Microsoft → the `xms_edov` claim** (the `email` claim under multi-tenant `common` is attacker-settable, so a real org/personal account is required — the app registration must emit `xms_edov` + `email` optional claims, else fail closed); Facebook → Graph email (Facebook-verified); magic-link → inherently verified (link delivered to the inbox). This closes the takeover where a self-registered Entra tenant sets `email=victim@invited` and merges into the victim's account.
- **Magic-link:** random 32-byte token, stored **hashed**, 15-minute expiry, **single-use** (deleted on verify); the request endpoint is neutral (no user enumeration) and per-email/per-IP rate-limited.
- Account linking is by verified email — intended (invited person, one account across providers). `user_identities` binds each provider sub to that account for auditability.
- Apple/Facebook email-withholding is an **accepted** invite-only limitation, surfaced with a specific message, not a silent generic 403.

## Testing

- `oidc.ts` — valid token (mocked JWKS) → identity; bad `aud`/`iss`/signature/expiry → throws. One case per real provider config (Google/Microsoft/Apple).
- `facebook.ts` — mocked Graph: valid app-bound token + email → identity; invalid token / wrong app_id / missing email → throws / no-email.
- Magic-link — request stores a hashed token + emails (Resend mocked) and is neutral for unknown emails; verify consumes single-use, rejects expired/reused/unknown; not-invited email never gets a usable link.
- `loginWithIdentity` — invited → in; not-invited → `NotInvited`; existing-user-not-allowlisted → in (grandfathered); links `user_identities`.
- `user_identities` backfill migration applies and links existing Google users.
- Route dispatch — `/auth/:provider` verifies + logs in; unknown/unconfigured provider → 400/503.

## Decomposition (for the implementation plan)

Independent, stackable stages on a shared foundation:
1. **Foundation** — `user_identities` table + backfill; `upsertUserFromIdentity`; `loginWithIdentity`; generalize `POST /auth/:provider` (migrate Google onto it, keep it green).
2. **Email magic-link** — token table, request/verify endpoints, Resend email, frontend field + `/auth/magic-link` route.
3. **Microsoft** — `oidc.ts` + `microsoft.ts` adapter, MSAL button.
4. **Apple** — `apple.ts` adapter + Sign in with Apple JS button + first-login name handling + hidden-email message.
5. **Facebook** — `facebook.ts` Graph verification + FB SDK button + no-email message.
6. **Polish** — per-provider "configured?" gating (hide buttons / 503), docs (`architecture.md`, `CLAUDE.md` API table, `.env.example`).

## Out of scope

- Opening registration beyond invite-only (explicitly retained).
- Server-side OAuth authorization-code/redirect flows (client-side token model is used).
- Account-management UI to unlink providers (may be a later addition).
- Phone/SMS login (previously ruled out on cost/privacy).
