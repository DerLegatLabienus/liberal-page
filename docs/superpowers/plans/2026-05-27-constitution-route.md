# Constitution Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. (This plan is being executed inline by the author, who has the source HTML in context for the content-transcription task.)

**Goal:** Add a `/constitution` React route presenting the Likud party org-structure (15 chapters) bilingually — Hebrew authoritative, English an unofficial translation with a watermark — with per-chapter deep-links into a hosted PDF.

**Architecture:** Introduce React Router; split today's single-page `App` into a router with `HomePage` (current content) and `ConstitutionPage`. Chapter content lives in a typed bilingual data file; small presentational components render it in the site's Tailwind/dark-mode system. PDF hosted in `public/`, linked with `#page=N`.

**Tech Stack:** React 18 + Vite + Tailwind, `react-router-dom` (new), Vitest + @testing-library/react, i18next.

---

## File Structure

**Create:**
- `src/pages/HomePage.tsx` — current `App.tsx` body verbatim
- `src/pages/ConstitutionPage.tsx` — the new page
- `src/data/constitution.ts` — bilingual chapter data + types
- `src/components/constitution/TranslationDisclaimer.tsx`
- `src/components/constitution/ChapterPdfLink.tsx`
- `src/components/constitution/ConstitutionChapterCard.tsx`
- `public/constitution.pdf` — hosted source PDF
- `public/404.html` — GitHub Pages SPA redirect shim
- Tests: `tests/components/ChapterPdfLink.test.tsx`, `tests/components/TranslationDisclaimer.test.tsx`, `tests/components/ConstitutionPage.test.tsx`, `tests/components/HeaderConstitutionLink.test.tsx`

**Modify:**
- `package.json` — add `react-router-dom`
- `src/main.tsx` — wrap `<App/>` in `<BrowserRouter>`
- `src/App.tsx` — becomes `<Routes>` (`/`, `/constitution`, `*`)
- `src/components/layout/Header.tsx` — add constitution `<Link>`
- `src/locales/he.json`, `src/locales/en.json` — `constitution.*` chrome strings
- `index.html` — SPA-shim restore snippet

---

## Task 1: Add React Router and split App into HomePage

**Files:**
- Modify: `package.json`, `src/main.tsx`, `src/App.tsx`
- Create: `src/pages/HomePage.tsx`

- [ ] **Step 1: Install react-router-dom**

Run: `npm install react-router-dom`
Expected: added to dependencies, no errors.

- [ ] **Step 2: Move current `App.tsx` body into `src/pages/HomePage.tsx`**

Copy the **entire current contents** of `src/App.tsx` into a new `src/pages/HomePage.tsx`, renaming the component `App` → `HomePage` and updating the default export. Fix the relative import depth: imports that were `@/...` stay the same (alias is root-relative). Keep everything else identical (Header, HeroSection, ParliamentStrip, KnessetBillsOverview, AboutSection, …, Footer, ParliamentDrawer, all hooks/handlers).

- [ ] **Step 3: Replace `src/App.tsx` with a router**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/pages/HomePage'
import ConstitutionPage from '@/pages/ConstitutionPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/constitution" element={<ConstitutionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```
(`ConstitutionPage` is created in Task 6; until then this won't compile — that's expected, Tasks 2–6 build it. If implementing strictly in order, temporarily point `/constitution` at `HomePage` and switch in Task 7.)

- [ ] **Step 4: Wrap App in BrowserRouter in `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 5: Verify the app still builds and existing tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (homepage unchanged in behavior; no test imports `App` directly that would break). If a test imports `App` and now needs a router, wrap it in `<MemoryRouter>`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/App.tsx src/pages/HomePage.tsx
git commit -m "feat(router): add react-router, split App into HomePage + routes"
```

---

## Task 2: Bilingual constitution data file

**Files:**
- Create: `src/data/constitution.ts`

- [ ] **Step 1: Define types + data**

Create `src/data/constitution.ts`. Type:

