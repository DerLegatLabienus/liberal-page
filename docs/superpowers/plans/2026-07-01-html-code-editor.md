# HTML Code Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four raw-HTML admin `<textarea>` fields with one shared syntax-highlighting CodeMirror-based `HtmlCodeEditor`.

**Architecture:** A single `HtmlCodeEditor` component wraps CodeMirror (lazy-loaded into the admin chunks) and exposes a plain `{ value, onChange }` string API — a drop-in for the textareas. It renders a plain-`<textarea>` fallback via `<Suspense>`. The four call sites (letter body, new template, edit template, email template) swap `<textarea>` → `<HtmlCodeEditor>`; previews and server sanitization are untouched.

**Tech Stack:** React 18, Vite, CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-html`), Vitest + happy-dom.

## Global Constraints

- Style is a **code editor with syntax highlighting** — raw HTML stays visible. No WYSIWYG, no toolbar, no autocomplete, no HTML linting.
- Scope is **all four** raw-HTML editors, via **one shared component**.
- The editor container is **explicitly `dir="ltr"`** (the app sets `document.documentElement.dir="rtl"`, so it must force LTR); Hebrew renders RTL within lines via bidi.
- Library: **CodeMirror 6** via `@uiw/react-codemirror` + `@codemirror/lang-html`, **lazy-loaded** so it lands only in the admin route chunks.
- Server-side sanitization (`server/services/html-sanitizer.ts`) and the `<iframe srcDoc>` previews are **unchanged**.
- CodeMirror does not run under happy-dom: unit tests use the **`FallbackTextarea`** and a **`vi.mock` of `HtmlCodeEditor` → `<textarea>`** in page tests. Real editor behavior is verified by the build + manually.

---

### Task 1: The shared `HtmlCodeEditor` component

**Files:**
- Install: `@uiw/react-codemirror`, `@codemirror/lang-html`
- Create: `src/components/admin/HtmlCodeEditor.tsx`
- Create: `src/components/admin/CodeMirrorEditor.tsx`
- Test: `tests/components/HtmlCodeEditor.test.tsx`

**Interfaces:**
- Produces: `interface HtmlCodeEditorProps { value: string; onChange: (value: string) => void; placeholder?: string; ariaLabel?: string; minHeight?: string }`; default export `HtmlCodeEditor(props: HtmlCodeEditorProps)`; named export `FallbackTextarea(props: HtmlCodeEditorProps)`.

- [ ] **Step 1: Install the dependencies**

Run: `npm install @uiw/react-codemirror @codemirror/lang-html`
Expected: both added to `package.json` dependencies.

- [ ] **Step 2: Write the failing test (FallbackTextarea)**

```tsx
// tests/components/HtmlCodeEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { FallbackTextarea } from '@/components/admin/HtmlCodeEditor'

describe('HtmlCodeEditor / FallbackTextarea', () => {
  it('renders the value and forwards placeholder, aria-label, and edits', () => {
    const onChange = vi.fn()
    render(<FallbackTextarea value="<p>hi</p>" onChange={onChange} placeholder="<p>ph</p>" ariaLabel="Body HTML" />)
    const ta = screen.getByLabelText('Body HTML')
    expect(ta).toHaveValue('<p>hi</p>')
    expect(ta).toHaveAttribute('placeholder', '<p>ph</p>')
    fireEvent.change(ta, { target: { value: '<p>new</p>' } })
    expect(onChange).toHaveBeenCalledWith('<p>new</p>')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/HtmlCodeEditor.test.tsx`
Expected: FAIL — cannot find module `@/components/admin/HtmlCodeEditor`.

- [ ] **Step 4: Write the CodeMirror wrapper**

```tsx
// src/components/admin/CodeMirrorEditor.tsx
import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import type { HtmlCodeEditorProps } from './HtmlCodeEditor'

// Default export so it can be React.lazy-loaded (keeps CodeMirror out of the main bundle).
export default function CodeMirrorEditor({ value, onChange, placeholder, ariaLabel, minHeight }: HtmlCodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      minHeight={minHeight ?? '9rem'}
      theme="light"
      extensions={[html(), EditorView.lineWrapping]}
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        autocompletion: false,
        highlightActiveLine: true,
      }}
    />
  )
}
```

- [ ] **Step 5: Write the public component + fallback**

```tsx
// src/components/admin/HtmlCodeEditor.tsx
import { lazy, Suspense } from 'react'

export interface HtmlCodeEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  minHeight?: string
}

