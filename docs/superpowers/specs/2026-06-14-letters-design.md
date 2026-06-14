# Letters — Civic Letter-Sending System

**Date:** 2026-06-14  
**Status:** Design approved — implementation plan at `docs/superpowers/plans/2026-06-14-letters.md`

---

## Goal

Enable admins to publish curated letters addressed to MKs, ministers, and committees. Authenticated members browse these letters, preview the full content, and send them directly from their own email client with one click. The platform provides the content; the member provides the sender identity.

---

## Access Control

- **Member view** (`/letters` page, `GET /api/letters/*`): `requireAuth` — any authenticated user in the `allowed_emails` table.
- **Admin CRUD** (`/admin/letters` page, `/api/admin/letters/*`): `requireAdmin`.
- **Feature flag:** `lettersEnabled` (default `false`) gates the member-facing section. The admin area is always accessible regardless of the flag.

---

## Data Model

Five new tables, isolated from all existing schema:

### `letter_issue_tags`
Admin-managed tag taxonomy.
```
id            SERIAL PRIMARY KEY
name          TEXT NOT NULL UNIQUE     -- Hebrew label, e.g. "חירות אזרחית"
slug          TEXT NOT NULL UNIQUE     -- URL-safe, e.g. "civil-liberties"
created_at    TIMESTAMP WITH TIME ZONE
```

### `letter_contacts`
Reusable recipient database. Populated from known contacts or saved from free-form entry.
```
id            SERIAL PRIMARY KEY
display_name  TEXT NOT NULL            -- "חיים כץ, יו״ר ועדת הכספים"
email         TEXT NOT NULL UNIQUE
category      TEXT NOT NULL            -- 'mk' | 'minister' | 'committee' | 'custom'
created_at    TIMESTAMP WITH TIME ZONE
```

### `letter_templates`
HTML layout wrappers. Each template must contain a `{{CONTENT}}` placeholder where the letter body is injected.
```
id            SERIAL PRIMARY KEY
name          TEXT NOT NULL UNIQUE     -- "formal" | "advocacy-brief" | "minimal"
html          TEXT NOT NULL            -- full email-client-safe HTML with {{CONTENT}}
updated_at    TIMESTAMP WITH TIME ZONE
```
Template HTML must use tables + inline styles (no external CSS, no web fonts) — tested against Gmail and Outlook web/desktop.

### `letters`
```
id              SERIAL PRIMARY KEY
title           TEXT NOT NULL          -- admin-facing label (not shown to recipients)
subject         TEXT NOT NULL          -- email subject line
body_html       TEXT NOT NULL          -- letter content HTML (injected into template)
body_plain      TEXT NOT NULL          -- HTML-stripped plain text (used in mailto: body)
template_id     INT REFERENCES letter_templates(id) ON DELETE SET NULL
to_addresses    JSONB NOT NULL         -- [{email, display_name, contact_id?}]
cc_addresses    JSONB NOT NULL DEFAULT '[]'
bcc_addresses   JSONB NOT NULL DEFAULT '[]'
issue_tag_ids   INT[] NOT NULL DEFAULT '{}'  -- max 10 tag IDs
status          TEXT NOT NULL DEFAULT 'draft'    -- 'draft' | 'published'
priority        TEXT NOT NULL DEFAULT 'normal'   -- 'normal' | 'high' | 'urgent'
pinned_at       TIMESTAMP WITH TIME ZONE         -- null = not pinned
pin_notified_at TIMESTAMP WITH TIME ZONE         -- null = notification not yet sent
activity_score  INT NOT NULL DEFAULT 0           -- bumped on each member send event
published_at    TIMESTAMP WITH TIME ZONE
created_by      INT REFERENCES users(id) ON DELETE SET NULL
created_at      TIMESTAMP WITH TIME ZONE
updated_at      TIMESTAMP WITH TIME ZONE
```

**Relevance score** is computed at query time (not stored):  
`priority_weight × 1000 + activity_score`, where `urgent=3, high=2, normal=1`.  
Pinned letters always sort to the top regardless of score.

