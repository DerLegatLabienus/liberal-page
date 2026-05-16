# MkCard Testing Design

**Date:** 2026-05-16
**Status:** Approved

---

## Problem

`MkCard` has zero test coverage despite being the primary UI surface for real Knesset data. It has multiple conditional rendering paths (photo, party, activity, votes, votingSummary, remove button) and an RTL layout that are easy to regress.

---

## Fixture strategy

Use `mks.json` directly — it was populated by the `knesset-scraper` service from the Knesset OData API for site IDs 1116 (Dan Ilouz, Likud) and 1117 (Moshe Rot, יהדות התורה). Committed, deterministic, traceable to live API. No fetch-at-test-time needed.

---

## Test cases: `tests/components/MkCard.test.tsx`

### Real data — 1116 (Dan Ilouz)
1. Renders name `דן אילוז`
2. Renders party `הליכוד`
3. Shows photo `<img>` with Knesset photo URL
4. Shows exactly 4 activity items (has 20, capped at 4)
5. Shows `📋` icon for `bill_initiated` activity type
6. `צפה במקור ↗` links to correct `sourceUrl`
7. `onRemove` called with `id: 1` on remove button click

### Real data — 1117 (Moshe Rot)
8. Renders name `משה רוט`
9. Renders party `יהדות התורה`
10. Shows `❓` icon for `question` activity type

### Edge cases
11. Empty name → shows fallback `ח"כ לא מוגדר`
12. `photoUrl: null` → no `<img>` rendered
13. Empty `party` → party line not rendered
14. No activity and no votes → activity section not in DOM
15. No `onRemove` prop → remove button not in DOM
16. `votingSummary` set → summary text appears in DOM

---

## Files

| File | Action |
|------|--------|
| `tests/components/MkCard.test.tsx` | Create — 16 test cases |

---

## Out of scope

- Snapshot tests (brittle for Hebrew/RTL)
- Network requests (knesset-scraper already tested separately)
- Photo load success (jsdom doesn't load images)
