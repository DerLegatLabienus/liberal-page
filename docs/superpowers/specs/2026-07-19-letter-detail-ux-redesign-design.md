# Letter detail page — UX redesign

**Date:** 2026-07-19
**Status:** Approved, pending implementation plan
**Scope:** Presentation only. No API, data-model, or analytics changes.

## Problem

`/letters/:id` grew channel-by-channel and now reads as three different screens stitched together:

- **The channels look nothing alike.** The `[350px | 1fr]` grid puts email's rendered letter in the *right* pane while SMS/WhatsApp show their message as a small text block in the *left* panel. Worse, the right pane only renders when an email channel exists — so an SMS/WhatsApp-only letter (e.g. letter 6) leaves half the screen empty.
- **Too many buttons for email.** Three stacked full-width buttons (`שלח ממייל שלי`, `פתח ב-Gmail`, `העתק גוף`) plus a three-line paragraph explaining them.
- **The share control is cramped** — a tiny text link wedged beside the `<h1>`.

Root cause is the lopsided two-column split; the fixes follow from replacing it.

## Design

### Layout — one column

Replace the two-column grid with a single centered column (~`max-w-3xl`), one card, in this order:

```
← חזרה למכתבים
┌────────────────────────────────────────┐
│ Title                        [⇗ שיתוף] │  header: title + share (ghost button)
├────────────────────────────────────────┤
│  ● מייל   ● SMS   ● וואטסאפ            │  tabs (enabled channels only)
├────────────────────────────────────────┤
│   ┌──────────────────────────────┐     │  MESSAGE PANE (same frame, all channels)
│   │ letter sheet  /  chat bubble │     │
│   └──────────────────────────────┘     │
├────────────────────────────────────────┤
│  [ שליחה במייל ▾ ]      ⚠ warning-only │  ONE control
└────────────────────────────────────────┘
   privacy notice
```

### Message pane — the signature element

One framed surface that **morphs** by channel, so switching tabs reads as one object changing form rather than three screens:

- **email** → the rendered letter as today: `<iframe srcDoc={buildLetterPreviewDoc(channel.renderedHtml)} sandbox="allow-same-origin">`, styled as a letter sheet.
- **sms / whatsapp** → `channel.bodyText` in a chat bubble (`whitespace-pre-wrap`, asymmetric corner radius). WhatsApp's bubble carries a subtle green-tinted border; SMS stays neutral. Channel color appears **only** here and as a small dot on the tab — never as a full-color button.

### One control per channel

A split button in the same position for every channel:

- **email** — primary `שליחה במייל` opens `channel.mailtoUrl`; the caret menu holds **`פתיחה ב-Gmail`** (`channel.gmailUrl`) and **`העתקת הטקסט`** (existing rich-HTML copy). Copy keeps its transient confirmation: the menu item's label swaps to `✓ הועתק` for ~2s before the menu closes, replacing today's button-label swap. The deleted explanatory paragraph's content survives as a one-line hint *inside* the menu ("אם תוכנת המייל לא נפתחת במחשב — השתמשו ב-Gmail"), where it's relevant rather than pre-emptive.
- **sms / whatsapp** — primary `שליחה` opens a recipient menu (avatar/initials + name); choosing one opens that recipient's `sms:`/`wa.me` link. There is no sensible default recipient, so the primary click opens the menu rather than sending.

### Share

The existing `CopyShareLink` component, restyled as a **ghost button with a link icon** in the header row (it already has a `className` prop and i18n keys `letters.copy_share_link` / `letters.copied`). Rendered only when `letter.shareUrl` is non-null, as today.

### Removed

Recipient counts (both the `N נמענים` line and per-tab badges), the three-line button-explanation paragraph, and the two secondary email buttons as *visible* controls. **Kept:** the `unavailableCount` warning, but only when `> 0` — that's a real signal that a letter won't fully send, not chrome.

## Component structure

`LetterDetailPage.tsx` is already doing too much; the redesign is a good moment to split it. New files under `src/components/letters/`:

- **`ChannelTabs.tsx`** — the tab bar. `role="tablist"` with roving tabindex and RTL-aware arrow keys (mirror the existing pattern in `src/components/sections/HomePanels.tsx`, where RTL Left = forward). Hidden entirely when only one channel is enabled — a lone tab is chrome.
- **`ChannelMessage.tsx`** — the morphing pane (iframe sheet vs. bubble).
- **`ChannelSendButton.tsx`** — the split button + menu, driven by a `ChannelSend`. Owns menu open/close, outside-click and `Escape` dismissal, `aria-haspopup="menu"` / `aria-expanded`, `role="menuitem"` items, and returning focus to the trigger on close.

`LetterDetailPage.tsx` keeps data fetching, the selected-channel state, and the handlers.

**Default channel:** email when present and enabled, otherwise the first enabled channel.

## Unchanged (explicitly)

- The detail API response (`{ letter, channels }`), `buildChannelSends`, the share-URL gate, and `buildLetterPreviewDoc`.
- **Analytics fire exactly as today:** `api.letters.recordSend(id, 'mailto')` for both the mailto and Gmail actions, `recordSend(id, 'copy')` for copy, and `api.letters.publicSend(id, kind, contactId)` per SMS/WhatsApp recipient.
- The public R2 share page (`share-renderer.ts`) — a separate surface, out of scope here.

## Testing

Extend `tests/components/LetterDetailPage.test.tsx`, plus focused tests for the new components:

- Tabs render one per enabled channel; the tab bar is absent when only one channel is enabled; the default selection is email when present, else the first channel.
- Switching tabs swaps the message pane content (email iframe ↔ SMS bubble text).
- Exactly **one** send button renders per channel (assert the old `פתח ב-Gmail` / `העתק גוף` are no longer visible buttons).
- Email: primary click opens `mailtoUrl` and records `recordSend(id,'mailto')`; the menu exposes Gmail and copy, and copy records `recordSend(id,'copy')`.
- SMS/WhatsApp: primary click opens the menu; choosing a recipient opens their URL and calls `publicSend(id, kind, contactId)`.
- The `unavailableCount` warning appears only when `> 0`.
- The share button renders only when `shareUrl` is non-null.
- Menu a11y: `Escape` closes and restores focus; outside click closes.

## Out of scope

- i18n of the surrounding letters copy (still hardcoded Hebrew by earlier decision — only the share button is translated).
- The letters list page and the admin letters UI.
- Any change to how channels are stored, resolved, or counted.