### `letter_analytics`
Aggregated send counts per letter. No user identity stored.
```
letter_id       INT NOT NULL REFERENCES letters(id) ON DELETE CASCADE
bucket          TEXT NOT NULL          -- 'YYYY-MM-DD' or 'lifetime'
total           INT NOT NULL DEFAULT 0
breakdown       JSONB NOT NULL DEFAULT '{}'   -- {"mailto": N, "copy": N}
created_at      TIMESTAMP WITH TIME ZONE
PRIMARY KEY (letter_id, bucket)
```
Same bucket pattern as `join_analytics` (daily rows + `lifetime` row; daily rows pruned after 1 year).

---

## Admin Area — `/admin/letters`

Separate admin SPA route (not inside the existing `AdminPanel` modal). Four tabs:

### Letters tab
- List view: title, status badge (`draft` / `published`), priority, pinned indicator, send count, published date.
- Drafts visible to all admins (not per-admin private).
- **Pin toggle** on list row — sets/clears `pinned_at`. Triggers notification flow (see below).
- New / Edit letter form fields:
  - Title (internal label)
  - Subject
  - Body HTML (rich textarea)
  - Template picker (dropdown of `letter_templates`)
  - To / CC / BCC — contact autocomplete (typeahead against `letter_contacts`) + free-form entry; new addresses can be saved to the contact database on submit
  - Issue tags (multi-select from taxonomy, max 10)
  - Priority (normal / high / urgent)
  - Save as draft / Publish buttons

### Issue Tags tab
List + add/rename/delete. Deleting a tag removes it from all letters' `issue_tag_ids` arrays.

### Contacts tab
Searchable table (display name, email, category). Add / edit rows. Category: `mk | minister | committee | custom`.

### Letter Templates tab
HTML editor per template with live preview (same `<iframe srcDoc>` pattern as the existing email template editor). Template HTML requires `{{CONTENT}}` — save is blocked if the placeholder is missing.

---

## Member Area — `/letters`

Dedicated page, visible only when `lettersEnabled` flag is on and user is authenticated.

### Letter list
- **Sidebar filters:** issue tag multi-select (OR semantics — letter must have at least one selected tag). Sort: relevance (default) or newest.
- **Sort logic:** pinned letters always first; within pinned/unpinned, sorted by computed relevance score descending, then `published_at` descending as tiebreaker.
- **Letter card:** title, recipient preview (first To address display name), issue tag chips, priority badge, send count ("47 שליחות"), Open button.

### Letter detail — `/letters/:id`
Two-column layout (RTL):

**Left panel — send panel:**
- To / CC / Subject fields displayed (read-only, pre-filled values)
- Primary button: **"✉️ שלח ממייל שלי"** — opens `mailto:` link with To, CC, BCC, Subject, and `body_plain` pre-filled. Clicking fires a `POST /api/letters/:id/send {action: "mailto"}` analytics event (fire-and-forget).
- Secondary buttons: **"📋 העתק גוף"** (copies `body_html` rendered inside the chosen template — the full HTML for pasting into Gmail/Outlook) and **"📋 העתק כתובות"** (copies To addresses as a comma-separated string). Each fires `POST /api/letters/:id/send {action: "copy"}`.
- Hint text: "שלח ממייל שלי פותח את תוכנת המייל שלך עם הפרטים ממולאים מראש"

**Right panel — preview:**
- Renders `body_html` injected into the chosen `letter_template.html` via `{{CONTENT}}` substitution.
- Shown in an `<iframe srcDoc>` (same sandbox pattern as email template preview).
- "Open in new tab" link for full-screen preview.

---

## Analytics

`POST /api/letters/:id/send` (requireAuth, fire-and-forget):
- Body: `{action: 'mailto' | 'copy'}`
- Bumps `letter_analytics` (daily bucket + `lifetime`) using the same upsert pattern as `JoinAnalyticsRepository`.
- Also increments `letters.activity_score` by 1.
- No user identity, IP, or session data stored.

Admin view in the Letters tab: per-letter total sends, mailto vs. copy breakdown, last-14-days sparkline.

---

## Pinned Letter Notifications

