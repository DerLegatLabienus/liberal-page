# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: this repo's glossary of domain terms (Letter, Channel, Sender
  and the like). It plays the role the skills call `CONTEXT.md`; there is no separate `CONTEXT.md`.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **`docs/architecture.md`** and **`docs/design-system.md`**: how the code is organised and the
  frontend rules. `CLAUDE.md` points to the rest.

If `docs/adr/` doesn't exist yet, **proceed silently**. The `/domain-modeling` skill creates it
lazily when the first decision is recorded.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md        ← the glossary (instead of CONTEXT.md)
├── docs/adr/          ← created with the first ADR
├── docs/architecture.md
├── src/
└── server/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary
explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing
language the project doesn't use (reconsider) or there's a real gap. When `/domain-modeling`
resolves a new term, it adds it to `GLOSSARY.md`, not to a new `CONTEXT.md`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