```ts
export type ConstitutionColor =
  | 'blue' | 'gold' | 'teal' | 'red' | 'green' | 'purple' | 'orange' | 'navy'

export interface ConstitutionChapterContent {
  title: string
  summary: string
  bullets: string[]
}

export interface ConstitutionChapter {
  key: string
  color: ConstitutionColor
  pdfPage: number
  he: ConstitutionChapterContent
  en: ConstitutionChapterContent
}

export const CONSTITUTION_CHAPTERS: ConstitutionChapter[] = [ /* 15 entries */ ]
```

Populate **all 15 chapters**, transcribing the Hebrew **verbatim** from the uploaded `likudconstitution.html` (titles, summaries, and the `<li>` bullet lists inside each chapter's expand panel) and adding a faithful English translation. Keys, colors, and `pdfPage` come from the HTML's `PDF_CONFIG` and section classes:

| key | color | pdfPage | he.title (source) |
|---|---|---|---|
| members | blue (hero) | 3 | חברי התנועה |
| chairman | blue | 17 | יושב ראש התנועה |
| convention | blue | 9 | הוועידה — המוסד העליון |
| center | gold | 9 | המרכז — בין ועידה לוועידה |
| bureau | navy | 19 | לשכת הליכוד |
| secretariat | teal | 21 | מזכירות הליכוד |
| oversight | red | 17 | ועדת הפיקוח |
| court | purple | 22 | בית הדין |
| auditor | green | 24 | המבקר הפנימי |
| branches | orange | 7 | סניפים |
| youth | teal | 26 | צעירי הליכוד |
| knesset | navy | 25 | סיעת הכנסת |
| histadrut | red | 25 | סיעת הליכוד בהסתדרות |
| world | green | 29 | הליכוד העולמי |
| local_gov | gold | 28 | השלטון המקומי |

Example entry (members), showing exact shape — produce the rest the same way:

```ts
{
  key: 'members', color: 'blue', pdfPage: 3,
  he: {
    title: 'חברי התנועה',
    summary: 'אזרח ישראלי מגיל 17, תושב הארץ, המזדהה עם מטרות התנועה. משלם דמי חבר שנתיים. בוחר ישירות את יושב ראש התנועה ואת צירי הוועידה.',
    bullets: [
      'תנאי חברות: אזרח ישראלי מגיל 17, תושב הארץ, המזדהה עם מטרות התנועה ומשלם דמי חבר שנתיים',
      'זכות בחירה: לאחר 16 חודשי חברות רצופים, החבר רשאי להצביע בבחירות פנימיות',
      'זכות להיבחר: לאחר 3 שנות חברות רצופות, החבר רשאי להתמודד על תפקידים',
      'הפסקת חברות: בית הדין רשאי להפסיק חברות בשל הפרת חוקה; לחבר זכות ערעור תוך 15 ימים',
      'יקיר התנועה: חבר מעל גיל 70 עם 25+ שנות פעילות — מעמד מיוחד בתנועה',
    ],
  },
  en: {
    title: 'Movement Members',
    summary: 'An Israeli citizen aged 17+, resident in Israel, who identifies with the movement\'s goals and pays annual dues. Directly elects the movement chairman and convention delegates.',
    bullets: [
      'Membership: Israeli citizen aged 17+, resident, identifies with the movement’s goals, pays annual dues',
      'Right to vote: after 16 consecutive months of membership, may vote in internal elections',
      'Right to be elected: after 3 consecutive years of membership, may run for office',
      'Termination: the Tribunal may terminate membership for charter violations; the member may appeal within 15 days',
      'Movement Honoree (Yakir): member over 70 with 25+ years of activity — a special standing',
    ],
  },
},
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/data/constitution.ts
git commit -m "feat(constitution): add bilingual 15-chapter content data"
```

---

## Task 3: ChapterPdfLink component

**Files:**
- Create: `src/components/constitution/ChapterPdfLink.tsx`
- Test: `tests/components/ChapterPdfLink.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ChapterPdfLink from '@/components/constitution/ChapterPdfLink'

describe('ChapterPdfLink', () => {
  it('links to the hosted PDF at the chapter page', () => {
    render(<ChapterPdfLink page={17} lang="he" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toContain('constitution.pdf#page=17')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows a Hebrew-only note when lang is en', () => {
    render(<ChapterPdfLink page={3} lang="en" />)
    expect(screen.getByText(/Hebrew/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test → FAIL** (`npx vitest run tests/components/ChapterPdfLink.test.tsx`) — module not found.

- [ ] **Step 3: Implement**

```tsx
export default function ChapterPdfLink({ page, lang }: { page: number; lang: string }) {
  const href = `${import.meta.env.BASE_URL}constitution.pdf#page=${page}`
  return (
    <div className="mt-3">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        {lang === 'en' ? 'Open in the constitution (PDF) ↗' : 'פתח בחוקה (PDF) ↗'}
      </a>
      {lang === 'en' && (
        <span className="ms-2 text-xs text-muted-foreground">(Hebrew original)</span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test → PASS** (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/constitution/ChapterPdfLink.tsx tests/components/ChapterPdfLink.test.tsx
git commit -m "feat(constitution): add ChapterPdfLink with hosted-PDF deep link"
```

---

## Task 4: TranslationDisclaimer component

**Files:**
- Create: `src/components/constitution/TranslationDisclaimer.tsx`
- Test: `tests/components/TranslationDisclaimer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TranslationDisclaimer from '@/components/constitution/TranslationDisclaimer'

describe('TranslationDisclaimer', () => {
  it('renders the unofficial-translation warning text', () => {
    render(<TranslationDisclaimer />)
    expect(screen.getByRole('note')).toHaveTextContent(/unofficial translation/i)
    expect(screen.getByRole('note')).toHaveTextContent(/Hebrew/i)
  })
})
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

```tsx
export default function TranslationDisclaimer() {
  return (
    <div role="note" className="mb-6 rounded-lg border border-amber-400/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      ⚠️ Unofficial translation for convenience. The binding text is the original Hebrew constitution.
    </div>
  )
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/components/constitution/TranslationDisclaimer.tsx tests/components/TranslationDisclaimer.test.tsx
git commit -m "feat(constitution): add unofficial-translation disclaimer banner"
```

---

## Task 5: ConstitutionChapterCard component

**Files:**
- Create: `src/components/constitution/ConstitutionChapterCard.tsx`

- [ ] **Step 1: Implement** (covered by the ConstitutionPage test in Task 6; presentational)

```tsx
import { useState } from 'react'
import type { ConstitutionChapter, ConstitutionColor } from '@/data/constitution'
import ChapterPdfLink from './ChapterPdfLink'

const ACCENT: Record<ConstitutionColor, string> = {
  blue: 'border-s-4 border-blue-500', gold: 'border-s-4 border-amber-600',
  teal: 'border-s-4 border-teal-600', red: 'border-s-4 border-red-600',
  green: 'border-s-4 border-green-600', purple: 'border-s-4 border-violet-600',
  orange: 'border-s-4 border-orange-600', navy: 'border-s-4 border-indigo-800',
}

export default function ConstitutionChapterCard({ chapter, lang }: { chapter: ConstitutionChapter; lang: 'he' | 'en' }) {
  const [open, setOpen] = useState(false)
  const c = lang === 'en' ? chapter.en : chapter.he
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${ACCENT[chapter.color]}`}>
      <h3 className="mb-1 text-lg font-bold text-foreground">{c.title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{c.summary}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="mt-3 text-xs font-semibold text-primary">
        {open ? (lang === 'en' ? 'Hide details' : 'הסתר פרטים') : (lang === 'en' ? 'Show details' : 'הצג פרטים')}
      </button>
      {open && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {c.bullets.map((b, i) => (<li key={i} className="leading-relaxed">• {b}</li>))}
        </ul>
      )}
      <ChapterPdfLink page={chapter.pdfPage} lang={lang} />
    </section>
  )
}
```
(If `bg-surface` is not a token in this repo, use `bg-card` or `bg-white dark:bg-slate-900` — verify against existing components during implementation and match.)

- [ ] **Step 2: Type-check** (`npx tsc --noEmit`) → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/constitution/ConstitutionChapterCard.tsx
git commit -m "feat(constitution): add expandable chapter card"
```

---

## Task 6: ConstitutionPage

**Files:**
- Create: `src/pages/ConstitutionPage.tsx`
- Test: `tests/components/ConstitutionPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const setLang = vi.fn()
let currentLang = 'he'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: currentLang, changeLanguage: setLang } }),
}))
vi.mock('@/hooks/useDirection', () => ({ useDirection: () => (currentLang === 'he' ? 'rtl' : 'ltr') }))

import ConstitutionPage from '@/pages/ConstitutionPage'

function renderPage() {
  return render(<MemoryRouter><ConstitutionPage /></MemoryRouter>)
}

describe('ConstitutionPage', () => {
  beforeEach(() => { currentLang = 'he' })

  it('renders Hebrew chapter titles by default, no disclaimer', () => {
    renderPage()
    expect(screen.getByText('חברי התנועה')).toBeInTheDocument()
    expect(screen.getByText('בית הדין')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('renders English titles + disclaimer when language is en', () => {
    currentLang = 'en'
    renderPage()
    expect(screen.getByText('Movement Members')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/unofficial translation/i)
  })
})
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

```tsx
import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { CONSTITUTION_CHAPTERS } from '@/data/constitution'
import ConstitutionChapterCard from '@/components/constitution/ConstitutionChapterCard'
import TranslationDisclaimer from '@/components/constitution/TranslationDisclaimer'

export default function ConstitutionPage() {
  const { i18n } = useTranslation()
  const direction = useDirection()
  const lang = i18n.language === 'en' ? 'en' : 'he'

  return (
    <div className="min-h-screen bg-background" dir={direction}>
      <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-bold text-foreground">
          {lang === 'en' ? 'Movement Organizational Structure — Likud' : 'מבנה ארגוני — הליכוד'}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {lang === 'en'
            ? 'A national liberal movement — institutions, powers, and election flow. Charter in force since 1 July 2015.'
            : 'תנועה לאומית ליברלית — מוסדות, סמכויות וזרימת בחירות. חוקת התנועה — תוקף מיום 1 ביולי 2015.'}
        </p>
        {lang === 'en' && <TranslationDisclaimer />}
        <div className="grid gap-4 md:grid-cols-2">
          {CONSTITUTION_CHAPTERS.map((ch) => (
            <ConstitutionChapterCard key={ch.key} chapter={ch} lang={lang} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 4: Run test → PASS** (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/ConstitutionPage.tsx tests/components/ConstitutionPage.test.tsx
git commit -m "feat(constitution): add bilingual ConstitutionPage"
```

---

## Task 7: Wire the /constitution route

**Files:**
- Modify: `src/App.tsx` (if Task 1 used a temporary placeholder)

- [ ] **Step 1:** Ensure `src/App.tsx` imports the real `ConstitutionPage` and the `/constitution` route points to it (per the Task 1 router code).

- [ ] **Step 2: Type-check + full suite** (`npx tsc --noEmit && npx vitest run`) → PASS.

- [ ] **Step 3: Commit** (skip if already committed in Task 1)

```bash
git add src/App.tsx && git commit -m "feat(constitution): route /constitution to ConstitutionPage"
```

---

## Task 8: Header constitution link + i18n strings

**Files:**
- Modify: `src/components/layout/Header.tsx`, `src/locales/he.json`, `src/locales/en.json`
- Test: `tests/components/HeaderConstitutionLink.test.tsx`

- [ ] **Step 1: Add i18n strings** — add to the `ui` (or `nav`) namespace in both files: `"constitution_nav": "חוקת התנועה"` (he) / `"constitution_nav": "Constitution"` (en). Verify the exact existing namespace key style first and match it.

- [ ] **Step 2: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect } from 'vitest'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he', changeLanguage: vi.fn() } }),
}))
import Header from '@/components/layout/Header'

it('renders a link to /constitution', () => {
  render(<MemoryRouter><Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} /></MemoryRouter>)
  const link = screen.getByRole('link', { name: /constitution|חוקת/i })
  expect(link).toHaveAttribute('href', '/constitution')
})
```

- [ ] **Step 3: Run test → FAIL.**

- [ ] **Step 4: Add the `<Link>` to `Header.tsx`** — import `{ Link } from 'react-router-dom'`, add `<Link to="/constitution" className="...">{t('ui.constitution_nav')}</Link>` in the header nav, matching sibling nav-item styling.

- [ ] **Step 5: Run test → PASS.** Then full suite (`npx vitest run`) → confirm existing Header test still passes (it may now need `<MemoryRouter>` wrapping — update it if so).

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Header.tsx src/locales/he.json src/locales/en.json tests/components/HeaderConstitutionLink.test.tsx
git commit -m "feat(constitution): add Header nav link to /constitution"
```

---

## Task 9: Host PDF + GitHub Pages SPA shim

**Files:**
- Create: `public/constitution.pdf`, `public/404.html`
- Modify: `index.html`

- [ ] **Step 1: Copy the uploaded PDF into public/**

Run: `cp /home/aavitan/.claude/uploads/ed3ea2a4-1b6a-4100-98ff-18b400fda1e3/421b74dc-Emailing_huka0716.pdf public/constitution.pdf`
Verify: `ls -la public/constitution.pdf` (~203 KB).

- [ ] **Step 2: Add `public/404.html`** (standard `spa-github-pages` redirect for a project page with 1 path segment of base):

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><title>הליכוד</title>
<script>
  // Single-segment basename (/liberal-page/) → segmentCount = 1
  var l = window.location;
  var segmentCount = 1;
  l.replace(
    l.protocol + '//' + l.host + l.pathname.split('/').slice(0, 1 + segmentCount).join('/') + '/?/' +
    l.pathname.slice(1).split('/').slice(segmentCount).join('/').replace(/&/g, '~and~') +
    (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') + l.hash
  );
</script></head><body></body></html>
```

- [ ] **Step 3: Add the restore snippet to `index.html`** (inside `<head>`, before the module script):

```html
<script>
  (function(){
    var redirect = sessionStorage.redirect; // legacy guard
    var l = window.location;
    if (l.search[1] === '/') {
      var decoded = l.search.slice(1).split('&').map(function (s) {
        return s.replace(/~and~/g, '&');
      }).join('?');
      window.history.replaceState(null, null, l.pathname.slice(0, -1) + decoded + l.hash);
    }
    void redirect;
  })();
</script>
```

- [ ] **Step 4: Build to confirm assets are included**

Run: `npm run build`
Expected: success; `dist/constitution.pdf` and `dist/404.html` present (`ls dist/constitution.pdf dist/404.html`).

- [ ] **Step 5: Commit**

```bash
git add public/constitution.pdf public/404.html index.html
git commit -m "feat(constitution): host PDF + add GitHub Pages SPA redirect shim"
```

---

## Task 10: Full verification

- [ ] **Step 1:** `npx tsc --noEmit` → PASS
- [ ] **Step 2:** `npx vitest run` → all pass
- [ ] **Step 3:** `npm run lint` → 0 errors
- [ ] **Step 4:** `npm run build` → success
- [ ] **Step 5: Manual** — `npm run dev:frontend`, open `/liberal-page/` → click the Constitution nav link → page renders all 15 chapters in Hebrew; switch language to English → English titles + disclaimer banner; expand a chapter; click a PDF link → opens `constitution.pdf#page=N` in a new tab. Confirm the homepage still works and `/liberal-page/constitution` deep-loads.

---

## Self-Review (completed during planning)

- **Spec coverage:** routing+basename (T1), HomePage split (T1), bilingual data (T2), PDF deep-link (T3), watermark (T4), chapter card/expand (T5), page + language switch + disclaimer (T6), route (T1/T7), Header link + i18n (T8), PDF hosting + SPA shim (T9), verification (T10). All spec requirements mapped.
- **Type consistency:** `ConstitutionChapter`/`ConstitutionColor`/`ConstitutionChapterContent` defined in T2 and used unchanged in T5/T6; `lang: 'he' | 'en'` consistent across ChapterPdfLink (string param, tolerant), ConstitutionChapterCard, ConstitutionPage.
- **Known verify-at-impl points (not placeholders):** confirm Tailwind token names (`bg-surface`/`bg-card`) against existing components; confirm Header nav namespace key style; existing `App`/`Header` tests may need `<MemoryRouter>` wrapping after routing is added — update them in the same task.
