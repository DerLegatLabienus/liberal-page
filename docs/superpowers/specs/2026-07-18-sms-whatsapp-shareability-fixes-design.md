# SMS/WhatsApp letters — shareability & sendability fixes

**Date:** 2026-07-18
**Status:** Approved, pending implementation plan
**Follows:** `docs/superpowers/specs/2026-07-15-communications-channels-design.md` (the multi-channel feature these fixes repair)

## Problem

After the multi-channel (Email/SMS/WhatsApp) feature shipped, SMS/WhatsApp letters are effectively
unsendable. Investigation of prod letter 6 ("Testing wa") traced the failure across all three layers
(DB → API → rendered page):

- **The message body is never shown.** SMS/WhatsApp `body_text` is stored, but the detail page and
  the R2 share page only bake it *inside* the per-recipient deep-link URL — so the message is
  invisible to the user. (Letter 6's SMS body `"רשות מטרופוליניות"` and WhatsApp body exist in the
  DB but appear nowhere on screen.)
- **Channels can be saved/published with zero recipients.** Letter 6's SMS and WhatsApp channels
  both have `recipient_ids = []`, so the per-recipient send buttons render nothing. The composer let
  this be published with no guardrail. Root cause of the empty recipients: prod contacts have almost
  no phone data (18 contacts, 1 phone, 0 WhatsApp), so the composer's channel-filtered picker offered
  0 WhatsApp candidates and 1 SMS candidate, and the letter was saved empty. (The composer wiring
  itself is correct — `recipientIds` are captured and sent; this is a data + missing-guardrail
  problem, not a save bug.)
- **There is no way to get a letter's share link.** The R2 public share page
  (`${R2_PUBLIC_BASE_URL}/letter/{id}.html`) is fully built and auto-published on publish, but the
  app surfaces no "copy share link" affordance anywhere (only "Regenerate share pages" and a
  copy-*body* button exist). So users can't distribute the link without hand-constructing the URL.

**Send model (decided):** SMS/WhatsApp is **per-official**, exactly like email — one deep link per
recipient, using that official's phone number. MK phone numbers are not rare and will be entered
manually into contacts. (The alternative "supporter-picks-recipient" recipient-less model was
considered and rejected.)

## Fixes

### Part 1 — Display the SMS/WhatsApp message body

Under each enabled SMS/WhatsApp channel, render the channel's `body_text` as a read-only message
block, with the per-recipient send button(s) beneath it. Two renderers, brought to parity with the
email block (which already shows its body):

- `src/pages/LetterDetailPage.tsx` — the member React page.
- `server/services/share-renderer.ts` — the R2 share-page HTML.

The message block shows for a channel even if it currently has recipients; the send buttons render
per reachable recipient as today (and `unavailableCount`, when > 0, still shows its note).

### Part 2 — "Copy share link" button

The browser cannot build the share URL (it doesn't know the server-only `R2_PUBLIC_BASE_URL`), so the
**server provides it**:

- Add a `shareUrl: string | null` field to each letter in the **admin letters list** response
  (`GET /api/admin/letters`) — the one place the button lands, so no unused field elsewhere. Compute
  it as `${getShareConfig().publicBaseUrl}/letter/${id}.html`, returned **only when**: the letter is
  `published` AND the `publicSharePages` flag is on AND R2 is configured (the existing share-config
  "is R2 configured" check — the plan confirms its exact export name); otherwise `null`. This mirrors
  exactly when a share page actually exists. (A member-page share button is a possible later add;
  it would extend the detail response the same way — out of scope here.)
- Frontend: in the admin letters table (`src/pages/AdminLettersPage.tsx`), show a **"Copy share
  link"** button per row whenever `letter.shareUrl` is non-null; clicking copies it to the clipboard
  (`navigator.clipboard.writeText`) with a transient "✓ Copied" confirmation. Rows without a share
  page (drafts, or when sharing is off) simply don't render the button.

No R2 secret reaches the client; the "does a share page exist" decision stays server-side.

### Part 3 — Guardrail against zero-recipient channels

- **Composer (`AdminLettersPage.tsx`):** when an SMS/WhatsApp channel is enabled and its recipient
  picker has **no reachable candidates**, show an inline Hebrew note ("אין אנשי קשר עם טלפון/וואטסאפ
  — הוסיפו מספרי טלפון לאנשי הקשר") instead of silently allowing an empty channel.
- **Publish block:** block **publishing** (status → `published`) a letter that has an *enabled*
  channel with **zero recipients**. Saving as **draft** stays allowed. The block surfaces a clear
  message naming the offending channel(s). Enforced client-side in the composer (disable/deny the
  publish action) and defensively server-side in the admin create/update route (reject a `published`
  letter whose enabled channel has empty `recipient_ids` → 400 with a descriptive error).

## Data flow

The `shareUrl` field on the admin list response is the only interface change. `ChannelSend` already
carries `bodyText` (Part 1 just renders it). No schema change. No new endpoints.

## Testing

- **Server** — `GET /api/admin/letters` returns `shareUrl` when published + flag on + R2 configured,
  and `null` otherwise (published-but-flag-off, draft, R2 unconfigured);
  the admin create/update route rejects publishing a letter with an enabled zero-recipient channel
  (400) while allowing it as a draft. `share-renderer` output includes the SMS/WhatsApp `body_text`
  as visible content (extend `share-renderer-content.test.ts`).
- **Component** — `LetterDetailPage` renders the SMS/WhatsApp message body block (not just buttons);
  the admin table shows "Copy share link" only when `shareUrl` is present and copies it on click; the
  composer shows the empty-picker note and prevents publish when an enabled channel has 0 recipients.

## Out of scope

- Entering MK/official phone numbers into contacts — manual data entry; the contact editor already
  supports `phone` + `has_whatsapp`. Part 3 makes the missing data obvious.
- The "supporter-picks-recipient" (recipient-less) SMS/WhatsApp model — rejected in favor of
  per-official.
- Exposing `R2_PUBLIC_BASE_URL` to the browser as a frontend env var — the server-provided `shareUrl`
  is used instead.

## Post-deploy

Existing published letters need one **"Regenerate share pages"** click (admin dashboard) so their R2
pages pick up the Part 1 body rendering. (A throwaway test contact — id 19, `+972500000000` — was
wired to letter 6's channels during investigation; remove it once the fix is verified.)
