# Frontend Design System

The single source of truth for frontend/UX decisions on this site. Before adding or changing UI,
skim this and follow it. It consolidates what previously lived across the redesign spec
(`docs/superpowers/specs/2026-05-14-likud-liberal-redesign.md`), the token definitions
(`src/index.css`), the component catalog (`docs/components.md`), the RTL/i18n notes in
`docs/architecture.md`, and the `frontend-design` skill. When those disagree with real code, the
code + this doc win. Keep this doc updated when a genuinely new pattern is introduced (not for
one-offs).

The goal is **consistency**: two screens built a month apart should feel like the same product.

---

## 1. Principles

- **Hebrew-first, civic, trustworthy.** The public product is a Hebrew RTL political-engagement site;
  it should read clear and credible, not flashy.
- **Restraint over decoration.** Spend boldness in one place per screen; keep everything around it
  quiet. Cut decoration that doesn't carry information.
- **Reuse the vocabulary.** Compose from `src/components/ui/*` and the established patterns below
  before inventing markup. A new one-off style is a smell — either use an existing pattern or, if a
  real new pattern is needed, add it here.
- **Accessibility is a floor, not a feature** (see §9).

---

## 2. Color & tokens

Colors are **oklch design tokens**, defined in `src/index.css` and exposed as Tailwind utilities via
`tailwind.config.ts`. **Always use the token utilities. Never hardcode `#hex`, `slate-*`, `red-*`,
`blue-*`, etc.** in app code.

| Token utility | Role |
|---|---|
| `bg-background` / `text-foreground` | Page base |
| `bg-card` / `text-card-foreground` | Raised surfaces (cards, panels, menus) |
| `bg-primary` / `text-primary-foreground` | Brand blue — primary actions, key accents |
| `bg-secondary` / `text-secondary-foreground` | Quiet neutral fill |
| `bg-muted` / `text-muted-foreground` | Subtle backgrounds; secondary/hint text |
| `bg-accent` / `text-accent-foreground` | Hover/active neutral surface |
| `bg-destructive` / `text-destructive` | Errors, destructive actions |
| `border-border`, `border-input` | Hairline borders, field borders |
| `ring-ring` | Focus ring (brand blue) |

`--radius` is `0.625rem`; use `rounded-md`/`rounded-lg`/`rounded-xl` off it, not arbitrary pixel radii.
`--popover`, `--chart-*`, `--sidebar-*` are full `oklch(...)` values (not alpha-injectable).

**The token rule (learned the hard way).** The mapped tokens are stored as **bare oklch components**
(`--primary: 0.546 0.245 262.881`) and referenced in the config as
`oklch(var(--primary) / <alpha-value>)`. That form is what makes opacity modifiers compile
(`bg-primary/80`, `@apply outline-ring/50`). Consequences:
- Use `bg-primary`, `text-muted-foreground`, `border-border`, `bg-primary/90` — they resolve to real
  colors and support `/alpha`.
- Do **not** reintroduce `hsl(var(--x))` or bare `var(--x)` in the config — both broke rendering
  before (transparent utilities / build failure on `outline-ring/50`).
- If you catch yourself writing `bg-blue-600` as a workaround, the token is the fix, not the literal.

**Light-first.** Only the `:root` (light) palette is active. The `.dark` block exists but dark mode is
**never toggled** in code — don't design for it or rely on it; don't ship dark-only values.

---

## 3. Typography

- Font: **Heebo Variable** (`@fontsource-variable/heebo`), with `'Arial Hebrew','Tahoma',system-ui`
  fallbacks. `--font-heading` currently aliases `--font-sans` — one family, weight-differentiated.
- Hierarchy by **weight + size**, not new fonts: headings `font-bold`/`font-semibold`; body default;
  hints/labels `text-sm`/`text-xs text-muted-foreground`.
- Set numerals and short labels deliberately; avoid all-caps for Hebrew.

---

## 4. Spacing, radius, elevation

- **Spacing**: Tailwind scale; consistent section rhythm (`gap-*`, `space-y-*`). Prefer a small set of
  steps (2/3/4/6) over ad-hoc values.
- **Radius**: token-derived `rounded-md|lg|xl`. Pills use `rounded-full`.
- **Elevation**: restrained — `shadow-sm`/`shadow-lg` for raised surfaces (menus, dialogs); most
  surfaces separate with `border-border`, not shadow. Don't stack heavy shadows.

---

## 5. Direction & language

- **Public surfaces are Hebrew-first RTL.** Direction comes from `document.documentElement.dir`,
  observed via `useDirection()` (`'rtl' | 'ltr'`); language via `react-i18next` (`?lang=` or
  `localStorage`). All public copy goes through i18n keys (`src/locales/{he,en}.json`) — never
  hardcode user-facing strings on public surfaces.
- **Use logical properties**, never physical, so RTL/LTR both work: `start/end` (not `left/right`),
  `ms-*/me-*`, `ps-*/pe-*`, `text-start/text-end`, `border-s/border-e`. Mirror direction-sensitive
  glyphs with `useDirection()` (see the Tracker chevron in `layout/Header.tsx`).
- **Internal/admin tools are English + `dir="ltr"` — a deliberate exception.** The admin surfaces
  (`AdminPanel`/`AdminPage`, `AdminLettersPage`) are operator tools; they are English and LTR, and do
  **not** need i18n keys. Keep them consistent with each other, not with the public RTL site.

