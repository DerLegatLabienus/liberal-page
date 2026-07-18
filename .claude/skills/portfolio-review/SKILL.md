---
name: portfolio-review
description: Regenerate docs/portfolio-review.md — a portfolio-ready review of this project's architecture, stack, services, demonstrated backend skills, solved technical issues, and a concepts-in-context glossary (every technical idiom/buzzword mapped to where it lives in this repo), mined from the repo docs, git history, and BACKLOG.md. Use when the user wants to introduce the project, refresh the portfolio report, prepare interview material, or summarize what was built and what problems were solved.
triggers:
  - portfolio review
  - introduce the project
  - summarize architecture and solved issues
  - interview preparation summary
  - technical terms glossary
---

# Portfolio Review — Extraction Process

Produces/refreshes `docs/portfolio-review.md`: one document combining (a) an architecture &
technology review and (b) a "technical issues seen and solved" retrospective, written for a
developer-portfolio / interview audience.

## Inputs (all in-repo — no external sources needed)

| Source | What it yields |
|---|---|
| `docs/architecture.md` | stack table, folder structure, subsystem descriptions (auth, poller, email, share pages, DB module) |
| `docs/data-schema.md` | table inventory, domain-schema grouping, design principles |
| `CLAUDE.md` | API route table, deploy workflow, external data sources |
| `package.json` | dependency list → technology stack table |
| `BACKLOG.md` | ✅ resolved items (each is a solved-problem story), 🔲 open items (honesty section), and the "Code Review Findings" passes (self-found issues) |
| `docs/superpowers/specs/` | count + filenames = evidence of design-before-build habit |
| git history | scale stats and the fix/revert commit log |

## Ordered steps

1. **Gather scale stats** (prefer context-mode `ctx_batch_execute` so raw output stays out of
   context; plain Bash otherwise):
   ```bash
   git rev-list --count HEAD                          # commit count
   git log --reverse --format=%ad --date=short | head -1   # project start date
   find src server tests -name '*.ts' -o -name '*.tsx' | wc -l
   find src server -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1
   find tests -name '*.test.*' | wc -l
   ls server/db/migrations | wc -l
   ls server/routes
   ls docs/superpowers/specs | wc -l
   ```
2. **Mine solved problems** from three streams:
   - `git log --oneline --no-merges | grep -iE '^\w+ (fix|revert|hotfix)'` — read subjects for
     root-cause stories (races, CORS, bidi, OData quirks, reverts).
   - `BACKLOG.md` ✅ items — each carries the problem, the fix, and often the file paths.
   - `BACKLOG.md` "Code Review Findings" passes — issues found via self-review; note which were
     fixed vs. consciously deferred.
3. **Extract the concepts-in-context glossary** — sweep the same corpus (architecture doc,
   BACKLOG, specs, commit subjects) for recurring technical idioms/concepts/buzzwords, and for
   each write ONE line: *how it fits this project* (the anchoring file, feature, or incident) —
   never a textbook definition. Group by category: Security & auth / Data & persistence /
   Resilience & operations / Web platform & i18n / AI / Testing & process.
   **Rule: no orphan buzzwords** — a term that can't be pointed at a concrete repo location or
   incident gets dropped, not padded.
4. **Synthesize** into `docs/portfolio-review.md` with this section skeleton (keep it — reruns
   should diff cleanly):
   1. What the project is (one paragraph + bolded scale stats)
   2. Architecture points (bulleted, each = one defensible claim)
   3. Technology stack (table)
   4. What it demonstrates as a backend engineer (numbered, honest claims only)
   5. Technical issues seen and solved — themed subsections: Security / External APIs /
      RTL-Hebrew / Infrastructure & cost / Self-found via review / Frontend
   6. Technical glossary — concepts in context (one table per category,
      columns: Term | How it fits this project)
   7. Framing tips for interviews
5. **Stamp** the generation date at the top and write with the native Write tool.
6. Commit per the repo workflow (solo master, gate, push).

## Success criteria

- Every claim in the report is backed by something in the repo (a commit, a BACKLOG entry, a
  spec, or code) — nothing aspirational.
- Scale stats are regenerated, not copied from the previous version.
- Solved-issue entries follow problem → fix → (optional) lesson; each is tellable in 60 seconds.
- Every glossary term is anchored to a specific file, feature, or incident in this repo, phrased
  as "how it fits here" — usable verbatim as an interview answer to "have you worked with X?".
- Open/known bugs are mentioned (honesty reads better than a flawless facade).

## Pitfalls

- **Don't dump raw git logs or full doc files into the conversation** — batch + query via
  context-mode, or pipe through `grep`/`head`.
- Commit subjects alone can mislead — when a fix looks significant, confirm the story against
  BACKLOG.md or the spec before presenting it as a narrative.
- The strongest stories are already known — SSRF hardening, refresh-token rotation race, Resend
  webhook revert, `LastUpdatedDate` data-quality incident, satori bidi. New sessions should check
  for *newer* stories (recent commits since the report's generation date) rather than re-deriving
  these.
- The report is a generated artifact: regenerate whole sections rather than hand-patching stats.
- Glossary discipline: definitions-in-context only ("SSRF — `url-guard.ts` allowlists doc hosts…"),
  never generic definitions; and resist inflating the list — a dropped weak term costs nothing,
  an unanchored buzzword undermines the whole document's credibility.
