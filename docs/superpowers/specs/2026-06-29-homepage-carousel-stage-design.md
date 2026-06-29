# Homepage Carousel v2 — Fixed Stage, Labeled Index & Lightbox — Design

**Date:** 2026-06-29
**Status:** Approved (validated via live prototype on `proto/homepage-carousel-stage`)
**Follows:** [2026-06-29-homepage-rearchitecture-design.md](2026-06-29-homepage-rearchitecture-design.md) (v1–v3 introduced `HomePanels`)

## Goal

Make the homepage identity carousel (`HomePanels`, owns `#about`) compact and easy
to navigate while holding all of its sections (Who we are · Our MKs · FAQ · Meet us
· Gallery). The v3 swipe carousel had three problems: it grew as tall as the tallest
panel (so short panels wasted a screen and the height jumped between panels), its
dots were anonymous, and the gallery lightbox was hard to navigate (especially RTL).

## Design

### 1. Fixed-height stage + labeled section index (`HomePanels`)

- **Labeled index replaces dots/arrows.** A `role="tablist"` row names every panel
  (`מי אנחנו · ח"כים · שאלות · פגישה · גלריה`); the active tab is underlined; clicking
  a tab navigates to that panel. Each panel is a `role="tabpanel"` with
  `aria-labelledby` its tab; tabs carry `aria-selected` and roving `tabIndex`.
- **One fixed-height stage.** The scroll track is `h-[clamp(440px,72vh,620px)]`, so
  the section is ~one screen regardless of the active panel. Each panel is
  `overflow-y-auto overscroll-contain`; tall panels scroll inside their own frame,
  short panels centre (`flex min-h-full` + `my-auto`). This removes the
  tallest-panel height and the jump between panels.
- **Retained:** horizontal snap-scroll, auto-advance every 6s (wraps), pause on
  hover/focus, `prefers-reduced-motion` disables auto-advance. Active panel tracked
  on scroll by nearest-centre (direction-robust for RTL).
- **Labels:** new `panels.{about,mks,faq,meetus,gallery}` keys (he + en).
- Conditional panels unchanged: MK panel only when an MK is annotated; Meet-us only
  when the `meetUs` flag is on and the visitor is anonymous. Tab count tracks visible
  panels.

### 2. Gallery panel: bounded preview + "view all" (`GallerySection`)

- `maxItems` caps the thumbnails rendered in the grid (the carousel passes **8**).
- When `gallery.length > maxItems`, a **"view all (N)"** control renders below the
  grid and opens the lightbox at the first image. New interpolated `gallery.view_all`
  key (he/en). With ≤ 8 photos all show and no control appears.
- The lightbox always cycles the full set regardless of the preview cap.

### 3. Lightbox overhaul (`GallerySection`)

- **Direction-aware arrows.** Edge-positioned (logical `start`/`end`); icons chosen
  by direction so "forward/next" points left in RTL, right in LTR. Disabled at the
  first/last image (clamp, no wrap) — buttons and keyboard agree.
- **Position counter** `N / total` (rendered `dir="ltr"` so the number/slash never
  reorder).
- **Keyboard navigation** while open: `←`/`→` step (direction-aware — in RTL Left =
  forward), `Esc` closes (Radix Dialog default).
- **Thumbnail filmstrip.** A horizontally-scrollable row of every photo; clicking a
  thumb jumps to it; the active thumb is ring-highlighted and scrolled into view as
  the selection changes (`scrollIntoView`, guarded).

## Components touched

- `HomePanels.tsx` — tablist + fixed stage (replaces dots/arrows block).
- `GallerySection.tsx` — `maxItems` preview + "view all"; lightbox arrows/counter/
  keyboard/filmstrip; shell-less content block (from the v3 rearchitecture).
- `src/locales/{he,en}.json` — `panels.*` labels, `gallery.view_all`.
- Tests: `tests/components/HomePanels.test.tsx`, `tests/components/GallerySection.test.tsx`.

(`FaqSection` block conversion, `Header` nav, and `HomePage` order were landed in the
prior rearchitecture work and are unchanged here.)

## Acceptance criteria

| Lever | Result |
|---|---|
| Section height | Fixed (~one screen), consistent across panels — no jump |
| Panel nav | Named tabs (click) + swipe + auto-advance; arrows/dots removed |
| Gallery grid | ≤ 8 thumbnails; "view all (N)" beyond that, opens lightbox |
| Lightbox arrows | RTL-correct, disabled at ends |
| Lightbox orientation | "N / total" counter; keyboard ←/→ + Esc |
| Lightbox bulk nav | Thumbnail filmstrip, click-to-jump, active follows |
| Quality gates | `tsc` 0 · `npm test` green (581) · `npm run build` clean · lint 0 errors |

## Out of scope

- Content trims for the About / MKs panels (the fixed stage makes them optional).
- The pure-tabs (no swipe/auto-advance) alternative.
- English parliament support (remains absent by design).
- Full ARIA roving-tabindex keyboard handling for the tab row (click + native focus
  only); a follow-up if needed.

## Finalization

The implementation already exists and is validated on `proto/homepage-carousel-stage`.
After spec approval: run the full quality gates, commit, merge to `master`, and deploy
(GitHub Pages) — via finishing-a-development-branch — rather than writing a fresh plan
for completed work.
