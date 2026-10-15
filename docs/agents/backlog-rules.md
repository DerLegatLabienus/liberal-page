# Backlog rules

The one source for how issues are written, labelled, assessed and picked up in this repo. The
unattended loop (`scripts/loop/PROMPT.md`), the agent skills (through `docs/agents/`) and the
developer's own sessions (through `CLAUDE.md`) all follow this file, so they agree on the rules.
Change the rules here, not in a copy.

The loop may not edit this file or anything else under `docs/agents/`.

## Where the backlog lives

The backlog is this repository's GitHub issues (since 2026-10-14; design in
`docs/superpowers/specs/2026-10-13-backlog-to-github-issues-design.md`). There is no backlog
file. The issue number is the ID; items migrated from the old file keep `(LibPage-NNN)` in their
title.

## Creating an issue

From a developer session or a skill: propose the title, body and labels, and create the issue
only after the developer approves. Issues are public and cannot be cleanly unsent. Never add
`ready-for-agent` unless the developer asked for it.

The loop never creates issues.

## How an issue is written

Every issue is written as an agile item, with these sections:

| Section | Content |
|---|---|
| Request | Who needs what, and why |
| Context | What exists today, with file paths |
| Acceptance criteria | A checklist of observable outcomes |
| Out of scope | What not to touch |
| Definition of done | Criteria met and tested; gate green; docs updated; checked in the running app (or `curl` for a route); merged. A spike is done when its spec is accepted. Risky work adds spec, plan and confirmation |

## Labels

| Group | Labels | Meaning |
|---|---|---|
| Type | `type:story`, `type:bug`, `type:task`, `type:spike` | User-facing capability; defect; technical work; design or investigation |
| Size | `size:S`, `size:M`, `size:L` | A rough estimate |
| Priority | `P0`, `P1`, `P2`, `P3` | `P0` is reserved for something broken in production |
| Workflow | `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` | Not assessed yet; questions for the author, or the loop is blocked; assessed, clear and wanted, the loop may take it; wanted, the developer builds it; not wanted or already done (the developer closes it) |
| Other | `risky`, `loop`, `plan-ready` | Risky tier; a PR opened by the loop; the loop posted a plan that waits for the developer's answer (a signal only; the picker does not read it) |

The workflow labels are the five triage roles of the agent skills, under the same names, so
the loop, the skills and the developer's sessions use one vocabulary (since 2026-10-15,
replacing the two labels the loop used before).

## Triage: assessing an issue

Triage decides whether an issue should be done, whether it is clear, and who does it. It does
not decide how to build it; that is the plan.

**Which issues need it:** open issues with no workflow label, and issues waiting on the
developer that have a new reply from the author.

**Checks:**

1. Is it real? For a bug, reproduce it where possible and say what happened.
2. Is it already done? Search the code for the behaviour asked for, and say where you looked.
3. Is it clear enough to act on? If not, list the questions.
4. Who should do it: the loop, or the developer by hand (a judgement call, access the loop lacks,
   manual testing, or a change to the loop's own files)?
5. Set type, size and priority if they are missing. `P0` only for something broken in
   production. The developer may change any of them.

**Outcome:** one comment with the reasoning (for an issue ready for the loop, a short brief), and
one workflow label. A rejected issue is labelled and explained; the developer closes it.

**Who triages:** the developer, until loop triage ships with the design above. Then the loop
triages, after its main action, up to three issues per run, under the rules in this section; the
developer does not run triage separately. Only issues the developer wrote can be made ready for
the loop. An issue the loop itself marked ready is always planned and approved before it is
built.

## What the loop does with issues

(`scripts/loop/select-item.ts`, `scripts/loop/issue.ts`)

- It takes only open issues the repository owner wrote, labelled `ready-for-agent` and neither
  `risky` nor `needs-info`, that never had a loop PR. Most urgent priority first, then the lowest
  number. A loop PR is one the owner opened from this repository on a `<type>/<number>-slug`
  branch or with the `loop` label.
- It reads the issue body and the owner's comments (`npm run -s loop:issue -- <number>`), never
  anyone else's. Its own comments are filtered out, because it posts under the owner's account:
  a comment is the loop's when it carries GitHub's app stamp (`performed_via_github_app`) or
  begins `### loop — `.
- **`size:S` is built directly. `size:M`, `size:L` and unsized issues get a plan first.** The
  loop posts one `### loop — plan` comment, adds `plan-ready`, and stops. It builds only after
  the plan is approved, and follows the plan as its brief.
- **Approving a plan:** reply with a comment that begins `Approved` (any capitalisation). Text
  after the word amends the plan. The picker checks in code that the reply is newer than the
  plan, comes from the owner, a collaborator or a member, was typed by a person (no app stamp, no loop
  heading), and was never edited. Any other reply is feedback: the next run posts a revised plan
  as a new comment. The newest reply decides. A session on the developer's machine posts with
  no app stamp, so it never posts `Approved` on the developer's behalf.
- One action per run: a review pass first; otherwise the highest-priority issue with something
  to do, a build or a plan. An issue whose plan waits for an answer is skipped, and every run's
  report lists those plans. Three open loop PRs stop builds, not plans. Until risky work opens
  (#46), an approved plan is built only if its `Risky areas` line is an explicit `none`.
- The loop never changes `size:` or priority labels: size decides whether an issue needs a
  plan.
- Its branch is `<type>/<number>-slug`; its PR title ends `(#<number>)` and its body says
  `Closes #<number>`, or `Refs #<number>` when only part of the issue is done.
- When blocked it posts one `### loop — blocked` comment and swaps `ready-for-agent` for
  `needs-info`. To retry, answer in a comment, put `ready-for-agent` back and remove
  `needs-info`.
- It never creates an issue, never adds `ready-for-agent`, and never edits an issue's body. These
  are instructions in its prompt; nothing in GitHub enforces them.

Design: `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md`. Built so far: plans
and approval. Not built yet: proof blocks and review inside the run, risky work, wider scope and
loop triage.
