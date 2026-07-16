# Multi-channel communications (SMS + WhatsApp) — Design

**Date:** 2026-07-15
**Status:** Approved, pending implementation plan

## Summary

Extend the existing "letters" system so a single campaign can be pushed out over
**email, SMS, and WhatsApp**. Each channel carries its own content written for its
medium (a Hebrew SMS is not a rich HTML email), targets its own recipients, and
respects that medium's limits in the editor. Contacts gain phone numbers and photos.

### Naming note (read this first)

The domain is really "communications," but we **keep the `letters` name everywhere**
— tables, routes, types, flags, admin UI — because the letters system has a live
public surface (R2 share pages at `letter/{id}.html`, `/letters/:id`,
`/api/public/letters/:id/send`) and renaming it would break saved links for no user
benefit. Throughout this codebase, **"letter" is the legacy word for a communication**
that may target one or more channels. A future reader seeing `letters.channels` should
understand: the row is a campaign; the channels are how it goes out.

## Motivation & core principle

The letters system is a **compose-assist** tool, not a backend sender. It never sends
email itself — it builds pre-filled `mailto:`/Gmail-compose URLs (plus a rich-HTML copy
button) and the supporter's own mail client does the sending. Analytics count those
click-throughs.

**We keep that model, deliberately, for all channels.** The entire value is that each
supporter contacts an official *from their own email/phone as a real constituent*. A
mass-blast from one central backend identity is a fundamentally different (and weaker)
civic act — a thousand citizens writing their MK vs. one org spamming them. So SMS and
WhatsApp use **deep links** (`sms:` and `wa.me`) that open the supporter's own app
pre-filled — never a server-side sender. This also sidesteps SMS/WhatsApp provider
accounts, message-template approval, opt-in/consent law, and delivery webhooks entirely.

**Consequence — images:** deep links carry text + phone only; there is no media
parameter. Email bodies keep their images (existing `letter_media_assets` + R2). SMS and
WhatsApp channels are **text-only**. "Contacts contain images" is handled separately —
recipients get a photo (see below) — which is what "contents should contain images" in
the original request actually meant.

## Data model

### `letters` — the campaign (shared fields only)

Loses its content columns (`subject`, `body_html`, `body_plain`, `template_id`,
`to_addresses`, `cc_addresses`, `bcc_addresses`) — those move to per-channel rows. Keeps:
`id`, `title`, `issue_tag_ids`, `status`, `priority`, `pinned_at`, `pin_notified_at`,
`activity_score`, `published_at`, `created_by`, `created_at`, `updated_at`.

### `letter_channels` — one row per medium (NEW)

`UNIQUE(letter_id, kind)`. Each row is a single medium, so the email-only columns form a
discriminated union rather than a wide sparse "all media in one row" table.

| column | type | notes |
|---|---|---|
| `id` | serial pk | |
| `letter_id` | int FK → letters, cascade | |
| `kind` | text | `email` \| `sms` \| `whatsapp` |
| `enabled` | bool, default true | *we chose to use this channel here* (distinct from availability) |
| `recipient_ids` | int[] | contact ids — the "To" for every channel |
| `cc_ids` | int[] | email-only; empty otherwise |
| `bcc_ids` | int[] | email-only; empty otherwise |
| `body_text` | text NOT NULL | the SMS/WhatsApp message; email's plain-text alternative |
| `subject` | text, nullable | email-only |
| `body_html` | text, nullable | email-only |
| `template_id` | int FK → letter_templates, nullable | email-only |
| `created_at`, `updated_at` | timestamptz | |

`CHECK (kind <> 'email' OR (subject IS NOT NULL AND body_html IS NOT NULL))` keeps email
rows honest.

**Recipients are `contact_id[]`, resolved live — no denormalized snapshot.** At render/
send time each contact is looked up and the endpoint the channel needs is read: email →
`contact.email` + `display_name`; SMS/WhatsApp → `contact.phone`. This is a deliberate
domain choice: recipients are **public officials**, not per-letter personalized
addresses. An MK's office phone/email is a canonical fact — fix it once in the contact
and every letter (draft *or published*) picks up the change. Snapshots would be right for
a CRM mail-merge; they are wrong for a shared directory of officials.

### `letter_contacts` — the recipient directory (WIDENED)