When an admin pins a letter (`pinned_at` set, `pin_notified_at` null), the poller's next cycle handles notification:

1. **Bill digest users** (members receiving a digest this cycle because they have new tracked bill data): the digest template gains a "📌 מכתבים דחופים" section prepended above bill updates, listing all unnotified pinned letters with title + link.
2. **Non-digest members** (no new bill data this cycle): receive a standalone `letter_pin` email — a new template in `email_templates` — listing the same pinned letters.
3. After both passes complete: set `pin_notified_at = now()` on each notified letter.

This ensures every member receives the notification in their next email from the platform — bundled or standalone, never duplicated, never skipped.

A new `letter_pin` email template is seeded in `email_templates` (editable in AdminPanel like other system templates).

---

## Email Client Compatibility

Letter templates (`letter_templates.html`) must follow email-client-safe HTML conventions:
- Layout via `<table>` elements, not CSS flexbox/grid
- All styles inline (`style=""` attributes)
- No external stylesheets, web fonts, or JavaScript
- Images use absolute URLs with explicit `width`/`height`
- Tested in: Gmail web, Gmail mobile, Outlook web, Outlook 2019+ desktop

The `body_plain` field (used for `mailto:` body) is generated server-side by stripping HTML tags from `body_html` at save time (both create and update). `mailto:` URL-encodes the body; clients handle line breaks via `%0A`.

---

## API Routes

| Method | Path | Guard | Purpose |
|---|---|---|---|
| `GET` | `/api/letters` | `requireAuth` | List published letters. Query: `?tags=1,2&sort=relevance&page=1` |
| `GET` | `/api/letters/:id` | `requireAuth` | Letter detail + rendered HTML (template applied) |
| `POST` | `/api/letters/:id/send` | `requireAuth` | Record send event. Body: `{action}` |
| `GET` | `/api/letters/tags` | `requireAuth` | All issue tags (for filter UI) |
| `GET` | `/api/admin/letters` | `requireAdmin` | All letters (draft + published) |
| `POST` | `/api/admin/letters` | `requireAdmin` | Create letter |
| `PUT` | `/api/admin/letters/:id` | `requireAdmin` | Update letter |
| `DELETE` | `/api/admin/letters/:id` | `requireAdmin` | Delete letter |
| `PATCH` | `/api/admin/letters/:id/pin` | `requireAdmin` | Toggle pin |
| `GET` | `/api/admin/letters/tags` | `requireAdmin` | List issue tags |
| `POST` | `/api/admin/letters/tags` | `requireAdmin` | Create tag |
| `PUT` | `/api/admin/letters/tags/:id` | `requireAdmin` | Update tag |
| `DELETE` | `/api/admin/letters/tags/:id` | `requireAdmin` | Delete tag |
| `GET` | `/api/admin/letters/contacts` | `requireAdmin` | List/search contacts. Query: `?q=` |
| `POST` | `/api/admin/letters/contacts` | `requireAdmin` | Create contact |
| `PUT` | `/api/admin/letters/contacts/:id` | `requireAdmin` | Update contact |
| `DELETE` | `/api/admin/letters/contacts/:id` | `requireAdmin` | Delete contact (safe — addresses stored inline in letters JSONB) |
| `GET` | `/api/admin/letters/templates` | `requireAdmin` | List letter templates |
| `POST` | `/api/admin/letters/templates` | `requireAdmin` | Create template |
| `PUT` | `/api/admin/letters/templates/:id` | `requireAdmin` | Update template |
| `DELETE` | `/api/admin/letters/templates/:id` | `requireAdmin` | Delete template (sets `template_id = null` on affected letters via ON DELETE SET NULL) |

---

## Future Items (out of scope for this spec)

**Alliance Guilds & Granular User Access** — currently all `allowed_emails` users are treated as a single homogeneous cell. Future work: differentiate between core cell members and allied organizations/guilds, with per-user or per-guild access scopes for letters and other features. Quick-block mechanism: an admin can suspend a previously-authorized user without removing them from the allowlist (revoking their active tokens immediately without requiring email deletion). See BACKLOG for tracking.