// Deferred so CodeMirror is code-split into the admin chunk, not the main bundle.
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'))

/** Plain-textarea fallback: used while CodeMirror loads, if the chunk fails, and as the
 *  mock target in page tests (CodeMirror does not run under happy-dom). */
export function FallbackTextarea({ value, onChange, placeholder, ariaLabel, minHeight }: HtmlCodeEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full rounded border px-3 py-1.5 font-mono text-sm"
      style={{ minHeight: minHeight ?? '9rem' }}
    />
  )
}

export default function HtmlCodeEditor(props: HtmlCodeEditorProps) {
  // Force LTR: the surrounding document is dir="rtl", but code reads left-to-right.
  return (
    <div dir="ltr" className="overflow-hidden rounded border text-sm [&_.cm-editor]:rounded">
      <Suspense fallback={<FallbackTextarea {...props} />}>
        <CodeMirrorEditor {...props} />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/components/HtmlCodeEditor.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 7: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add package.json package-lock.json src/components/admin/HtmlCodeEditor.tsx src/components/admin/CodeMirrorEditor.tsx tests/components/HtmlCodeEditor.test.tsx
git commit -m "feat(admin): HtmlCodeEditor (CodeMirror) shared component"
```

---

### Task 2: Swap the three letter editors in `AdminLettersPage`

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx` (body ~line 411; NewTemplateForm ~line 471; TemplateRow edit ~line 522)
- Modify: `tests/components/AdminLettersComposer.test.tsx` (add the mock)

**Interfaces:**
- Consumes: `HtmlCodeEditor` (Task 1) — `default` export, props `{ value, onChange, placeholder?, ariaLabel? }`.

- [ ] **Step 1: Add the mock to the composer test (so it keeps passing)**

The composer test types into the body via `getByPlaceholderText(/<p>/)`. CodeMirror can't run under happy-dom, so mock the editor to a plain textarea that forwards placeholder/value/onChange. Add near the top of `tests/components/AdminLettersComposer.test.tsx`, with the other `vi.mock` calls:

```tsx
vi.mock('@/components/admin/HtmlCodeEditor', () => ({
  default: ({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
```

- [ ] **Step 2: Run the composer test to confirm it still passes (pre-change, with the mock)**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS — the mock renders a textarea; the page still uses the real `<textarea>` at this point, so the mock is inert until Step 3. (If it fails, the mock path/shape is wrong — fix before continuing.)

- [ ] **Step 3: Add the import**

At the top of `src/pages/AdminLettersPage.tsx`, add:

```tsx
import HtmlCodeEditor from '@/components/admin/HtmlCodeEditor'
```

- [ ] **Step 4: Replace the letter body editor**

Replace (the body textarea, ~lines 411-413):

```tsx
          <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} required rows={6}
            className="w-full rounded border px-3 py-1.5 text-sm font-mono"
            placeholder="<p>לכבוד ח&quot;כ...</p>" />
```

with:

```tsx
          <HtmlCodeEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            ariaLabel="Body HTML"
            placeholder={'<p>לכבוד ח"כ...</p>'}
          />
```

(The `required` attribute is dropped — CodeMirror is not a form control. The submit handler already guards `if (!title || !subject || !bodyHtml || toAddresses.length === 0) return`, so empty bodies are still blocked.)

- [ ] **Step 5: Replace the New-Template editor**

Replace (~line 471):

```tsx
      <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={6} placeholder={`<div dir="rtl">${PLACEHOLDER}</div>`} className="w-full rounded border px-3 py-1.5 font-mono text-sm" />
```

with:

```tsx
      <HtmlCodeEditor value={html} onChange={setHtml} ariaLabel="Template HTML" placeholder={`<div dir="rtl">${PLACEHOLDER}</div>`} />
```

- [ ] **Step 6: Replace the Edit-Template editor**

Replace (~line 522):

```tsx
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={6} className="mb-2 w-full rounded border px-3 py-1.5 font-mono text-sm" />
```

with:

```tsx
        <div className="mb-2">
          <HtmlCodeEditor value={html} onChange={setHtml} ariaLabel="Template HTML" />
        </div>
```

- [ ] **Step 7: Run the composer test + type-check**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS — the mocked editor's `placeholder={'<p>לכבוד ח"כ...</p>'}` still matches `getByPlaceholderText(/<p>/)` and `user.type` works.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(admin): use HtmlCodeEditor for letter body + template editors"
```

---

### Task 3: Swap the email-template editor in `AdminPanel`

**Files:**
- Modify: `src/components/admin/AdminPanel.tsx` (email-template textarea ~line 154)

**Interfaces:**
- Consumes: `HtmlCodeEditor` (Task 1).

No frontend test drives this editor (the email-template tests are server-side), so no test change is needed.

- [ ] **Step 1: Add the import**

At the top of `src/components/admin/AdminPanel.tsx`, add (if not already importing from this path):

```tsx
import HtmlCodeEditor from '@/components/admin/HtmlCodeEditor'
```

- [ ] **Step 2: Replace the email-template editor**

Replace (~lines 154-159):

```tsx
                          <textarea
                            className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs"
                            rows={6}
                            value={tpl.html}
                            onChange={(e) => editTemplate(tpl.name, { html: e.target.value })}
                          />
```

with:

```tsx
                          <div className="mt-1">
                            <HtmlCodeEditor
                              value={tpl.html}
                              onChange={(html) => editTemplate(tpl.name, { html })}
                              ariaLabel={`${tpl.name} HTML`}
                            />
                          </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Confirm the admin-panel test suite still passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS (unaffected — sanity check that the shared import didn't break anything).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminPanel.tsx
git commit -m "feat(admin): use HtmlCodeEditor for email-template editor"
```

---

### Task 4: Full gate, bundle check, docs

**Files:**
- Modify: `docs/components.md`

- [ ] **Step 1: Run the full gate**

Run: `npm test`
Expected: all pass (the prior 607 + the new HtmlCodeEditor test; 5 skipped).

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings acceptable).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 2: Verify CodeMirror is code-split into an admin chunk (not the main bundle)**

Run: `ls -la dist/assets/*.js | sort -k5 -n | tail`
Then confirm the main `index-*.js` bundle did **not** balloon by ~150 KB, and that a separate chunk containing CodeMirror exists (grep the build output or dist for a codemirror-bearing chunk):

Run: `grep -l "cm-editor\|codemirror" dist/assets/*.js | head`
Expected: CodeMirror appears in a chunk associated with the admin pages, not `index-*.js`. If it landed in the main bundle, the `lazy()` import in `HtmlCodeEditor.tsx` was bypassed — fix before continuing.

- [ ] **Step 3: Update docs**

In `docs/components.md`, add an `HtmlCodeEditor` entry near the other admin components: shared CodeMirror-based HTML code editor (highlighting, line numbers, auto-indent, bracket matching; `dir="ltr"` + bidi; lazy-loaded; plain-textarea fallback). Props `{ value, onChange, placeholder?, ariaLabel?, minHeight? }`. Used by the letter body, letter templates, and email-template editors.

- [ ] **Step 4: Commit**

```bash
git add docs/components.md
git commit -m "docs(admin): document HtmlCodeEditor"
```

---

## Manual verification (post-implementation, in the browser)

CodeMirror can't be exercised under happy-dom, so confirm in the running admin UI: open a letter/template editor — HTML is syntax-highlighted with line numbers; typing auto-indents and closes brackets; Hebrew text reads right-to-left within lines while tags read left-to-right; the live preview still updates; saving still works (server sanitization intact).
