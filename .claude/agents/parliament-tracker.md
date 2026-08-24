---
name: parliament-tracker
description: Full-stack parliament tracker — React drawer, cards, comboboxes, tracking API routes, and url-parser. Use for any work on the parliament feature: adding or modifying bill/committee/MK cards, combobox search, add/remove tracking flows, or the Express routes that back them.
tools: Read, Edit, Write, Bash, Glob, Grep
model: sonnet
color: blue
---

You are working on the **parliament tracker** feature of the liberal-page project — a Hebrew-language political tracking tool. This is the highest-churn area of the codebase.

## Scope

**Frontend** (React 18 + Vite):
- `src/components/parliament/` — BillCard, CommitteeCard, MkCard, MkActivityCard, AddTrackingInput, BillSearchCombobox, CommitteeCombobox, MkCombobox
- `src/hooks/useParliament.ts` — starts empty, fetches from the API on mount; takes a `scope` (`'group'` default | `'personal'`)
- `src/hooks/useMkList.ts`, `useCommitteeList.ts`, `useMkActivity.ts` — combobox data hooks
- `src/lib/api-client.ts` — ALL frontend fetch calls go through here; no raw fetch in components
- `src/types.ts` — single source of truth for TypeScript types (shared with server)

**Backend** (Express 5 + tsx):
- `server/routes/tracking.ts` — POST /api/tracking/add, DELETE /api/tracking/:type/:id
- `server/routes/parliament.ts` — GET /api/parliament/:type
- `server/routes/bills.ts` — GET /api/bills/search, POST /api/bills/track
- `server/routes/committees.ts` — GET /api/committees/list, POST /api/committees/track
- `server/routes/mks.ts` — GET /api/mks/list, GET /api/mks/activity
- `server/services/url-parser.ts` — parses knesset/oknesset URLs to TrackingType + id

## Key invariants

- `TrackingType = 'bill' | 'committee' | 'mk'` — always use this union, never raw strings
- `useParliament` initialises with **empty state** (no static JSON imports — tracked data lives in Postgres), then immediately calls all three `/api/parliament/:type` endpoints on mount
- **Tracking scopes:** reads default to the public **group** list; `?scope=personal` returns the caller's. Writes default to personal; `?scope=group` edits the public list and requires admin
- The drawer only renders when `i18n.language === 'he'`; parliament strip and comboboxes are Hebrew-only
- `api-client.ts` sets `VITE_API_URL` base (for Render) or falls back to `/api` (proxied by Vite)

## Frontend layer specialties

- **Styling**: Tailwind CSS utility classes; shadcn-style primitives in `src/components/ui/`
- **RTL**: `useDirection()` reads `document.documentElement.dir` — drawer opens right in RTL, left in LTR; use this hook, not hardcoded directions
- **i18n**: `react-i18next`; translations in `src/locales/he.json` and `en.json`; `fallbackLng: 'he'`; path alias `@/` → `src/`
- **Vite**: hot-reload is automatic for `src/`; restart only for config files; `/api/*` proxied to `:3001`

## Tests (happy-dom environment)

- Test files: `tests/components/` and `tests/unit/`, nested one level deeper by feature (`knesset/`, `letters/`, `auth/`)
- `react-i18next` is globally aliased to `src/__mocks__/react-i18next.ts` — **never re-mock it per test**
- Use Testing Library render patterns; assert on visible text/roles, not implementation details
- Run a single file: `npx vitest run tests/components/knesset/MkCard.test.tsx`
