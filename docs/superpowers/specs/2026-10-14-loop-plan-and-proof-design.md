# The loop: a plan you approve, and proof you can trust

**Date:** 2026-10-14
**Status:** draft for the developer's review. Nothing here is built.
**Tier:** feature. It changes what the unattended loop may do, so it is pushed with the routine
paused and followed by a supervised run.
**Builds on:** `docs/superpowers/specs/2026-10-13-backlog-to-github-issues-design.md` (the backlog
and the picker as they are today) and
`docs/research/2026-10-09-loop-quality-and-complexity-routing.md` (evidence from the loop's PRs).

## Summary

The goal is to raise the complexity of work the unattended loop can handle. Its PRs so far each
touched one source file, because only small, fully specified tasks were given to it. This is the
first, deliberately small step towards giving it more:

1. **A plan before the code**, for anything that is not small. The loop posts a plan on the
   issue and builds only after a person approves it.
2. **Proof produced by scripts**, in every PR: the gate, and that the tests fail without the
   change.
3. **Risky-tier work opens to the loop**, once a plan naming the risky area is approved.

The loop stays what it is: a daily Claude Code cloud routine that opens pull requests the
developer merges by hand. One issue, one PR.

## What is left for later

A fuller design was drafted and discussed on 2026-10-11 but never approved or committed. These
parts of it are **not** in this version:

- Parked work and mid-task questions. A stuck run posts a blocked comment, as today.
- Sub-issues, multi-part work and feature flags.
- A blocking hook, and a computed complexity score.
- The reviewers reviewing plans.
- GitHub Actions as the runner.

## How an issue flows

| Issue | What the loop does |
|---|---|
| `size:S`, not `risky` | Builds it directly from its acceptance criteria, as today, unless the change applies more widely (see Wider scope): then it posts a plan proposing the wider scope and builds after approval |
| `size:M` or `size:L` | Posts a plan and stops. Builds after approval |
| `risky`, any size | Posts a plan and stops. Builds after approval |
| No size label | Treated as needing a plan |

**One action per run.** The picker walks the eligible issues in today's order (priority, then
lowest number) and takes the first one that has something to do:

1. a review pass on an open loop PR with findings the agent may fix (unchanged);
2. an issue that is ready to build: small, or with an approved plan;
3. an issue that needs a plan, or whose plan the developer answered without approving.

An issue whose plan is waiting for an answer is skipped. The limit of three open loop PRs stops
new builds only; a run at the limit may still write a plan.

As built (2026-10-15): the issues are walked in priority order and the first with either a
build or a plan is taken, so a high-priority issue's plan is not held back by lower-priority
builds. An edited "Approved" leaves the plan waiting rather than revising it. Known limit:
deleting a later reply would make an older "Approved" the newest again; comment lists do not
show deletions, so only the prompt's rule against deleting comments covers it.

**Changed from today:** the picker no longer skips an issue because it is labelled `risky`.

## Triage and one vocabulary

*Added 2026-10-15, approved by the developer.*

**One vocabulary.** The workflow labels become the five triage labels, used by the loop, the
agent skills and the developer's sessions alike. There is no mapping between two sets of names.

| Label | Replaces | Meaning |
|---|---|---|
| `needs-triage` | new | Not assessed yet |
| `needs-info` | `needs-developer` | Questions for the author, or the loop is blocked |
| `ready-for-agent` | `loop-safe` | Assessed, clear and wanted; the loop may take it |
| `ready-for-human` | new | Wanted, but the developer builds it |
| `wontfix` | existing | Not wanted, or already done |

`type:`, `size:`, `P0`-`P3`, `risky` and `loop` stay as they are. In the rest of this spec,
`loop-safe` reads as `ready-for-agent` and `needs-developer` as `needs-info` once the rename
ships.

**One set of rules.** How issues are written, the labels, the triage checks and what the loop
may pick live in `docs/agents/backlog-rules.md`. The loop's prompt, the agent skills (through
`docs/agents/`) and `CLAUDE.md` all point there instead of keeping their own copy, so the loop's
triage, its planning and building, and the developer's own work agree on the rules.

**Triage is the loop's job.** Triage assesses an issue: is it real, is it already done, is it
clear, and who should build it. It does not decide how to build it; that is the plan.

