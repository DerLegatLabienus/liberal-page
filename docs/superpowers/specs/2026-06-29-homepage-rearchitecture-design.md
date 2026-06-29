# Homepage Re-architecture — Design

**Date:** 2026-06-29
**Status:** Shipped, then revised — see "Revision (v2)" at the end.

## Goal

Make the homepage more user-friendly, compact, and brief by re-architecting it
around a clear visitor funnel rather than a flat stack of equal-weight sections.

**Visitor priority (drives ordering):** identity → join → tracker.
*Learn who we are → trust → convert → engage with the tool.*

## Problem (current state)

`src/pages/HomePage.tsx` stacks 9 full-bleed sections in Hebrew (7 in English),
almost all `py-16`, with no weighting:

1. Hero (`py-24`, 3 CTAs) · 2. About · 3. LiberalsShowcase · 4. ParliamentStrip
· 5. KnessetBillsOverview · 6. Gallery · 7. FAQ · 8. MeetUs · 9. Join

Issues:
- **Repeated CTAs.** "Join" appears 3× (hero, anchor, own section); "Tracker" 3×
  (hero, header, strip). Same two asks, over and over.
- **Two adjacent parliament sections** create a back-to-back seam mid-page. They
  are *not* redundant — the strip shows the *group's tracked* bills/committees
  (teaser into the drawer); the overview browses *all* Knesset bills
  (recent/trending/policy). But visually they read as one long parliament zone.
- **Uniform `py-16` rhythm** — nothing reads as more important; cumulative
  padding alone is a long scroll.
- **Two page shapes.** The parliament sections (`ParliamentStrip`,
  `KnessetBillsOverview`) render **only when `isHebrew`** (`HomePage.tsx:62`).
  English has no parliament at all and must terminate cleanly at Join.

## Design (Approach A — strict funnel)

### Section order

**Hebrew (9 → 6):**
1. **Hero** — headline + tagline + 1 primary CTA (Join) + 1 secondary text-link (Constitution)
2. **Who we are** (merged identity block — see below)
3. **Gallery** — tightened activity/proof band
4. **FAQ** — objection-handling before the ask
5. **Join** — conversion
6. **Knesset tracker** — tracked strip (teaser row) + bills overview tabs, one block

**English (7 → 5):** Hero → Who we are → Gallery → FAQ → Join.
No parliament block; the funnel ends at Join with no dangling references to bills.

### The merged "Who we are" section

One `<section id="about">` with four internal sub-blocks under light sub-headings,
replacing three separately-padded full sections (About, LiberalsShowcase, MeetUs):

- **מי אנחנו** — About copy, trimmed 3 → 2 paragraphs
- **מה אנחנו מקדמים** — the 6 value pills + a prominent Constitution link
  (absorbs the Constitution CTA demoted out of the hero)
- **חברי הכנסת שלנו** — the liberal/supporter MK cards (today's `LiberalsShowcase`)
- **פגשו אותנו** — the Meet Us Google-login → Calendly flow

**Graceful degradation** — each sub-block already self-hides when its data is
absent, and must continue to:
- no annotated MKs → MK sub-block gone (`LiberalsShowcase` returns null today)
- `meetUs` flag off, or a signed-in member → Meet-us sub-block gone (today's guard)
The section heading and remaining sub-blocks must still read coherently when any
sub-block drops out.

### Parliament consolidation (Hebrew only)

One `<section>`: the tracked **strip** as a teaser row at top
("what the group is watching"), the bills **overview tabs** below
("browse the Knesset"). Consolidates two *purposes* into one block; no content or
data-fetching logic changes.

## Component changes

- **New** `WhoWeAreSection` wrapper: owns the single `<section>` + heading rhythm,
  composes the four sub-blocks.
- **Refactor** `AboutSection`, `LiberalsShowcase`, `MeetUsSection` from standalone
  `<section className="...py-16">` components into **content blocks** — remove their
  outer section/padding shell; internal logic and data hooks unchanged.
- **New** wrapper for the consolidated Knesset block composing `ParliamentStrip` +
  `KnessetBillsOverview` (Hebrew-only, as today).
- `HeroSection`: drop the Tracker CTA; Join = primary, Constitution = secondary
  text-link; `py-24` → `py-16`.
- `HomePage.tsx`: new composition order above; the `isHebrew` guard now wraps only
  the consolidated Knesset block.
- Locale files: add ~4 sub-heading keys for the merged section (he + en). No other
  copy changes except trimming About to 2 paragraphs.

## Measurable compaction (acceptance criteria)

| Lever | Before | After |
|---|---|---|
| Visible sections (He / En) | 9 / 7 | 6 / 5 |
| Hero padding | `py-24` | `py-16` |
| Section padding | `py-16` | `py-12` |
| Hero CTAs | 3 | 1 primary + 1 secondary |
| About paragraphs | 3 | 2 |
| Repeated "Join" CTAs | 3 | 2 (hero + section) |
| Repeated "Tracker" CTAs | 3 | 2 (header + strip) |

## Out of scope

- Visual redesign of cards, colors, or typography beyond padding/CTA changes.
- Changes to parliament data fetching, the drawer, or any API.
- Reworking Gallery internals (lightbox, etc.) — only its outer padding tightens.
- English parliament support (remains absent by design).

## Testing

- Component tests for `WhoWeAreSection`: renders all four sub-blocks when data
  present; hides MK block with no annotated MKs; hides Meet-us when flag off or
  user signed in; heading still renders.
- `HomePage` renders the 6-section Hebrew order and 5-section English order
  (English omits the Knesset block).
- Existing AboutSection / LiberalsShowcase / MeetUsSection / parliament tests keep
  passing after the section-shell refactor (logic unchanged).
- `npm run build` clean; `npm test` green.

## Revision (v2) — 2026-06-29

After shipping v1, the identity block was reshaped per user request:

- **Who we are · Our MKs · FAQ · Meet us** now live in **one horizontally-snapping
  carousel** (`HomePanels`, owns `id="about"`) — full-width snap panels with
  prev/next arrows (desktop) and clickable dots. Conditional panels (MKs, Meet us)
  are included only when their data is present, so the dots track visible panels.
- **Order:** Hero → HomePanels → Join → Knesset (He only) → **Gallery (last)**.
  FAQ and Gallery are no longer their own funnel steps; FAQ folded into the carousel,
  Gallery moved to the very end.
- `WhoWeAreSection` (the v1 stacked merge) was removed and replaced by `HomePanels`.
- `FaqSection` joined `AboutSection`/`LiberalsShowcase`/`MeetUsSection` as a shell-less
  content block. Header nav dropped the `#faq` link (folded into `#about`).

## Revision (v3) — 2026-06-29

- **Gallery moved into the carousel** as a 5th panel (Who we are · Our MKs · FAQ ·
  Meet us · Gallery). The standalone trailing Gallery section is gone; `GallerySection`
  is now a shell-less content block. Header nav dropped `#gallery` (now `#about`, `#join`).
- **Auto-scroll:** `HomePanels` auto-advances every 6s (`AUTO_ADVANCE_MS`), wrapping at
  the end, paused on hover/focus and disabled under `prefers-reduced-motion`.
- Meet us stays a carousel panel (an earlier "move it below Join" request was retracted).
