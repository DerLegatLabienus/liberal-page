# Backlog in GitHub Issues

**Date:** 2026-10-13
**Status:** approved by the developer on 2026-10-14 and implemented the same day. The issues were created
on 2026-10-13 and 2026-10-14 (issues #12 to #35).
**Tier:** feature (it changes how the unattended loop picks its work).
**Builds on:** `docs/superpowers/specs/2026-10-04-solo-dev-workflow-design.md`.

## Summary

`BACKLOG.md` is replaced by GitHub Issues, used as the project's task tracker. Each backlog item
becomes an issue written as an agile item, with labels for type, size and priority. The loop
keeps working as it does today, one item per run, but picks from issues instead of the file.

This is deliberately the whole change. Planning, complexity scoring, hooks and a status board
were considered and left out.

## Why

- **Loop PRs conflict with each other.** Every loop PR deletes its item's section and its list
  line from `BACKLOG.md`, and those lines sit next to other loop items. Three loop PRs are open
  today and each edits that file.
- **A file is a poor tracker.** It has no types, sizes, filters or links to the PRs that close an
  item.

## Out of scope

- A GitHub Projects board and any status tracking beyond open and closed. The loop's cloud
  session cannot reach the board API, and keeping a board current by hand is not worth it now.
- Epics, sub-issues, sprints and milestones.
- A GitHub issue form. It would live under `.github/`, which is risky tier. The structure is
  documented in `CLAUDE.md` instead.
- Any change to what the loop is allowed to work on, how it builds, or how it is reviewed.
- Code that stops the loop from filing issues or adding `loop-safe`. In this version those are
  instructions in its prompt.

## How an issue is written

Title: the item's name, with `(LibPage-NNN)` appended for migrated items. New issues have no
such suffix; the issue number is the ID.

Body:

| Section | Content |
|---|---|
| **Request** | Who needs what, and why |
| **Context** | What exists today, with file paths and links |
| **Acceptance criteria** | A checklist of observable outcomes |
| **Out of scope** | What not to touch |
| **Definition of done** | The standard list below, adjusted for spikes and risky work |
| **Original notes** | For migrated items only: the backlog text as it was, unedited |

Standard definition of done:

- every acceptance criterion is met, and covered by a test where it can be;
- the gate is green (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`);
- docs the change makes stale are updated;
- a visible change was checked in the running app, a route with `curl`;
- merged to `master`.

A spike is done when its spec is written and the developer has accepted it. Risky-tier work adds
a spec, a plan and the developer's confirmation before the push, as `CLAUDE.md` already requires.

## Labels

| Group | Labels | Meaning |
|---|---|---|
| Type | `type:story`, `type:bug`, `type:task`, `type:spike` | User-facing capability; defect; technical work; design or investigation |
| Size | `size:S`, `size:M`, `size:L` | A rough estimate for the developer. It does not gate the loop |
| Priority | `P0`, `P1`, `P2`, `P3` | `P0` is reserved for something broken in production |
| Loop | `loop-safe`, `risky`, `needs-developer`, `loop` | As today's `[loop-safe]` and `[risky]` tags; `loop` marks the loop's PRs |

`loop` and `needs-developer` exist already. The rest are created at cut-over.

The old lists map to priorities as **Now → P1, Next → P2, Later → P3**.

## How the loop picks

The picker (`npm run loop:next`) reads issues over REST. It takes the first issue that is:

- open, and not a pull request;
- written by the repository owner;
- labelled `loop-safe`, and labelled neither `risky` nor `needs-developer`;
- without a loop PR, open or closed, that names it.

A loop PR is a pull request the repository owner opened from a branch in this repository, on a
branch of the shape `<type>/<number>-slug` or carrying the `loop` label. A PR from a fork never
counts, whatever its branch is called. A loop PR names an issue through its branch, the `(#N)`
at the end of its title, or a `Closes #N` / `Refs #N` line in its body; a PR from before the
move names it through the `LibPage-NNN` ID the issue keeps in its title.

`needs-developer` refuses an issue so that one the loop handed back stays out of the queue even
if removing `loop-safe` failed.

Order: `P0`, `P1`, `P2`, `P3`, then no priority label; the lowest issue number first within a
level. The limit of three open loop PRs and the review pass are unchanged.

The exclusion rule is today's rule keyed on the issue number: an issue that ever had a loop PR is
not taken again. To retry one, the developer files a new issue.

## What the loop reads and writes

- **Reads:** the issue body, and the developer's comments. A command
  (`npm run -s loop:issue -- 123`) prints them. It keeps only comments by the repository owner
  and drops any that carry a `### loop — ` heading, because the loop posts as the
  developer's account and must not read its own comments as instructions. It refuses an issue
  the owner did not write.
- **Branch and PR:** `<type>/123-short-slug`; title ending `(#123)`; body `Closes #123`.
  If only part of the issue is done, the body says `Refs #123` and lists what remains, and the
  loop swaps the issue's `loop-safe` for `needs-developer`.
- **Blocked:** one comment under `### loop — blocked` saying what was tried, why it stopped and
  what it would take; then `loop-safe` is swapped for `needs-developer`, with `risky` added if
  that is the reason. No docs-only PR. If the comment or a label change fails, the run says so
  at the top of its report. To retry, the developer answers in a comment, puts `loop-safe` back
  and removes `needs-developer`.
- **Never:** files an issue, adds `loop-safe`, or edits an issue's body.

The three loop PRs open at cut-over keep their `LibPage-NNN` branch names. The picker still
recognises that branch shape, so they count toward the open-PR limit and can still get their
review pass.

## In the developer's own sessions

When a session finds something that belongs in the backlog, Claude proposes the issue (title,
body, labels) and creates it only after the developer approves. Issues are public and cannot be
cleanly unsent. This replaces "add it to `BACKLOG.md` and commit immediately".

## Cut-over

1. Every backlog item is drafted as an issue, and the developer reviews the full list: titles,
   labels and bodies. Items that turn out to be finished are dropped instead of migrated.
2. After the developer's go-ahead, the labels and the issues are created. The three items with
   open PRs get issues without `loop-safe`.
3. One push to `master`: the picker, the issue reader, their tests, `scripts/loop/PROMPT.md`,
   the docs and briefs that name the backlog file, and the deletion of `BACKLOG.md`.
4. For each open loop PR (#9, #10, #11): one commit on its branch drops its `BACKLOG.md` edit so
   it no longer conflicts, and `Closes #N` is added to its body.

The loop does not need pausing. Between steps 2 and 3 the old picker still reads the file; after
step 3 the new one reads issues.

## Files

- `scripts/loop/next-item.ts`, `scripts/loop/select-item.ts`, a new `scripts/loop/issue.ts`.
- `tests/unit/loop/select-item.test.ts`, and a test for the comment filter.
- `scripts/loop/PROMPT.md`: steps 1, 2, 6 and 7, the GitHub commands table, Blocked, and two
  lines in Hard limits.
- `CLAUDE.md`, `README.md`, `docs/README.md`, `docs/architecture.md`,
  `.claude/agents/product-manager.md`, `.claude/skills/portfolio-review/SKILL.md`, and a note in
  the 2026-10-04 workflow spec.
- `BACKLOG.md` is deleted. Older specs, plans and research notes that mention it are history and
  stay as they are.

## Not verified

- That the loop's cloud session can comment on issues and change labels over REST. Its pull
  request calls work today, so this is expected to work; the first unattended run shows it. If
  it cannot, the blocked path falls back to saying so in the run's report.

## Known limits

- **The loop acts as the developer's GitHub account.** GitHub cannot tell an issue or a label the
  loop created from the developer's. "Never files issues, never adds `loop-safe`" is therefore
  only as strong as the prompt.
- **Security items become more visible.** They are already public in `BACKLOG.md` and in git
  history; as issues they are easier to find. The developer chose to migrate them in full.

## Tests and verification

- Unit tests for the picker's selection (label filter, owner filter, priority order, exclusion by
  PR, legacy branch names) and for the comment filter.
- `npm run loop:next` and `npm run -s loop:issue` are run for real against the repository after
  the issues exist; both only read.
- Independent review of the diff against this spec before the push.
