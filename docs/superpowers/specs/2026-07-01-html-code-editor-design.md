# HTML Code Editor for Admin Raw-HTML Fields — Design Spec

**Date:** 2026-07-01
**Status:** Approved design — pending spec review

## Goal

Replace every admin editor that holds raw HTML — currently plain `<textarea class="font-mono">` fields — with a single reusable syntax-highlighting **code editor**. The HTML stays visible and hand-editable (no WYSIWYG), just far easier to read and modify: HTML syntax highlighting, line numbers, auto-indent, and bracket matching/auto-close.

## In Scope — the four raw-HTML editors

All currently plain textareas that store raw HTML (each keeps its adjacent live `<iframe srcDoc>` preview):

1. **Letter body** — `src/pages/AdminLettersPage.tsx` (new-letter form, `bodyHtml`, ~line 411).
2. **New letter template** — `AdminLettersPage.tsx` `NewTemplateForm` (`html`, ~line 471).
3. **Edit letter template** — `AdminLettersPage.tsx` `EditTemplateForm` (`html`, ~line 522).
4. **Email template** — `src/components/admin/AdminPanel.tsx` (template `html`, ~line 155).

All four are replaced by one shared component, reused everywhere for consistency.

## Out of Scope (YAGNI)

WYSIWYG / rich-text; an insert/formatting toolbar; autocomplete; HTML linting or validation; changing the `{{CONTENT}}` template model; changing server-side sanitization; any non-HTML textareas (e.g. plain-text fields, feature-flag values).

## Decisions (locked during brainstorming)

- **Style:** code editor with highlighting — HTML stays raw/visible. Not WYSIWYG, not a toolbar.
- **Scope:** all four raw-HTML editors, via one shared component.
- **Direction:** editor is **LTR** (standard for code); Hebrew content renders right-to-left within each line via Unicode bidi. Not an RTL editor.
- **Library:** CodeMirror 6.

## Library

**CodeMirror 6** via `@uiw/react-codemirror` (React wrapper) + `@codemirror/lang-html`.

Rationale: delivers the full chosen feature set (highlighting, line numbers, auto-indent, close/match brackets) out of the box, has a maintained React wrapper, supports LTR-with-bidi, and is tree-shakeable and lazy-loadable. ~150 KB, confined to the admin route chunks. Rejected: `react-simple-code-editor + Prism` (no line numbers / bracket matching / auto-indent — fails the feature set); Monaco (megabytes, IntelliSense overkill).

## Architecture

### Component — `src/components/admin/HtmlCodeEditor.tsx`

A thin wrapper over `@uiw/react-codemirror`, the single unit every raw-HTML field uses.

**Props:**
```ts
interface HtmlCodeEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  minHeight?: string   // default e.g. '9rem' (≈ the current rows={6})
}
```

**Configuration:**
- Extensions: `html()` language, line numbers, `bracketMatching`, `closeBrackets`, auto-indent, `EditorView.lineWrapping`.
- Direction: **explicitly `dir="ltr"` on the editor container** — the app sets `document.documentElement.dir="rtl"`, so the editor would inherit RTL unless it forces LTR. With the container LTR, Hebrew runs still render right-to-left within each line via Unicode bidi.
- Light theme consistent with the admin surface; bordered container matching the current field styling (`rounded border`, same text size).
- `value`/`onChange` are plain strings — a drop-in signature match for the textareas being replaced.

**Lazy loading:** the component `React.lazy`-loads the CodeMirror-backed editor behind `<Suspense>`, with a plain `<textarea>` (same `value`/`onChange`/`placeholder`) as the fallback. This keeps CodeMirror out of the public/main bundle and off the admin pages' initial paint. The fallback also means the field degrades gracefully if the chunk fails to load.

### Integration (the four call sites)

Each `<textarea …/>` is replaced with `<HtmlCodeEditor value={…} onChange={setX} placeholder={…} ariaLabel={…} />`. No change to surrounding state, submit handlers, the `beautify` action, the `{{CONTENT}}` substitution, or the `<iframe srcDoc>` previews — they all read the same string state as before.

### Unchanged

- **Server-side sanitization** (`server/services/html-sanitizer.ts`) on letter/template save is untouched — the editor emits a raw HTML string exactly as the textarea did.
- **Live previews** (`iframe srcDoc`) — untouched.

## Testing

- **`tests/components/HtmlCodeEditor.test.tsx`** — the component renders its initial `value`, and editing invokes `onChange` with the new string. Since CodeMirror's contenteditable DOM does not behave under happy-dom, the test exercises the component's contract at the wrapper level (render + a change event), not real CodeMirror keystroke handling.
- **Existing page tests** — `AdminLettersComposer.test.tsx` and `LetterDetailEditing.test.tsx` currently type into the body via `getByPlaceholderText(/<p>/)` + `user.type`. They will **mock `HtmlCodeEditor` to a plain `<textarea>`** that forwards `placeholder`/`value`/`onChange` (a one-line `vi.mock` per file). This preserves their existing behavioral assertions without driving CodeMirror in happy-dom. No assertion changes beyond the mock.
- **Full gate** — `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass. The build step doubles as the bundle check.

## Bundle

Verify `npm run build` keeps CodeMirror in the admin route chunks (`AdminLettersPage`, `AdminPanel`), not the main `index` bundle. The admin pages are already code-split, so the lazy import lands there.

## Risks / Notes

- **happy-dom + CodeMirror:** real editor interaction isn't unit-testable there; mitigated by the mock-to-textarea strategy above (page behavior) plus the wrapper-level component test. Real typing/highlighting is verified manually in the browser.
- **Bundle size:** ~150 KB added, admin-only and lazy — acceptable for an internal admin tool; the build check confirms placement.
