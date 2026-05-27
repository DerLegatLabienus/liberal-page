# Design: Constitution — Rich (iframe) + Reader views with view toggle

## Context

The React-rebuilt `/constitution` page is functional but less visually polished than the original self-contained HTML the user provided. The user wants the original rich design available (embedded via iframe) with a toggle between it and the React reader view — and crucially, an **English version of the rich design** too, with the view toggle **preserving the current language**.

This makes language and view mode two independent axes.

## Requirements

1. **Two independent controls:**
   - **Language (he/en):** the existing global Header toggle (`i18n.language`), unchanged.
   - **View mode (Original ↔ Reader):** a new toggle on the constitution page; switching it keeps the current language.
2. **Rich (Original) view:** the original bespoke HTML design, embedded via `<iframe>`, available in **both** Hebrew and English.
3. **Reader view:** the existing React bilingual chapter cards (`ConstitutionPage` content), kept as-is.
4. **Default view mode:** Original (the look the user prefers).
5. The rich HTML's PDF links must point to the hosted `constitution.pdf` (the original's `file://` local path is broken on the web).
6. The English rich HTML carries the unofficial-translation note.

## Architecture

### Static rich-design files (`public/`)

Two self-contained HTML files (the original is self-contained: inline `<style>`, inline config script, Google Fonts):

- **`public/constitution-structure.he.html`** — the uploaded original, with two edits:
  - `PDF_CONFIG.path` → the hosted PDF; `openPdfChapter` builds an `https` URL `"<base>constitution.pdf#page=" + page` (not `file://`). Use a root-relative `/liberal-page/constitution.pdf` (the GH Pages base) so it works in prod; in dev the same path is served by Vite from `public/`.
  - An **auto-height script**: on load and resize, `parent.postMessage({ type: 'constitution-height', height: document.documentElement.scrollHeight }, '*')` so the embedding page can size the iframe (no nested scrollbars).
- **`public/constitution-structure.en.html`** — a full English translation of the above. Content (chapter titles/summaries/bullets) reuses the English already authored in `src/data/constitution.ts`; chrome (header badge, hero text, section labels, flow-arrow captions, legend, footer, expand summaries, PDF-link label) translated. Same PDF rewrite + auto-height script. Includes a top disclaimer banner: "Unofficial translation — the binding text is the original Hebrew."

`lang`/`dir` attributes: `he.html` keeps `lang="he" dir="rtl"`; `en.html` uses `lang="en" dir="ltr"`.

### ConstitutionPage (`src/pages/ConstitutionPage.tsx`)

- New local state `view: 'original' | 'reader'`, default `'original'`.
- Header + title + a **view-mode toggle** (segmented control). Labels via i18n (`constitution.view_rich` / `constitution.view_reader`).
- `view === 'original'`: render `<ConstitutionIframe lang={lang} />`.
- `view === 'reader'`: render the existing chapter-cards grid + `TranslationDisclaimer` (en) exactly as today.
- `lang` continues to derive from `i18n.language`; the toggle never changes language.

### New component `src/components/constitution/ConstitutionIframe.tsx`

- Props: `lang: 'he' | 'en'`.
- Renders `<iframe src={`${import.meta.env.BASE_URL}constitution-structure.${lang}.html`} title=… className="w-full">`.
- `useEffect` adds a `message` listener; on `{ type: 'constitution-height' }` from the iframe, set iframe height to the posted value (guarded to same-origin: the iframe is served from our own origin/base). Fallback min-height (e.g. `80vh`) until the first message.

## i18n

- `constitution.view_rich`, `constitution.view_reader` chrome strings in `he.json`/`en.json`.
- Rich HTML content is NOT in i18n JSON — it lives in the two static files (selected by `lang`).

## Error / edge handling

- If the iframe message lacks the expected shape/type, ignore it.
- If `postMessage` height is 0/absent, keep the fallback min-height.
- Unknown `lang` → fall back to `he` file (matches existing `lang` derivation).

## Testing

- `ConstitutionPage`: default renders the iframe (Original); its `src` ends with `constitution-structure.he.html` in Hebrew and `…en.html` in English; clicking the Reader toggle shows the chapter cards (e.g. "חברי התנועה"/"Movement Members"); toggling back shows the iframe; switching mode does not change language.
- `ConstitutionIframe`: builds the correct `src` per `lang`; sets height on receiving a `constitution-height` message.
- Static HTML files are not unit-tested (assets), but a build check confirms both land in `dist/`.

## Out of scope

- Single-file language switching inside the rich HTML (we use two files).
- Translating the PDF itself (still Hebrew; English rich page links to the Hebrew PDF with the disclaimer).
- Persisting view-mode across navigation (resets to default Original).