---

## 6. Component vocabulary

Build from `src/components/ui/*`. Reach for these; don't reimplement them.

- **`Button`** (`ui/button.tsx`) — the only button. Variants: `default` = primary CTA (solid brand);
  `outline` = secondary / utility / menu triggers (bordered); `ghost` = low-emphasis; `secondary` =
  quiet fill; `destructive` = delete/remove; `link` = inline text action. Sizes: `sm`/`default`/`lg`
  + `icon*`. Never style a raw `<button>` to look like a button.
- **`Input`** (`ui/input.tsx`) and form fields — use it for every text field. Never a bare `<input>`
  in app code. For selects, use a spec-conformant styled select (bordered like `Input`, token colors),
  not an unstyled `<select>`.
- **Overlays / navigation depth**: `Dialog` (focused, short-lived task, blocks the page) vs `Sheet`
  (edge drawer, e.g. `ParliamentDrawer`) vs a **dedicated route** (a whole workspace/section — e.g.
  admin). Rule of thumb: more than a couple of fields or sections ⇒ a route, not a modal.
- **Grouping/disclosure**: `Tabs` (peer views), `Accordion` (stacked expandable items), `Card`
  (grouped content), `Badge` (status/labels), `Separator` (dividers). Use these instead of hand-rolled
  equivalents.
- **Dropdown menu pattern**: there is no Radix menu dependency — the standard menu is the lightweight
  pattern in `layout/UserMenu.tsx` / `letters/ChannelSendButton.tsx`: a `useRef` wrapper, close on
  outside-click + `Escape`, `aria-haspopup="menu"` + `aria-expanded` on the trigger, `role="menu"` /
  `role="menuitem"` items, `bg-card border-border shadow-lg`. Copy it; don't add a new mechanism.

---

## 7. Interaction & feedback

- **Action results go through toasts**, not inline error text. `useToast()` → `toast(message, type)`
  with `type ∈ {success, error, info}` (`contexts/ToastContext.tsx`). Save succeeded → success toast;
  failed → error toast. Reserve inline messages for modal-blocked contexts where a toast would render
  behind an inert backdrop (see the login dialog).
- **Loading**: use the translucent pulsing **`Skeleton`** (`ui/skeleton.tsx`). Match the skeleton to
  what's loading:
  - *Unknown layout* (session restore, lazy-route Suspense — could resolve to any page or a denial):
    the generic **`PageSkeleton`** (`components/PageSkeleton.tsx`) — dir-neutral (no visible text, so
    it can't reproduce the RTL bidi "…Loading" bug), `sr-only role="status"`.
  - *Known layout* (a list/table/cards fetching data): a **structural** skeleton that mirrors the real
    DOM — same wrapper classes/spacing, one `Skeleton` box per element, repeated N times — so content
    lands with no layout shift. Examples: `letters/LettersListSkeleton` (member card list),
    `ui/table-skeleton` `TableSkeleton` (generic table/row-list). Co-locate a structural skeleton with
    the component it mirrors and keep it coarse (match the big boxes, not every pixel).
  - Never render bare "Loading…" text on an RTL page.
- **Disabled**: disable a submit while its request is in flight; disable invalid actions (empty field,
  self-role-toggle).
- **Inaccessible states**: a page a user can't see (permissions, a caught render error) must offer a
  way out — render **`BackToHome`** (`components/BackToHome.tsx`, a `Link to="/"` styled as an outline
  button). Broken/unknown routes already redirect home via the catch-all route in `App.tsx`.
- **Empty states**: every list renders an explicit empty state (a muted one-line "No X yet"), never a
  bare blank area.
- **Motion**: subtle and purposeful; respect `prefers-reduced-motion` (the skeleton/spinner do).

---

## 8. Layout conventions

- **Pages vs modals**: a self-contained task → `Dialog`; a whole area with multiple
  sections/workflows → a **route** with a shared shell. Admin is a route area (`/admin`,
  `/admin/letters`) — operator workspaces, not modals.
- **Header control clustering**: utility/account controls live in a right-hand cluster of real
  buttons (see `layout/Header.tsx`), not loose text links.
- **Responsive**: everything works down to mobile width; wide content (tables, code, diagrams) scrolls
  inside its own container rather than the page body.

---

## 9. Accessibility floor (non-negotiable)

- Visible keyboard focus (the `ring` token); every interactive element reachable and operable by
  keyboard; menus close on `Escape` and restore focus.
- Real semantics: `role`/`aria-*` on custom widgets; `aria-label` on icon-only controls; label every
  input.
- `prefers-reduced-motion` respected; sufficient contrast (tokens are tuned for it — don't override to
  low-contrast literals).

---

## 10. Adding UI? Do this

1. Compose from `ui/*` and the patterns above; use token utilities only (no color literals).
2. Public copy → i18n keys + RTL logical properties. Admin → English + `dir="ltr"`.
3. Feedback via toasts; give lists an empty state; disable in-flight/invalid actions.
4. Keyboard + focus + `aria`; test at mobile width.
5. More than a couple of fields/sections ⇒ a route, not a modal.
6. If you needed a genuinely new pattern, document it here.
