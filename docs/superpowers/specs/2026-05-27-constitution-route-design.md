# Design: Likud Constitution / Org-Structure Route

## Context

The user provided two resources to integrate into the site:
1. A polished, self-contained **interactive org-structure page** (`likudconstitution.html`) visualizing the Likud party constitution — 15 chapters with expandable summaries, color-coded bodies, flow arrows, and per-chapter "open PDF" links.
2. The **source constitution PDF** (`Emailing_huka0716.pdf`, the בולק/חוקה as of 1 July 2015).

These become an in-site React **route** (`/constitution`) rebuilt in the site's design system, with bilingual content (Hebrew authoritative, English an unofficial convenience translation), and the PDF hosted for per-chapter deep-linking. The uploaded HTML's PDF link points at a local `file://` Mac path and must be rewired to the hosted asset.

## Requirements

1. New `/constitution` route (introduces React Router; site is currently a single scrolling page).
2. Faithful rebuild of the org-structure layout using the site's Tailwind tokens + existing dark mode (not the HTML's bespoke CSS).
3. **Bilingual content**: each chapter carries Hebrew (authoritative) and English (translation). Page renders per `i18n.language`.
4. **Unofficial-translation watermark**: in English mode, a prominent banner stating the Hebrew is the binding text; also noted near PDF links (PDF is Hebrew-only).
5. PDF hosted at `public/constitution.pdf`; each chapter button opens `#page=N` in a new tab.
6. Bilingual Header nav link to `/constitution`.
7. Deep links to `/constitution` must work on GitHub Pages (SPA 404 shim).

## Architecture

### Routing

Add `react-router-dom` (**new dependency** — not currently installed). `main.tsx` (currently just `createRoot(...).render(<StrictMode><App/></StrictMode>)`) wraps `<App/>` in `<BrowserRouter basename={import.meta.env.BASE_URL}>` (`BASE_URL` = `/liberal-page/` in prod, `/` in dev — avoids hardcoding; trailing slash is fine for basename).

`App.tsx` is split:
- **`HomePage`** (`src/pages/HomePage.tsx`) — the entire current `App.tsx` body (Header, Hero, ParliamentStrip, KnessetBillsOverview, About, …, Footer, drawer).
- **`App.tsx`** — holds `<Routes>`: `/` → `HomePage`, `/constitution` → `ConstitutionPage`.

`Header` is currently rendered inside the homepage body and takes `{ hasNewParliamentData, onOpenDrawer, trackerEnabled }`. `Header`/`Footer` stay within each page (HomePage already has them; ConstitutionPage renders its own). On `ConstitutionPage`, Header gets **inert props** — `hasNewParliamentData={false}`, `trackerEnabled={false}`, `onOpenDrawer={() => {}}` — since there's no parliament drawer there. The Header's new constitution link uses React Router `<Link>` (Header is inside `BrowserRouter`).

**GitHub Pages SPA shim:** add `public/404.html` with the standard redirect-to-index script, and a matching restore snippet in `index.html`, so a hard load of `/liberal-page/constitution` resolves to the SPA.

### Content data (bilingual)

`src/data/constitution.ts` exports a typed array. Each chapter:
```ts
interface ConstitutionChapter {
  key: string            // 'members' | 'chairman' | ...
  color: ConstitutionColor // maps to a site palette accent
  pdfPage: number        // page in constitution.pdf
  he: { title: string; summary: string; bullets: string[] }
  en: { title: string; summary: string; bullets: string[] }
}
```
Plus a `ConstitutionColor` union mapped to Tailwind accent classes. Hebrew text is copied verbatim from the uploaded HTML; English is a faithful translation.

**Chapters and PDF pages** (from the HTML's `PDF_CONFIG`):
members→3 (hero), branches→7, convention→9, center→9, chairman→17, oversight→17, bureau→19, secretariat→21, court→22, auditor→24, knesset→25, histadrut→25, youth→26, local_gov→28, world→29.

### Components (`src/components/constitution/`)

- **`ConstitutionPage`** (`src/pages/ConstitutionPage.tsx`) — page shell: Header, title/badge, the structured layout (hero member-base → chairman → supreme bodies → executive bodies → independent bodies → branches → special wings → elections-flow callout → legend), Footer. Reads `i18n.language` to pick `he`/`en` and `useDirection()` for layout direction.
- **`ConstitutionChapterCard`** — one chapter: label, summary, expandable bullets (reuse a disclosure), and a `ChapterPdfLink`.
- **`ChapterPdfLink`** — builds `${import.meta.env.BASE_URL}constitution.pdf#page=${pdfPage}`, opens in new tab; renders the Hebrew-only note in English mode.
- **`TranslationDisclaimer`** — the watermark banner; shown when `i18n.language === 'en'`.

Color accents map the HTML's blue/gold/teal/red/green/purple/orange/navy to the site's existing token palette (or a small local accent map if the site lacks them).

### i18n

- Nav label + page chrome strings (title, badge, "expand", disclaimer, PDF button) go into `he.json`/`en.json` under a `constitution.*` namespace.
- Chapter content lives in the data file (not i18n JSON), selected by language — keeps the large bilingual content in one typed place.

## Error / edge handling

- Unknown route → redirect to `/` (catch-all `<Route path="*">`).
- PDF missing → the link still resolves to the hosted path; no special handling (static asset).
- Reduced-motion: rely on the site's existing motion conventions (no bespoke animations required).

## Testing

- `ConstitutionPage` renders all chapter titles (Hebrew by default).
- Switching `i18n.language` to `en` renders English titles **and** the `TranslationDisclaimer` banner.
- `ChapterPdfLink` builds `…/constitution.pdf#page=N` with the correct page per chapter.
- Header constitution link navigates to `/constitution` (router test with `MemoryRouter`).
- Catch-all route redirects unknown paths to `/`.

## Out of scope

- Translating the full PDF (only the on-page summaries/bullets are translated).
- A PDF viewer/embed (links open the browser's native viewer).
- Editing/CMS of constitution content (static data file).
