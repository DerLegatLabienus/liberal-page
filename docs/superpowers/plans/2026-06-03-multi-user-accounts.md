# Multi-User Accounts — Implementation Plan (#3)

> Staged in 3 phases. TDD on backend logic (node + pglite); frontend in happy-dom.
> Each phase ends green (`npx tsc --noEmit`, `npm test`) and is committed.

Spec: `docs/superpowers/specs/2026-06-03-multi-user-accounts-design.md`.

**Tech:** new deps `google-auth-library`, `jsonwebtoken` (+ `@types/jsonwebtoken`). New env:
`GOOGLE_CLIENT_ID`, `JWT_SECRET`, `ACCESS_TOKEN_TTL` (default `900` s), `REFRESH_TOKEN_TTL`
(default `2592000` s = 30 d); frontend `VITE_GOOGLE_CLIENT_ID`.

---

## Phase 1 — Auth foundation

### Task 1.1: Deps + env
- `npm i google-auth-library jsonwebtoken && npm i -D @types/jsonwebtoken`.
- Add the new env vars (with safe dev defaults) to `.env.example`.

### Task 1.2: Schema + migration
- `server/db/schema/tracking.ts` `users`: add `email text` (unique), `name text`,
  `googleSub text` (unique), `role text NOT NULL default 'member'`, `lastLoginAt timestamptz`.
- New `server/db/schema/auth.ts`: `allowedEmails` (`email` PK, `role` default `'member'`,
  `invitedBy` int → users.id, `createdAt`), `refreshTokens` (`id` serial PK, `userId` →
  users.id restrict, `tokenHash` text, `expiresAt` timestamptz, `createdAt`). Export from
  `schema/index.ts`.
- `npm run db:generate` → `0009_*.sql` (schema). Then a **custom** migration
  `0010_seed_first_admin` (drizzle-kit generate --custom): `INSERT INTO allowed_emails
  (email, role, created_at) VALUES ('avivavitan63@gmail.com','admin',now()) ON CONFLICT DO NOTHING`.

### Task 1.3: Auth repos (TDD)
- `AuthRepository` (`server/repositories/auth-repository.ts`):
  - `getAllowedEmail(email): { email, role } | null`
  - `upsertUserFromGoogle({ email, googleSub, name, role }): User` (insert or update by email;
    set role from allowlist only on first insert)
  - `findUserById(id)`, `findUserByEmail(email)`
  - refresh tokens: `createRefreshToken(userId, tokenHash, expiresAt)`,
    `findRefreshToken(tokenHash) → row|null`, `deleteRefreshToken(tokenHash)`,
    `deleteUserRefreshTokens(userId)`, `deleteExpired(now)`.
- Tests `tests/server/auth-repository.test.ts` (pglite): allowlist lookup; upsert creates with
  allowlist role then is idempotent (role not downgraded on re-login); refresh create/find/
  delete; `deleteUserRefreshTokens`; `deleteExpired` removes only past rows.

### Task 1.4: Auth service (TDD)
- `server/services/auth-service.ts`:
  - `verifyGoogleIdToken(idToken): { email, sub, name }` — wraps `google-auth-library`
    `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`. (Injectable verifier
    for tests.)
  - `issueAccessToken(user): string` — `jwt.sign({ userId, role }, JWT_SECRET, { expiresIn })`.
  - `verifyAccessToken(token): { userId, role } | null`.
  - `issueRefreshToken(userId): { token, expiresAt }` — random 32-byte hex; store **hash**
    (`sha256`) via repo; return raw token.
  - `rotateRefreshToken(rawToken): { user, accessToken, refreshToken } | 'invalid' | 'reuse'`
    — hash-lookup; if missing → `reuse` (caller deletes all user tokens *if* it can identify
    the user — here just signal re-login); if expired → delete + `invalid`; else delete old +
    issue new + new access token.
- Tests `tests/server/auth-service.test.ts`: access token round-trip + tamper/expiry →
  null; refresh issue stores a hash (raw not equal stored); rotation deletes old + returns new;
  expired refresh → invalid; unknown refresh → reuse.

### Task 1.5: Middleware (TDD)
- `server/middleware/auth.ts`: `requireAuth`, `requireAdmin`, `optionalAuth` — read
  `Authorization: Bearer`, `verifyAccessToken`, set `req.user = { id, role }`.
- Tests `tests/server/auth-middleware.test.ts` (supertest tiny app): no/!valid token → 401;
  valid → 200 + user; admin route: member → 403, admin → 200; optionalAuth passes through.