| change | notes |
|---|---|
| `email` | drops `NOT NULL` (still `UNIQUE` — Postgres allows many NULLs under a unique index) |
| `phone` | NEW, text, nullable, **stored as E.164** (`+9725XXXXXXXX`) |
| `has_whatsapp` | NEW, bool, default false — a number that is SMS-only |
| `photo_url` | NEW, text, nullable |
| `mk_site_id` | NEW, int, nullable — links to a cached MK; derives name + photo |
| — | `CHECK (email IS NOT NULL OR phone IS NOT NULL)` |

**Contact photos (Q5 = D):** MK-linked contacts derive their photo from the cached MK
record (Knesset-hosted URL — hotlinked, consistent with how the parliament tracker
already shows MK photos). Minister/custom contacts can have a photo uploaded to R2 via
the existing hardened `letter_media_assets` pipeline (byte-sniffed raster-only, 5 MB cap),
or fall back to initials.

### `letter_analytics` — UNCHANGED

Already keyed `(letter_id, bucket)`. SMS/WhatsApp are just new bucket values —
`public_sms`, `public_whatsapp` — alongside `public_mailto`/`public_gmail`/`public_copy`.
Per-letter rollup and per-channel breakdown both fall out for free. Because SMS/WhatsApp
sends are per-recipient, the `breakdown` jsonb can hold `contact_id` counts to show which
officials get contacted most.

### Availability vs. enabled (kept separate)

