# Frontend-Only Join Selector — Design Spec

**Date:** 2026-05-16
**Status:** Implemented
**Project:** `/home/aavitan/claude-projects/liberal-page`

## Problem

The previous backlog described a local `JoinForm` with a future `POST /api/members/join` endpoint and `src/data/members.json` storage. After reviewing `https://likudliberal.org/mitpakdim/` and the effective-soft forms, that is the wrong direction.

The official forms collect sensitive data including Israeli ID, signature, and in some flows credit-card number and CVV. The site should not collect, proxy, or store that data.

## Decision

Use a frontend-only selector that helps users choose the right official effective-soft form, then opens that form in a new tab.

No backend route. No local submission. No local storage. No proxy to effective-soft.

## Effective-Soft Discovery

The effective-soft form at `/XZone/pfo?uid=licudliberal` loads a React 0.14 app from `js/page-form.js?ver=fce9`.

The submit button builds a data object from embedded `_obj.fields`. When `_uid` exists, it posts via AJAX to:

```text
POST /XZone/Contact
```

with `fid=<uid>`, `tableName=t8807`, `pageID=2`, and form fields such as `f3`, `f1`, `f2`, etc.

Paid flows include credit-card fields:

- `f37` card type
- `f34` card number
- `f36` expiration year
- `f35` expiration month
- `f47` CVV

Because this is a private provider endpoint and includes payment data, the app must not recreate the form locally.

## Selector Behavior

The local selector asks:

- Membership status:
  - never been a Likud member
  - renewal / previous member / code 99
  - already a Likud member joining the liberal group
- Join mode:
  - individual
  - couple

It then opens the matching effective-soft URL:

| Status | Mode | URL |
|--------|------|-----|
| New or renewal | Individual | `https://effective-soft.co.il/XZone/pfo?uid=licudliberal` |
| New or renewal | Couple | `https://effective-soft.co.il/XZone/pfo?uid=licudliberal2` |
| Existing Likud member | Individual | `https://effective-soft.co.il/XZone/pfo?uid=licudliberal3` |
| Existing Likud member | Couple | `https://effective-soft.co.il/XZone/pfo?uid=licudliberal4` |

The selector also shows direct fallback links and WhatsApp support.

## Files

- `src/components/parliament/JoinSelector.tsx`
- `src/components/sections/JoinSection.tsx`
- `src/components/sections/HeroSection.tsx`
- `tests/components/JoinSelector.test.tsx`
- `BACKLOG.md`
- `docs/components.md`
- `docs/data-schema.md`

## Verification

- `npm test`
- `npm run build`
- `npm run lint`

