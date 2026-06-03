# Multi-User Accounts — Design

**Status:** Approved design
**Date:** 2026-06-03
**Backlog item:** #3 (User Accounts — the accounts/auth half; email alerts are a separate spec)

## Context

Today the app uses a single shared account (`users.id = 1`, `label = 'shared'`); all tracked
bills/committees/MKs hang off it and everyone sees the same list. The repository layer is
already `userId`-parameterized with per-user unique constraints, so the only single-user
assumptions are `UsersRepository.getSharedUserId()` and seven route call sites, plus the
absence of any auth.

This spec introduces real accounts for a **closed, invite-only group** (a political "cell"),
with **Google sign-in**, **bearer-JWT sessions**, **per-user tracking lists**, a curated
**public group list**, and a **minimal admin UI**. Email alerts (#3b) and Meet-Us (#15) are
separate, dependent specs and are out of scope here.

## Decisions (locked during brainstorming)

- **Closed / invite-only.** No public self-signup. An email allowlist gates who may sign in.
- **Google Identity Services (GIS) sign-in.** No passwords, no email service. The same flow
  for everyone — admins are not a separate login.
- **Bearer JWT sessions** (short-lived access token + rotating refresh token). Chosen over
  cookies because the frontend (GitHub Pages) and API (Render) are different sites, where
  cross-site cookies are fragile.
- **Public group list + personal lists.** Anonymous visitors see the admin-curated group
  list (read-only); logged-in members additionally get a personal list. The current shared
  data is **discarded** — the group list starts empty.
- **Roles: `admin`, `member`** (+ a special `group` account that owns the public list).
  Admins curate the group list and manage invites; members manage only their own list.
- **Admin assignment:** invite-as-admin **and** promote/demote existing users; first admin
  **seeded**; the **last admin cannot be removed/demoted**.
- **Invalidated refresh tokens are deleted** (deletion is the only invalidation mechanism).

## Auth flow

1. Frontend renders the GIS "Sign in with Google" button (`VITE_GOOGLE_CLIENT_ID`). On
   success GIS hands the SPA a Google **ID token** (a JWT).
2. Frontend `POST /api/auth/google { idToken }`. Backend verifies it with
   `google-auth-library` against `GOOGLE_CLIENT_ID`, extracting `email` and `sub`.
3. **Allowlist gate:** if `email` is in `allowed_emails` **or** already a `users` row →
   upsert the user (store `google_sub`, `name`, `last_login_at`; role from `allowed_emails`
   on first login). Otherwise **403** ("not invited").
4. Issue an **access JWT** (`{ userId, role }`, signed with `JWT_SECRET`, ~15 min) and a
   **refresh token** (opaque random string; only its hash stored in `refresh_tokens`).
   Response: `{ accessToken, refreshToken, user }`.
5. `POST /api/auth/refresh { refreshToken }` → verify (hash lookup, not expired) → **delete
   that row**, insert a fresh one (rotation), return a new access token (+ refresh).
6. `POST /api/auth/logout` → **delete** the user's refresh-token row(s).
7. `GET /api/auth/me` (requireAuth) → current user.

**Token storage (frontend):** access token in memory; refresh token in `localStorage`.
Short access TTL limits XSS exposure; refresh rotation + server-side hash storage allow
revocation.

**Refresh-token table hygiene (deletion = invalidation):**
- No `revoked` column — validity is "row exists AND `expires_at > now()`".
- Rotation deletes the used row; logout deletes the user's rows.
- On each login/refresh, delete that user's expired rows; a periodic global sweep in the
  poller runs `DELETE FROM refresh_tokens WHERE expires_at < now()`.
- **Reuse detection:** the raw refresh token is **self-identifying** — `${userId}.${randomHex}`
  (only the sha256 hash of the whole string is stored). On a hash miss (token already rotated
  away / replayed), parse the `userId` prefix and delete **all** that user's refresh tokens,
  forcing re-login. (Hash-only storage couldn't identify the user on a miss; the prefix fixes
  that.)

## Data model (migration)

`users` — add columns (existing `id`, `label`, `created_at` kept):
| Column | Type | Notes |
|---|---|---|
| `email` | text | unique (nullable only for the legacy/group row until set) |
| `name` | text | display name from Google |
| `google_sub` | text | unique; null until first Google login |
| `role` | text NOT NULL default `'member'` | `'admin' \| 'member' \| 'group'` |
| `last_login_at` | timestamptz | |

New tables:
- **`allowed_emails`**: `email` text PK, `role` text NOT NULL default `'member'`,
  `invited_by` integer → `users.id`, `created_at` timestamptz.
- **`refresh_tokens`**: `id` serial PK, `user_id` → `users.id` (onDelete restrict),
  `token_hash` text NOT NULL, `expires_at` timestamptz NOT NULL, `created_at` timestamptz.

Data migration (`0009_*`, idempotent):
- Repurpose the existing shared row (`label='shared'`) as the group account: set
  `role='group'`. **Delete its `tracked_bills/committees/mks` rows** (discard today's data →
  group list starts empty).
- Seed the first admin: `INSERT INTO allowed_emails (email, role) VALUES
  ('avivavitan63@gmail.com', 'admin') ON CONFLICT DO NOTHING`.

`getSharedUserId()` → replaced by a `getGroupUserId()` (the `role='group'` row) for the
public list; per-user ids come from the JWT.

## Backend

- **Middleware** (`server/middleware/auth.ts`): `requireAuth` (verify Bearer → `req.user =
  { id, role }`, else 401), `requireAdmin` (requireAuth + `role==='admin'`, else 403),
  `optionalAuth` (attach `req.user` if a valid token is present, else continue).
- **Routes** `server/routes/auth.ts`: `/google`, `/refresh`, `/logout`, `/me`.
- **Scoped tracking/reads** — resolve the target user from scope:
  - `GET /api/parliament/:type` (optionalAuth) → **group** list by default;
    `?scope=personal` (requireAuth) → caller's list.
  - `POST /api/tracking/add`, `DELETE /api/tracking/:type/:id` (requireAuth) → personal by
    default; `?scope=group` requires **admin** (writes to the group account).
  - `bills/track`, `committees/track` similarly: personal (requireAuth) or group (admin).
  - Replace the 7 `getSharedUserId()` calls with the resolved id.
- **Admin** `server/routes/admin.ts` (requireAdmin): `GET/POST/DELETE /api/admin/invites`
  (manage `allowed_emails`); `GET /api/admin/users` + `PATCH /api/admin/users/:id/role`
  (promote/demote, with the **last-admin guard**).
- **CORS:** unchanged (bearer tokens need no credentialed CORS). New deps:
  `google-auth-library`, `jsonwebtoken` (+ `@types/jsonwebtoken`). New env: `GOOGLE_CLIENT_ID`,
  `JWT_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`.

## Frontend

- **`AuthProvider`** (`src/contexts/AuthContext.tsx`): `{ user, signIn, signOut }`; holds the
  access token in memory + refresh token in `localStorage`; exposes auth state.
- **`api-client`**: attaches `Authorization: Bearer`; on a 401 it tries `/auth/refresh`
  once, then retries, else signs out.
- **GIS button** in the header (`VITE_GOOGLE_CLIENT_ID`); a user menu (name + sign out).
- **Tracker UI** (`useParliament`, parliament drawer):
  - Logged-out → group list, read-only, "Sign in" CTA.
  - Member → toggle **Group list** (read-only) / **My list** (editable add/remove).
  - Admin → also an **Edit group list** mode (add/remove on the group list) and an
    **admin panel** (`src/components/admin/`): invite emails, list/role users.
  - Public sections (hero/about/gallery/FAQ/join) unchanged.

## Error handling

- 401 → refresh once, else sign out + show sign-in. 403 → "not invited" (login) or "admins
  only" (in-app). Google verify failure → 401. Reuse-detected refresh → all sessions
  invalidated, re-login. Last-admin demotion/removal → 409 with a clear message.

## Testing

**Backend (node + pglite):**
- Google verify mocked: allowed email → user upserted with correct role; not-allowed → 403.
- JWT issue/verify; `requireAuth`/`requireAdmin`/`optionalAuth` behavior (200/401/403).
- Refresh rotation **deletes** the old row + issues new; logout deletes rows; expired-row
  cleanup; **reuse detection** deletes all the user's tokens.
- Parliament read: anon/`scope=group` → group list; `scope=personal` → caller's list.
- Tracking writes: personal default; `scope=group` allowed for admin, **403 for member**.
- Admin: invites CRUD admin-only; promote/demote; **last-admin guard** (409).
- Migration: new columns/tables; group row repurposed + tracked rows discarded; first-admin
  allowlist seeded.

**Frontend (happy-dom):** AuthProvider sign-in/out (GIS + api mocked); api-client 401→refresh
retry; tracker scope toggle (group vs personal); admin UI gated by role.

## Implementation phasing (one spec, staged plan)

1. **Auth foundation** — `users` columns + `allowed_emails` + `refresh_tokens` migration,
   Google verify, JWT + refresh (with deletion hygiene), middleware, `/auth/*`, AuthProvider
   + GIS login UI, first-admin seed.
2. **Scoping** — group vs personal reads/writes; replace `getSharedUserId`; discard-shared
   data migration; tracker UI group/personal toggle.
3. **Admin** — invites panel + user role management (promote/demote, last-admin guard) +
   group-list edit mode.

## Out of scope (separate specs)

- Email alerts on bill-status changes (#3b) — needs an email service.
- Meet-Us scheduling (#15) — depends on these accounts.
- httpOnly-cookie sessions / single-domain hosting (possible later hardening).
- Admin step-up auth / 2FA.