- **`enabled`** — a stored choice on the channel row.
- **availability** — *derived at render time*, never stored: a recipient is reachable on
  a channel ⟺ their contact has that endpoint. Precisely: **email** ⟺ `email` present;
  **SMS** ⟺ `phone` present; **WhatsApp** ⟺ `phone` present **and** `has_whatsapp = true`
  (a number may be SMS-only). Drives the admin warning ("2 of 6 recipients have no phone —
  they'll be skipped on SMS"). Conflating availability with `enabled` would bite later, so
  they stay distinct.

## Channel limits, editors, and send links

### Deep-link builders (pure, in `src/lib/letter-urls.ts`)

Live beside the existing `buildMailtoUrl`/`buildGmailComposeUrl` so server (detail
endpoint) and client (member edits) build identical links from one source.

- **`buildWhatsappUrl(phone, text)`** → `https://wa.me/<intl-phone>?text=<enc>` — phone
  digits only, no `+`/spaces.
- **`buildSmsUrl(phone, text)`** → `sms:<phone>?&body=<enc>`. The `?&` is deliberate: iOS
  historically wants `&body=`, Android `?body=`; `?&body=` works on both. Gets a comment
  and a unit test (real cross-platform gotcha).

### Per-channel limits — enforced live in the editor

| channel | counter | limit behavior |
|---|---|---|
| **SMS** | chars, **segments**, detected encoding | Hebrew forces **UCS-2 → 70 chars/segment** (67 multipart) vs GSM-7's 160/153. Amber past 1 segment; **hard cap ~3 segments (~200 Hebrew chars)** to keep the `sms:` URL sane. |
| **WhatsApp** | char count | soft-warn ~1000; **hard cap ~2000** to keep the `wa.me` URL under browser limits. Supports WhatsApp `*bold* _italic_ ~strike~` markdown. |
| **Email** | — | unchanged: CodeMirror HTML editor + preview + Beautify + media library + images; no length limit. |

SMS segment math lives in **one pure `src/lib/sms-segments.ts`** helper (Hebrew ⇒ UCS-2
70/67, GSM-7 160/153, extended chars count double) shared by the editor counter and
server-side validation. Hard caps are **config/feature-flag values**, not magic numbers,
so they can be tuned without a deploy.

### The composer becomes channel-tabbed

`NewLetterForm` (which already handles create *and* edit) grows a tab per targeted
channel. Shared header: title, issue tags, priority, status. Each tab: an enable toggle
(`enabled`), its own editor (email = today's rich editor untouched; SMS/WhatsApp = RTL
textarea + live counter), its own recipient picker, and an availability line.

### Send surfaces — the one-recipient-vs-all reality

Email sends **one** `mailto:`/Gmail link covering all To/Cc/Bcc. But `wa.me` and `sms:`
links are **inherently one-recipient-each** — there is no "all recipients" WhatsApp link.
So on the member `LetterDetailPage` and the public R2 share page, SMS and WhatsApp render
as a **list of per-recipient send buttons** ("Send to דן אילוז", "Send to מיכל שיר", …),
each with the recipient's photo, each firing its own analytics event. Email stays a
single button. This is the concrete meaning of "each channel respects its media limits."

## API

Routes keep the `letters` name.

| method | path | change |
|---|---|---|
| `POST/PUT` | `/api/admin/letters` | accept `channels: [{ kind, enabled, recipientIds, ccIds?, bccIds?, subject?, bodyHtml?, bodyText, templateId? }]` instead of flat content fields |
| `POST/PUT` | `/api/admin/letters/contacts` | accept `phone`, `hasWhatsapp`, `photoUrl`, `mkSiteId`; enforce email-or-phone; normalize phone to E.164 |
| `DELETE` | `/api/admin/letters/contacts/:id` | **409 if the contact is referenced** by any letter channel (deletion guard) |
| `GET` | `/api/letters/contacts` | returns widened fields; optional `?channel=sms\|whatsapp\|email` filter → only reachable contacts |
| `GET` | letter detail (member + public) | resolve each channel's `contactIds` live; build one email link + per-recipient SMS/WhatsApp link lists with photos |
| `POST` | `/api/public/letters/:id/send` | gains `channel` + optional `contactId`; writes `public_sms`/`public_whatsapp` with `contactId` in the breakdown |

### Ad-hoc recipients

A recipient must be a contact. Typing a brand-new address/number in the picker
**creates a `letter_contact`** (`category: 'custom'`) and references it — one resolution
path, and every official written to lands in the directory (where they belong). No
raw-value escape hatch (it would reintroduce the two-path complexity we removed).

## Frontend components

- **`NewLetterForm`** → channel-tabbed composer (above).
- **Contact editor** (in `AdminLettersPage`) → gains phone, WhatsApp toggle, photo
  (R2 upload or MK-link that derives it), MK link.
- **`LetterDetailPage`** (member) + **public share page generator** (`share-publisher`)
  → render enabled channels; email = one button, SMS/WhatsApp = per-recipient buttons
  with faces.

## Migration (expand → backfill → contract)

Prod migrations auto-apply on boot, but the backfill has find-or-create logic, so it runs
as a manual step between deploys — same discipline as the existing "seed before serving"
note.

1. **Expand (schema migration):** create `letter_channels`; widen `letter_contacts`;
   keep the old `letters` content columns for now.
2. **Backfill (`npm run` one-off, idempotent, like `db:seed`):** for every existing
   letter, find-or-create a `letter_contact` per existing To/Cc/Bcc address (by email),
   then insert one `email` channel row with the resolved id arrays + the existing
   subject/body/template. Re-running is a no-op.
3. **Contract (schema migration):** drop the old content columns from `letters`.

Because the project is early-stage with few letters, steps 1–3 can ship close together;
the script keeps it safe regardless.

## Edge cases

- **Enabled channel, zero reachable recipients** (e.g. SMS on but no recipient has a
  phone) → block publish with a clear message; drafts may save.
- **Phone normalization** → store E.164 (Israeli `05X-XXX-XXXX` → `+9725XXXXXXXX`) via one
  `normalizePhone` helper; contact editor validates and rejects unparseable numbers.
  `wa.me` strips the `+`; `sms:` keeps it.
- **Over-limit content** → editor hard caps re-validated server-side on save, so a crafted
  request can't store a body that overflows the deep-link URL.
- **Mixed availability** → a contact with no phone on the SMS channel is silently skipped
  at render and surfaced in the availability line; never a broken `sms:` link.
- **Contact deletion while referenced** → 409.

## Testing

- **Unit** — `sms-segments.ts` (Hebrew→UCS-2 70/67, GSM-7 160/153, extended chars double,
  multipart boundaries); `letter-urls` new builders (`wa.me` phone stripping, `sms:?&body=`
  cross-platform form); `normalizePhone` (Israeli local → E.164); availability derivation.
- **Server** — channels repo CRUD; the backfill script (existing letter → one email
  channel with find-or-created contacts, idempotent); contact widening constraints
  (email-or-phone, unique-email-with-nulls); deletion guard (409); public send writes
  `public_sms`/`public_whatsapp` + `contactId` breakdown; over-limit rejection.
- **Component** — tabbed composer renders a tab per enabled channel; SMS counter is
  Hebrew-aware and blocks past cap; per-recipient send list on detail/share surfaces;
  availability warning shows.

## Explicitly out of scope

- Any server-side/API sender for SMS or WhatsApp (Twilio, Meta WhatsApp Business API).
- Images attached to SMS/WhatsApp messages (deep links cannot carry media).
- Opt-in/consent tracking, delivery receipts, message-template approval.
- Renaming the `letters` domain to `communications`.