### Task 1.6: Auth routes (TDD)
- `server/routes/auth.ts`: `POST /google` (verify ID token → allowlist gate (else 403) →
  upsert → issue access+refresh), `POST /refresh`, `POST /logout`, `GET /me` (requireAuth).
  Mount `app.use('/api/auth', authRouter)` in `server/index.ts`.
- Tests `tests/server/auth-route.test.ts` (mock the Google verifier): allowed email → 200 +
  tokens + user; not-allowed → 403; `/refresh` rotates; `/logout` deletes; `/me` returns user.

### Task 1.7: Token cleanup in poller
- Poller cycle step (own try/catch): `authRepo.deleteExpired(new Date())`.

### Task 1.8: Frontend auth (no tests beyond provider smoke)
- `npm i @react-oauth/google` (GIS wrapper) OR load GIS script directly. Wrap app in
  `GoogleOAuthProvider` (`VITE_GOOGLE_CLIENT_ID`) in `main.tsx`.
- `src/contexts/AuthContext.tsx`: `AuthProvider` + `useAuth()` — `{ user, signIn, signOut }`;
  access token in memory, refresh token in `localStorage`; `signIn(idToken)` → `POST
  /auth/google`; on mount, if a refresh token exists, call `/auth/refresh` to restore session.
- `src/lib/api-client.ts`: attach `Authorization` from a token getter; on 401 try `/auth/refresh`
  once then retry, else `signOut`.
- Header: GIS sign-in button when logged out; name + sign-out when logged in.
- Test `tests/components/AuthContext.test.tsx`: provider sign-in (mock api) sets user; sign-out clears.

**Phase 1 commit:** `feat(auth): Google sign-in, JWT sessions, refresh w/ deletion (#3 phase 1)`.

---

## Phase 2 — Group vs personal scoping

### Task 2.1: Group account + discard migration
- Replace `UsersRepository.getSharedUserId()` with `getGroupUserId()` (the `role='group'`
  row; create if absent). Custom migration `0011_group_account`: `UPDATE users SET
  role='group' WHERE label='shared'`; `DELETE FROM tracked_bills/committees/mks` for that
  user id (discard). Idempotent.

### Task 2.2: Scoped reads/writes (TDD)
- A `resolveScopeUserId(req, scope)` helper: `scope==='personal'` → `req.user.id` (401 if
  none); else → `getGroupUserId()`. `scope==='group'` writes require admin.
- `parliament.ts` `GET /:type` (optionalAuth): default group, `?scope=personal` → caller.
- `tracking.ts` add/delete (requireAuth): default personal; `?scope=group` → requireAdmin.
- `bills.ts`/`committees.ts` `/track`: same scoping. Replace all `getSharedUserId()` calls.
- Update existing route tests to pass auth + assert scope isolation; add member-writes-group → 403.

### Task 2.3: Frontend scope toggle
- `useParliament`: fetch group list always; fetch personal when logged in. Drawer toggle
  **Group / My list**; add/remove target the active scope (personal for members; group for
  admins in edit mode). Read-only group view for members/anon.

**Phase 2 commit:** `feat(tracking): group vs personal lists with admin-curated public list (#3 phase 2)`.

---

## Phase 3 — Admin

### Task 3.1: Admin routes (TDD)
- `server/routes/admin.ts` (requireAdmin): `GET/POST/DELETE /api/admin/invites`
  (allowed_emails CRUD); `GET /api/admin/users`; `PATCH /api/admin/users/:id/role` with the
  **last-admin guard** (409 if it would remove the final admin). Mount it.
- Tests: invites CRUD admin-only (member → 403); promote/demote; last-admin guard → 409.

### Task 3.2: Admin UI
- `src/components/admin/AdminPanel.tsx`: invite email + role; list/remove invites; list users +
  change role (disable demoting last admin). Shown only when `user.role==='admin'`.
- "Edit group list" mode in the tracker for admins (writes with `scope=group`).
- Test: AdminPanel renders for admin, hidden for member; invite calls api (mocked).

### Task 3.3: Docs + backlog
- `docs/architecture.md`: auth model, scopes, admin. `docs/data-schema.md`: users columns,
  `allowed_emails`, `refresh_tokens`. `BACKLOG.md`: mark #3 (accounts half) done; note alerts
  remain.

**Phase 3 commit + merge to master.**

## Verification (each phase)
- `npx tsc --noEmit` clean; `npm test` green; `npm run lint` no new errors.
