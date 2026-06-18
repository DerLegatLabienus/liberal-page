# Civic Letters — Usability v2 (Design)

**Date:** 2026-06-18
**Backlog:** §22 (remaining items 22.1, 22.6, 22.2, 22.5; 22.3 + 22.4 already shipped)
**Status:** Approved — proceeding to implementation plan.

## Problem

The Civic Letters system (§19) works but feels heavy. Concretely:

1. The admin composer accepts only **one** "To" recipient (a single email/name pair) even
   though the DB (`toAddresses/ccAddresses/bccAddresses` JSONB arrays) and the mailto/Gmail
   URL builders already support many.
2. Composer pickers (templates, and the contacts picker we're adding) don't reflect items
   created elsewhere in the admin until a full reload.
3. Members can only send to the admin's fixed recipient list — no flexibility to add a
   relevant ministry/MK from the (now seeded, §22.4) address book.
4. The composer's general layout adds friction beyond the specific bugs.

The address book is now seeded (§22.4) and a privacy notice is in place (§22.3), so the
remaining gaps are all in the **UI**, plus one small **member-facing endpoint**.

## Scope

Four items, one workstream, split into **two file-disjoint features** that can be built in
parallel:

- **Feature 1 — Admin composer** (`src/pages/AdminLettersPage.tsx`): 22.1 + 22.6 + 22.5.
- **Feature 2 — Member add-only editing** (`src/pages/LetterDetailPage.tsx` + new member
  contacts endpoint + shared URL module): 22.2.

The only shared artifact is a **new** module (`src/lib/letter-urls.ts`) holding the two pure
URL builders; it is created once and imported by both features (and re-exported by the server),
so it is built first and then both features proceed independently.

**Out of scope:** editing an existing letter's recipients (the composer is create-only today);
pagination of the contacts picker; any schema change.

## Decisions (locked)

- **Recipient editor style:** chips + inline autocomplete (style A). To/Cc/Bcc each a chip box;
  Cc/Bcc collapsed until "add".
- **Member recipient control:** **add-only from the address book.** Admin presets render locked
  (members cannot remove them); members may add extra recipients **only by picking from the
  curated address book** — no free-form typing on the member side. This bounds the abuse surface
  to curated official addresses. (Admins keep free-form entry in the composer.)
- **URL building for member edits:** client-side, from a **shared pure module** — single source
  of truth for the RFC-6068 mailto encoding, no duplication, no per-edit round trip.

---

## Feature 1 — Admin composer

### 22.1 Multi-recipient editor (To/Cc/Bcc)

A reusable `RecipientEditor` component, rendered three times in `NewLetterForm` (To required;
Cc/Bcc collapsed behind an "add Cc/Bcc" affordance):

- Renders current recipients as removable **chips** (`{email, display_name}`).
- A text input below the chips queries `GET /api/admin/letters/contacts?q=` (debounced ~250ms).
- Results are **grouped by category** (ministry / mk / committee / custom); click or Enter on a
  result adds a chip carrying `{email, display_name}` (optionally `contact_id`).
- A syntactically valid free-form email can also be added (admin side only).
- Chips persist into the existing `toAddresses/ccAddresses/bccAddresses` arrays on submit.

**No server change** — the create (`POST /api/admin/letters`) and update routes already accept
all three arrays. `NewLetterForm`'s local `toEmail`/`toName` state is replaced by three address
arrays. Submit validity becomes "≥1 To recipient" instead of "toEmail && toName".

### 22.6 Composer refresh bug

Templates and contacts created in another admin tab don't appear in the composer until reload.
Fix: lift `contacts` + `templates` to a shared fetch with a `reload()`; call it when the New
Letter form **opens**, and after any successful create elsewhere on the page invalidate/refetch
those lists. Same file; low risk.

### 22.5 Composer usability pass (after 22.1 lands)

- Group the form into labeled sections: **Identify** (title, subject, status, priority) →
  **Recipients** (the three editors) → **Content** (template + body + beautify).
- **Live template preview**: reuse the existing `iframe srcDoc` pattern from `TemplateRow`,
  injecting the current body into the selected template's `{{CONTENT}}`.
- Inline validation messages instead of a silently-disabled submit.
- Sticky/clear primary action.

No new dependencies; stays within the single-page form.

---

## Feature 2 — Member add-only editing (22.2)

### Member contacts endpoint

`GET /api/letters/contacts?q=` — `requireAuth`, gated by the existing `lettersEnabled`
middleware on the member router, read-only. Reuses the contacts repository's search. Returns the
same `LetterContact[]` shape (the picker only needs `{id, displayName, email, category}`).

### Detail page editing

On `/letters/:id`:

- Admin presets (`letter.toAddresses/ccAddresses/bccAddresses`) render **locked** — shown as
  non-removable chips.
- Members add extra recipients **only via the address-book picker** (same grouped autocomplete
  UI as the composer, fed by the new member endpoint). No free-form input on the member side.
- The merged recipient set `[presets + additions]` feeds the **client-side** URL builders; the
  "Send from my email" / "Open in Gmail" / "Copy addresses" actions reflect member edits live.
- Send analytics (`POST /api/letters/:id/send`) unchanged.

### Shared URL module

Extract `buildMailtoUrl` and `buildGmailComposeUrl` (currently in
`server/services/letter-utils.ts`) into a new pure module **`src/lib/letter-urls.ts`** that
imports only the `LetterAddress` type (no server deps). `server/services/letter-utils.ts`
re-exports them so the server detail endpoint (`server/routes/letters.ts`) is unchanged. The
client detail page imports them directly to rebuild URLs from the merged recipient list.

---

## Testing

- **RecipientEditor** (component): add via picker, add valid free-form (admin), remove chip,
  reject malformed free-form, To-required validation.
- **Member contacts endpoint**: requires auth; honors `lettersEnabled`; returns expected shape;
  search filters by `q`.
- **Shared URL builder parity**: same inputs produce the identical string on client and server
  (guards against the RFC-6068 encoding drifting).
- **Member detail editing**: presets locked (not removable); picker-only additions; merged set
  appears in the built mailto/Gmail URLs.
- **22.6**: composer refetches contacts/templates when the form opens.

## Verification

`npm run lint` && `npx tsc --noEmit` && `npm test` && `npm run build` (per the build-check
memory, `npm run build` — not just `tsc --noEmit` — before pushing).

## Sequencing / parallelism

1. **Shared step (first):** create `src/lib/letter-urls.ts` + re-export from
   `server/services/letter-utils.ts` (no behavior change; suite stays green).
2. **Then parallel:**
   - Feature 1 (admin composer): 22.1 → 22.6 → 22.5, all in `AdminLettersPage.tsx`.
   - Feature 2 (member editing): member contacts endpoint + `LetterDetailPage.tsx` edits.

The two features touch disjoint files after step 1, so they run as independent dynamic
workflows and merge without conflict.