- After its main action (review pass, build or plan), a run triages up to three issues: open
  issues with no workflow label, labelled `needs-triage`, or `needs-info` with a new reply from
  the author.
- Checks: reproduce a bug where possible; search for an existing implementation; list questions
  if unclear; decide loop or developer; set type, size and priority if missing (`P0` only for
  something broken in production; the developer may change any of them).
- Outcome: one `### loop — triage` comment with the reasoning (for a ready issue, a short brief),
  and one workflow label. Questions go out as `needs-info`, since the loop cannot interview the
  developer. A rejected issue is labelled `wontfix` and explained; the developer closes it.
- Only issues the developer wrote can become `ready-for-agent`. Other people's issues can end at
  `needs-info`, `ready-for-human` or `wontfix`; to hand one to the loop, the developer restates
  it in an issue of their own.
- **An issue the loop marked ready is always planned and approved before it is built**, whatever
  its size. Issues the developer marked ready follow the size rule. The picker tells them apart by
  the latest triage comment: the loop's carries the Claude app's stamp. Label events are not
  used for this: on the loop's PRs some carried the stamp and some (PR #4's label, every
  assignment) did not.
- The developer does not run `/triage` separately.

**Picker changes.** It takes only `ready-for-agent` issues, and skips any that also carry
`needs-triage`, `needs-info`, `ready-for-human` or `wontfix`, or that have an open blocker
(GitHub's issue dependencies, which `/to-tickets` uses for "blocked by").

**The rename is risky tier.** Besides the picker, its tests, the loop's prompt and `CLAUDE.md`,
the two reviewer workflows (`.github/workflows/pr-review.yml`, `claude-code-review.yml`) and the
four reviewer briefs apply or mention `needs-developer`. A reviewer adding a label that no longer
exists would silently re-create it and split the vocabulary again. So the label renames on
GitHub, the code, the prompt, the workflows and the briefs ship as one change, with a plan and the
developer's confirmation before the push, and with the routine paused.

## The plan

One comment on the issue, under the heading `### loop — plan`. Every section below is
required; a section that does not apply says `None` and why in one line, so the developer can
see it was considered rather than forgotten.

**What and how**

- **Risky areas:** a fixed first line, `**Risky areas:** none` or a list from: migrations, auth,
  CI and deploy configuration, production data script.
- **New dependencies:** a fixed second line, `**New dependencies:** none`, or a list of two
  kinds. The developer should not have to read the diff to learn that either was added.
  - **Packages:** each npm package added, with its version, why it is needed, and why existing
    code or an existing package does not cover it.
  - **Cross-module dependencies:** each new import from one area of the code into another that
    the change introduces (for example a component starting to use a hook from another feature,
    a service starting to call another service, or server code importing from `src/`), with the
    direction and why. A dependency that goes against the layering below is called out as such,
    with the reason it is needed and what it would take to avoid it.
- **How `loop:guard` reads these two lines.** The guard checks the diff against them, so they
  follow a fixed form (fail-closed; `scripts/loop/guard.ts` header has the full rules):
  - `Risky areas`: `none` (optionally with a reason after ` — `, `: ` or in brackets), or a
    comma-separated list of exact area names: `migrations`, `auth`, `CI and deploy
    configuration`, `production data script` (short aliases such as `ci`, `deploy`, `prod data`
    are accepted). Any other wording is reported as unclear and fails.
  - `New dependencies`: one item per package or import. The item starts with the package
    (`name` or `name@version`) or the `A → B` pair (an area, a file or a folder on each side);
    the explanation follows after ` — `, ` - `, `:`, `(`, `,` or `;`. An item whose start holds a
    negation (`no`, `not`, `without`, `considered`, `rejected`) declares nothing; the explanation
    may hold negations.
  - A layering exception is the import's item with `exception: <reason>`, the reason at least
    three words.
- **Approach**, in a few sentences.
- **Wider scope.** Whether the same change applies beyond the issue: the same pattern in other
  modules, or other open issues that ask for the same kind of change. See Wider scope below.
- **Modules.** An overview of the modules involved (route, service, repository, component,
  hook, script): what each one is responsible for today, and what each one gains or loses in
  this change.
- **Where the logic lives.** If the change puts related logic in more than one module, or
  touches logic that is already spread across modules, the plan says so and either justifies
  it (for example a shared type in `src/types.ts` used by both frontend and server) or proposes
  where it should be consolidated. The repository layer, the single OData access point and
  the shared types are the patterns to follow; a plan that bypasses one says why.
- **Sequence diagram.** A small Mermaid sequence diagram of the main path the change adds or
  alters (for example browser, route, service, repository, database, external API). GitHub
  renders Mermaid in comments. A few participants and messages, not the whole system.
- **Files** it expects to touch.
- **Commits.** The work as an ordered series of commits, each a self-contained step that can be
  reviewed on its own, with what each one does.
- **Tests.** A named test for each acceptance criterion in the issue.

**Running it in production**

- **Logging.** What the change logs, at which level, and where (the server's console logs as
  read on Render, or the browser console). Log lines name events and identifiers, not content.
- **Privacy of logged data.** Confirms that no personal data is logged: no email addresses,
  phone numbers, names of private people, tokens, letter or draft bodies, or request bodies.
  Where an identifier is needed, it uses an internal ID. Anything new that could carry
  personal data is named here, with how it is kept out.
- **Monitoring.** How a failure would be noticed: the `/api/health` check, an error log line,
  an existing admin view, or nothing. If nothing would notice, the plan says so plainly.
- **Metrics.** The numbers that would show the change works or is failing (for example a
  route's error count, a counter the app already records, a rate-limit hit count), and where
  each is read today. A new metric is proposed only if no existing signal covers it.
- **Security.** The change's attack surface: new or changed routes and who can call them,
  input validation, auth and admin gating, rate limiting, SSRF exposure through outbound
  fetches (the URL guard), HTML sanitising, secrets, and anything the change makes public.
  Each item is addressed or marked `None`.
- **Safe to merge.** What production looks like after the merge.
- **Fit.** How the change fits `docs/architecture.md` and the non-functional requirements,
  citing the ones that apply.

**Wider scope.** Before planning, the loop looks for the same problem elsewhere: the same
pattern in other modules (for example the same hardcoded colours in other components), and
other open issues that ask for the same kind of change. The colour-token work is the example:
six issues, one component each, delivered one a day, when one PR could have covered several.

- **Propose, don't assume.** The plan lists what it would add: each extra module, and each other
  issue it would close. The developer approves or trims the list in the approving reply. Nothing
  outside the original issue is touched without that approval, which is why a small issue whose
  change applies more widely gets a plan instead of being built directly.
- **Only while the PR stays small.** Widening is offered only if the result is still one
  reasonably small PR. If the pattern is wider than that, the plan builds the original issue
  (plus what fits) and lists the rest as suggested follow-up issues, with their files. The loop
  never files issues; the developer does.
- **Folded-in issues must be eligible on their own:** open, written by the owner, labelled
  `loop-safe`, not `needs-developer`, and with no loop PR. Their acceptance criteria and their
  Out of scope sections apply as if each were the issue being built. A folded-in issue that is
  `risky` adds its area to the plan's `Risky areas` line.
- **One PR closes them all.** The PR body says `Closes #N` for each folded-in issue, so GitHub
  closes them on merge. The picker already skips any issue a loop PR's body references, so a
  folded-in issue is not picked up again while the PR is open.
- **Partial cover.** If a folded-in issue is only partly done, the PR says `Refs #N` for it and
  lists what remains, as for the main issue.

**Length.** The developer should be able to approve a plan in a few minutes. Sections are a
few lines each; a `size:M` plan is expected to fit on one screen apart from the diagram.

**The non-functional requirements page.** `docs/nfr.md` does not exist; the requirements are
scattered across about fifty specs. It is drafted from the existing docs as part of this work
(security, privacy, logging and monitoring, performance, accessibility, RTL and language, cost,
availability) and
corrected by the developer before the first trial.

**Too large.** If the work does not fit one reasonably small PR even as a series of commits,
the loop does not plan it. It uses the existing blocked path: one `### loop — blocked` comment
that says why and proposes how the issue could be cut into smaller issues, and the label swap to
`needs-developer`. The developer files the smaller issues if they agree. The loop never files
issues.

**Knowing a plan is waiting.** The loop posts under the developer's account, so GitHub sends no
notification for its comments. When it posts a plan it adds the label `plan-ready`, and removes
it when the plan is approved or revised. The label is a signal for the developer only; the
picker does not use it to decide anything. Each run's report also lists the plans awaiting an
answer.

## Approving a plan

A plan is approved by a comment that meets all four conditions. The picker checks them in code;
the agent does not judge whether a reply is an approval.

1. **It begins with "Approved"** (any capitalisation). Text after that word amends the plan.
2. **Its author may approve:** the repository owner, or someone with write access (GitHub's
   author association `OWNER`, `COLLABORATOR` or `MEMBER`). Today that is the owner alone.
   GitHub's "contributor" badge is not enough: it means anyone who once had a commit merged.
3. **It was typed by a person:** GitHub's `performed_via_github_app` field on the comment is
   empty.
4. It is newer than the latest plan comment. A revised plan needs a new approval.

Any other comment from an approver after the plan is feedback: the next run revises the plan.

**Why the third condition is the safeguard.** The loop posts under the developer's account, so author
alone cannot tell them apart. GitHub records the app a comment was posted through. Checked on
this repository's real comments on 2026-10-14:

| Comment | Author | Posted through |
|---|---|---|
| The loop's review-pass comment on PR #6 | the developer's account | the Claude app |
| The developer's own comment on PR #9 | the developer's account | nothing |
| The four reviewers | `claude[bot]` | the Claude app |

The loop cannot remove that stamp, so it cannot approve its own plan, by mistake or otherwise.

**The same stamp identifies the loop's comments.** Today the picker hides the loop's comments
from itself by their `### loop — ` heading. It will treat a comment as the loop's when it
carries the app stamp **or** that heading, and as the developer's only when it has neither.

A Claude session on the developer's own machine posts through the developer's login with no
stamp, so GitHub cannot tell it from the developer. That lane is one the developer is driving;
the rule there is that a session never posts an approval on the developer's behalf.

## Building

As today, with these changes.

1. **The plan is the brief.** For a planned issue the run reads the approved plan, including
   the wider scope as approved (or as trimmed in the reply),
   anything the developer added after "Approved", and follows its commit series.
2. **Commits as review steps.** The PR is the series of commits the plan listed. The developer
   squashes on merge, so only the whole PR has to be safe to merge; the commits exist to make
   review easier.
3. **Proof by script**, before the PR opens (next section).
4. **Review inside the run.** All four reviewer briefs (`code`, `security`, `architecture`,
   `domain`) run on the diff as fresh subagents that see the diff, the issue and the plan, not
   the session's reasoning. Findings marked `Needs: agent` are fixed, and the proof is run
   again. Findings marked `Needs: developer` are listed in the PR, which is then labelled
   `needs-developer`.
5. **The real-app check** the issue's definition of done asks for is attempted. If the app
   cannot be run in the cloud session, the PR says so plainly, never "passed", and is labelled
   `needs-developer`.
6. **The PR body** carries the plan (or a link to it) and the script output exactly as printed.
   The agent does not describe these results in its own words.

The four reviewers that run on the PR afterwards, and the single review pass, do not change.

## Proof by script

Three commands. Each prints a fixed-format block that starts with a marker comment, so a later
check can find it.

**`loop:gate`** runs the four gate commands itself and reports each one's result and telling
line, with the commit it ran at.

**`loop:proof`** shows the tests mean something.

- **Fix or feature:** the test files the branch adds or changes are run twice. On `master`'s
  source at least one must fail; on the branch all must pass. A test that passes either way
  proves nothing, and the proof fails.
- **Refactor** (a `refactor/` branch): no existing test logic may change, only import and mock
  paths, and the suite must be green on `master`'s source and on the branch.
- Docs-only branches are exempt.
- As built (fail-closed; `scripts/loop/proof.ts` header): a file passes only when vitest marks
  the file passed and the run exits 0; a file that cannot load on `master`'s source counts as
  failing there only when it is new on the branch; a refactor also fails when it changes test
  support files under `tests/`, `vitest.config.ts`, `src/test-setup.ts`, `src/__mocks__/` or a
  snapshot, or the names a test imports; an explicit `--base` resolves to its merge base with
  the branch.

The run on `master`'s source uses a temporary git worktree outside the repo, with
`node_modules` linked in, removed afterwards. The working tree is never modified.

**`loop:guard`** checks the diff against the rules for risky work and new dependencies (next
section). It runs on every build, risky or not.

A prototype of the first two was built and discarded on 2026-10-10. The proof worked end to end
in a throwaway copy of the repo: a real fix was reported as proved (1 failed and 2 passed on
`master`'s source, 3 passed on the branch), a test that passes either way as not proved, and a
branch with no tests as such.

## Risky work

The risky tier (database migrations, auth and access control, CI and deploy configuration,
production data scripts) is open to the loop when the approved plan names the area.

**Rules, checked by `loop:guard` on the real diff:**

| Rule | Check |
|---|---|
| The plan named it | The diff's paths are sorted into risky areas. An area the diff touches that the plan's `Risky areas` line does not list fails the check |
| Packages were declared | Packages added to `package.json` (dependencies or devDependencies) are listed. Any the plan's `New dependencies` line does not name fails the check. The list is printed in the PR body either way |
| Cross-module dependencies were declared | An import scan of `master` and of the branch lists every new import from one area into another (areas below). One the plan does not name fails the check. The list is printed in the PR body either way |
| Layering is respected | A new import that goes against the layering below fails the check unless the plan names it as an exception with a reason |
| Guardrails stay closed | Any change under `scripts/loop/**`, `.claude/**`, the reviewer workflows (`pr-review.yml`, `claude-code-review.yml`, `claude.yml`) or `scripts/loop-read-views.sql` or `docs/agents/**` (the rules the loop follows) fails the check |
| Migrations apply | Every migration is applied to a fresh in-memory database, as the repo's tests already do, and the result is printed |
| Schema changes only add | A new migration containing a drop, a rename or a type change fails the check. As built: any `DROP` fails except `DROP INDEX`, `DROP CONSTRAINT`, `DROP NOT NULL`, `DROP DEFAULT` and exactly `DROP SCHEMA [IF EXISTS] loop_read CASCADE`; `TRUNCATE`, `DELETE FROM` and dynamic SQL (`EXECUTE`) also fail; editing a migration already on `master`, or a `.sql` file the journal does not list, fails |
| Packages come from the registry | A package added or changed to an `npm:`, git, `file:`, `link:` or URL source fails whatever the plan says. Changes to `package.json` `scripts`, install hooks or `overrides` count as CI and deploy configuration; a change to a `loop:*` script is a guardrail change |

**Areas and layering**, as the code is organised today. Areas: `src/components`, `src/hooks`,
`src/contexts`, `src/lib`, `src/pages` and other `src/` folders, `server/routes`,
`server/services`, `server/repositories`, `server/db`, `server/middleware`, `scripts`.

- `src/` never imports from `server/`.
- `server/` imports from `src/` only the shared types (`src/types.ts`) and pure helpers in
  `src/lib/` (today `letter-urls` and `phone`).
- Routes call services, repositories and middleware; outside the tests, nothing but
  `server/index.ts` imports a route. Imports from `tests/` are not checked against the layering.
- Repositories own database access; routes do not import `server/db` directly.
- Repositories do not import services. Three existing imports break this
  (`letter-channels-repository` uses `html-sanitizer` and `letter-utils`;
  `committees-repository` uses `committee-status`). They are pure helpers and are recorded as
  known exceptions; they are not flagged, but a plan that touches them may propose moving the
  helpers.

Only imports that are new on the branch are checked; everything already on `master` is the
baseline. The import scan is the one prototyped on 2026-10-10 (a regex over `import`, `export
from`, dynamic `import()` and `vi.mock`, resolving the `@/` alias and relative paths), which
covered 386 files and matched the research note's counts.

When a check fails the run does not open the PR. It posts a blocked comment with the script's
output.

**Rules that are instructions only:**

- The loop holds no production credentials and runs nothing against production. It may write
  and test a production data script; the developer runs it.
- The safe-to-merge statement in the plan must be true of the finished PR.

A change that needs a drop, a rename or a type change cannot be done safely in one PR. The loop
hands it back through the blocked path. It becomes possible when multi-part work is added.

## What changes in the repo

| File | Change |
|---|---|
| `scripts/loop/select-item.ts` | `risky` no longer excludes an issue; an issue's state (build, plan, waiting) is derived from its size and risky labels and its comments |
| `scripts/loop/issue.ts` | Comments carry the app stamp and the author association; the loop's comments are recognised by stamp or heading; the plan, its approval and any feedback are found here |
| `scripts/loop/next-item.ts` | A new action `plan`; `new` carries the approved plan for a planned issue |
| `scripts/loop/gate.ts`, `proof.ts`, `guard.ts` | New commands |
| `scripts/loop/PROMPT.md` | A Plan section; the build steps above; the hard limit on the risky tier replaced by the rules here; the guardrail list |
| `docs/nfr.md` | New, drafted then corrected by the developer |
| `CLAUDE.md`, the workflow spec | The loop's rules updated to match |
| GitHub | One new label, `plan-ready`; the workflow labels renamed (see Triage and one vocabulary) |
| `docs/agents/backlog-rules.md` | The one source for issue rules; the loop's prompt points to it |
| `.github/workflows/pr-review.yml`, `claude-code-review.yml`, `.claude/agents/*-reviewer.md` | `needs-developer` becomes `needs-info` (risky tier, part of the rename) |

No file under `.github/` or `.claude/` changes.

## Not verified, and what happens if it fails

| Assumption | If it does not hold |
|---|---|
| Every comment the cloud routine posts carries the app stamp. Seen on one comment so far | Approval cannot be told from the loop's own comment. Risky work stays closed until a different safeguard exists; planning for non-risky work can continue on the heading filter |
| A comment the developer posts from GitHub's own web or mobile app carries no stamp. Seen for the web and for the `gh` CLI | The developer's approvals from that client would be ignored; they approve from a client that works |
| The reviewer briefs can run as subagents in the cloud session | The session reviews against each brief itself, and the PR says so |
| The app can be started in the cloud session | PRs are labelled for the developer's check, as designed |

The supervised trial tests the first three.

## Known costs and risks

- **Elapsed time.** One action per run and one run a day: a planned issue takes at least two
  days, more if the plan is revised.
- **Tokens.** Four reviewers run inside every build.
- **Risky work rests on few safeguards:** the approved plan, the guard script, the reviewers and
  the developer's merge. A merged migration applies itself on the next deploy.
- **`CLAUDE.md` is not a guardrail path**, because ordinary work must update it. A loop PR could
  reword the loop's own rules there; the reviewers and the merge are the only check.
- **The refactor check is textual.** It compares test files after setting aside import and mock
  path lines.

## Success measures

1. The developer labels a `size:M` or `size:L` issue `loop-safe`, approves its plan, and merges
   the PR without editing it.
2. Every code PR carries the gate and proof blocks.
3. The reviewers that run on the PR report fewer findings than the five across the first six
   loop PRs.
4. One risky-tier issue reaches `master` through the loop. The first candidate is the
   type-check gap (LibPage-018 in its issue title).

## Build order and rollout

Built in the trunk lane. Each step is testable before the next.

0. **The vocabulary rename**, as one risky-tier change (see Triage and one vocabulary), with the
   routine paused. Everything after it uses the new names.
1. `docs/nfr.md`, drafted and corrected.
2. The proof commands: `loop:gate`, `loop:proof`, `loop:guard`.
3. The picker: the app stamp, approval, the `plan` action, `risky` eligibility. Tested read-only
   against the repository's real issues and comments.
4. `PROMPT.md`, `CLAUDE.md` and the workflow spec; the `plan-ready` label.
5. **Supervised trial**, with the routine paused from the push of step 4 until it passes:
   - a planning run on a chosen `size:M` issue, checking the plan comment carries the app stamp;
   - the developer's approval, checking the picker accepts it and rejects a comment the loop
     posted;
   - a build run from that plan.

   A risky issue is trialled the same way before risky work is relied on.

Steps 1 and 2 add things the current prompt does not call, so they can be pushed as they are
finished. Steps 3 and 4 change the next unattended run and are pushed together.

## Tests

- Pure logic gets unit tests in `tests/unit/loop/`: state derivation, plan and approval
  detection (author, stamp, order, wording), the guard's path sorting and migration scan, the
  proof verdicts, the block formats.
- Commands that touch git or GitHub are thin wrappers. Read-only GitHub calls are run for real
  during the build; anything that writes to GitHub happens only in the supervised trial or with
  the developer's go-ahead.
