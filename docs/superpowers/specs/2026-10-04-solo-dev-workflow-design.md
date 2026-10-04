# Solo developer workflow: two lanes, tiered verification, a weekly PR loop

**Date:** 2026-10-04
**Status:** agreed in a grilling session, not yet implemented
**Tier (by this spec's own rules):** risky — it changes deploy and CI configuration

## Problem Statement

I am the only developer on this project. My workflow today is "let the superpowers skills drive,
run the gate, push to `master`". It works, but it feels thin as a way to build and verify software:

- "Verified" means only that tests, type check, lint and build pass on my machine. Nobody other
  than the author of a change ever reads it, and nobody watches the change work in the running app.
- Every feature gets a spec and a plan regardless of size. The repo holds 47 specs and 39 plans
  for about 700 commits, and the backlog is over a thousand lines with shipped items still in it,
  so it is hard to see what is next.
- The backend deploys on every commit to `master` whether or not CI passes, and migrations run on
  the production database at boot. A commit that fails its tests can still migrate production,
  and can leave the old frontend talking to a new backend.
- My instructions to the agent contradict each other: the global rules say worktrees merged at
  session end, the project rules say work directly on `master`.
- I want an unattended loop to improve the app for me, but nothing above is solid enough to let
  an agent work without me watching.

## Solution

A written workflow with two lanes and verification that scales with risk.

- **Trunk lane (sessions I drive).** Work directly on `master` and push automatically once the
  gate passes. How much paperwork and checking a change needs depends on its tier.
- **PR lane (unattended work).** A weekly scheduled agent takes one backlog item I have marked
  safe, opens a pull request, and stops. Four independent, separately named reviewer agents
  comment on it. I merge by hand.
- **Deploy safety.** The backend only deploys after CI passes, and a build that does not answer
  its health check never replaces the running one.
- **One queue.** The backlog file is the only list of what is next, pruned and ordered.
- **A glossary.** A terms-only file gives the domain reviewer (and every future session) a single
  definition of the project's vocabulary.

## User Stories

### Trunk lane

1. As the developer, I want my own sessions to commit and push directly to `master`, so that I
   carry no branch or PR overhead for work I am supervising.
2. As the developer, I want a push to happen automatically once the gate passes, so that pushing
   is not a separate step I have to approve.
3. As the developer, I want every change classified as trivial/fix, feature or risky before work
   starts, so that the right amount of process is applied without my asking.
4. As the developer, I want trivial changes and fixes to need no spec and no plan, so that small
   work stays small.
5. As the developer, I want a feature to need one spec and no separate plan file, so that the
   design is recorded once.
6. As the developer, I want a risky change to need both a spec and a plan, so that changes that
   can damage production are thought through twice.
7. As the developer, I want database migrations, auth and access control, production data
   scripts, and deploy or CI configuration all treated as risky, so that the definition is not
   left to judgement in the moment.
8. As the developer, I want the agent to stop and ask me before pushing a risky change, so that
   nothing irreversible reaches production without my say.
9. As the developer, I want the tier the agent chose stated at the start of the work, so that I
   can correct it before effort is spent.

### Verification in the trunk lane

10. As the developer, I want the gate (tests, type check, lint, build) to remain mandatory before
    every push, so that the baseline does not regress.
11. As the developer, I want feature and risky changes reviewed before push by one general
    reviewer agent that did not write the code, so that the author's blind spots are checked.
12. As the developer, I want that reviewer to see the diff and the spec but not the authoring
    conversation, so that its judgement is independent.
13. As the developer, I want every finding from that review fixed before the push, so that
    nothing known to be wrong reaches `master`.
14. As the developer, I want trivial changes and fixes to skip the review, so that a one-line fix
    does not cost a review run.
15. As the developer, I want any change to a user-visible flow driven in a browser against the
    local dev stack before it counts as done, so that I know it works in the real app and not
    only in tests.
16. As the developer, I want a backend-only change checked by calling the affected route on the
    running server, so that backend work has an equivalent real-app check.
17. As the developer, I want the agent to report what it actually observed in the app, so that
    "verified" is backed by evidence.
18. As the developer, I want the agent to say plainly when a real-app check could not be run and
    why, so that a skipped check is never reported as passed.

### Deploy safety

19. As the developer, I want the backend to deploy only after CI checks pass, so that a failing
    commit cannot reach production.
20. As the developer, I want a failing commit to be unable to run migrations on the production
    database, so that the schema never moves ahead of tested code.
21. As the developer, I want the hosting service to check the health endpoint before switching to
    a new build, so that a build that will not boot never replaces the running one.
22. As the developer, I want the frontend and backend gated by the same test run, so that they
    cannot ship out of step because one was gated and the other was not.
23. As the developer, I want the deploy description file in the repo to match the live service's
    name and settings, so that the file is a true record of production.

### PR lane and the loop

24. As the developer, I want unattended work to only ever open pull requests, so that no agent I
    am not watching can push to a branch that deploys.
25. As the developer, I want the loop to run weekly, so that I build trust in it slowly.
26. As the developer, I want at most one loop PR open at a time, so that my review queue never
    exceeds one and loop PRs never conflict with each other.
27. As the developer, I want the loop to do nothing when its previous PR is still open, so that
    work does not pile up while I am away.
28. As the developer, I want the loop to pick the highest-priority backlog item tagged
    loop-safe, so that I control what it works on by tagging.
29. As the developer, I want the loop to refuse any item that falls in the risky tier even if it
    is tagged, so that a tagging mistake cannot produce an unattended migration or auth change.
30. As the developer, I want the loop to do nothing and say so when no tagged item exists, so
    that it never invents work.
31. As the developer, I want the loop to run the full gate before opening its PR, so that I am
    never asked to review something that does not build.
32. As the developer, I want each loop PR to name the backlog item it addresses and describe what
    was verified, so that I can review it without reconstructing context.
33. As the developer, I want to merge loop PRs by hand, so that merging (which deploys) is always
    my decision.
34. As the developer, I want the backlog item removed in the same PR that completes it, so that
    the queue stays true after a merge.
35. As the developer, I want the loop to run as a scheduled cloud agent, so that it works when my
    machine is off.
35a. As the developer, I want the loop to skip an item whose earlier loop PR I closed without
    merging, so that a rejected attempt is not repeated every week.
35b. As the developer, I want to make a rejected item eligible again by giving it a new ID, so
    that retrying is a deliberate act of mine.
35c. As the developer, I want each loop PR's branch and title to carry the backlog item's ID, so
    that a PR can always be traced to its item.

### PR review by named agents

36. As the developer, I want four reviewer agents with distinct names (code, security,
    architecture, domain), so that I can tell which lens raised each finding.
37. As the developer, I want each reviewer to run as its own job with its own brief, so that no
    reviewer is influenced by another's output.
38. As the developer, I want each reviewer to post its own signed comment, so that four opinions
    are not blended into one.
39. As the developer, I want the code reviewer to check correctness, edge cases, error handling
    and whether the diff is covered by tests, so that bugs are caught before merge.
40. As the developer, I want the security reviewer to check auth and access checks, input
    handling, server-side fetch and injection risks, secrets and HTML sanitizing, so that the
    project's known risk areas are examined every time.
41. As the developer, I want the architecture reviewer to check the diff against the architecture
    document and the design system, so that the repository layer, route and service boundaries,
    shared types and UI rules are respected.
42. As the developer, I want the domain reviewer to check terms and behaviour against the
    glossary and the specs, so that the code keeps speaking one language.
43. As the developer, I want the code and security reviewers to run in the official review
    workflow and the architecture and domain reviewers in my custom review workflow, so that each
    workflow does what it is suited to.
44. As the developer, I want each reviewer defined once, in the same place as the project's other
    agent briefs, so that the workflows and my local sessions use the same definition.
45. As the developer, I want to call any of the four reviewers by name in a local session, so
    that I can ask for a specific lens on demand.
46. As the developer, I want a reviewer with nothing to say to post a short all-clear, so that
    silence is never ambiguous between "no findings" and "did not run".

### Backlog

47. As the developer, I want the backlog file to be the only queue of work, so that I look in one
    place.
48. As the developer, I want shipped items deleted from the backlog, so that it shows only open
    work (git history keeps the record).
49. As the developer, I want a short Now / Next / Later section at the top, so that the order of
    work is visible at a glance.
50. As the developer, I want a visible tag on each loop-safe item, so that I can see and change
    what the loop may take.

### Glossary

51. As the developer, I want a terms-only glossary at the repo root, so that the domain's words
    have one definition.
52. As the developer, I want the glossary drafted from existing sources (shared types, data
    schema and architecture docs, agent briefs, the knowledge graph, specs), so that I am not
    asked for facts the repo already holds.
53. As the developer, I want a list of terms the sources use inconsistently, so that I only spend
    time on real conflicts.
54. As the developer, I want a short session that settles only those conflicts, so that the
    glossary reflects my decisions where the sources disagree.
55. As the developer, I want the glossary free of implementation detail, so that it stays a
    glossary and does not turn into a second architecture document.
56. As the developer, I want the glossary updated whenever a term is pinned down in a later
    session, so that it does not go stale.

### Rules and hygiene

57. As the developer, I want the worktree-and-merge rule removed from my global instructions, so
    that the agent stops receiving contradictory git guidance.
58. As the developer, I want this workflow written into the project instructions, so that every
    session and the loop follow the same rules.
59. As the developer, I want the stored memory note about my git workflow updated to match, so
    that old guidance does not resurface.
60. As the developer, I want the stale remote branches deleted once each is confirmed merged, so
    that the branch list shows only live work.
61. As the developer, I want the merge-driver attributes file committed, so that the knowledge
    graph merge behaviour is the same on any clone.

## Implementation Decisions

### Tiers

| Tier | Covers | Paperwork | Before push |
|---|---|---|---|
| Trivial / fix | Small changes, bug fixes | None | Gate |
| Feature | New behaviour | One spec | Gate, one general reviewer, real-app check if user-visible |
| Risky | Migrations; auth and access control; production data scripts; deploy and CI config | Spec and plan | As feature, plus an explicit confirmation from the developer |

- A change that touches a risky area is risky regardless of its size.
- The tier is announced at the start of work.

### Trunk lane review

- One general reviewer, run as a fresh agent, for feature and risky tiers. It is not the four
  named PR reviewers.
- All findings are fixed before push. There is no "log it for later" path, so review findings do
  not feed the backlog.

### Real-app check

- User-visible flow: start the dev stack and drive the changed flow in a browser.
- Backend only: call the affected route on the running server.
- The result is reported as an observation. If the check cannot run, that is reported as such.

### Deploy gating

- The backend host's auto-deploy trigger changes from "on commit" to "after CI checks pass".
- The backend host's health check path is set to the existing health endpoint.
- Both are dashboard settings changed by the developer; the agent's tooling can read but not
  change them. The agent verifies afterwards by reading the service settings.
- The deploy description file is corrected to match the live service name and health check.
- The full test suite keeps running in both the CI and deploy workflows on a `master` push. The
  developer chose not to remove this duplication.

### Named reviewer agents

- Four agent briefs, stored with the project's existing agent briefs: `code-reviewer`,
  `security-reviewer`, `architecture-reviewer`, `domain-reviewer`. Plain role names, not personas.
- Each brief states what the reviewer checks, which documents it reads, what it ignores (the
  other reviewers' lenses), and the comment format including an all-clear form.
- The official review workflow runs two jobs, one per brief (`code-reviewer`,
  `security-reviewer`).
- The custom review workflow runs two jobs, one per brief (`architecture-reviewer`,
  `domain-reviewer`). The custom review script is changed to take a reviewer name, load that
  brief plus the documents it lists, and sign its comment with the reviewer's name.
- Reviewers run in parallel and do not read each other's comments.
- `domain-reviewer` depends on the glossary and is built after it.

### Loop

- Host: a scheduled cloud agent, weekly.
- Steps: check for an open loop PR (stop if one exists); select the next eligible backlog item
  (stop if none); implement on a branch; run the gate; open a PR that names the item, removes it
  from the backlog, and states what was verified.
- Loop PRs carry a fixed label or branch prefix so "is a loop PR open" has an exact answer.
- Item selection is a small deterministic step, not left to the agent's reading of the file: the
  first item in priority order that carries the loop-safe tag, does not match a risky-tier
  marker, and whose ID is not in the set of previously rejected IDs.
- **No item is taken twice.** Three cases:
  - PR still open: the loop stops at its first step.
  - PR merged: the PR deleted the item from the backlog, so it no longer exists.
  - PR closed without merging: the item is still in the backlog and still tagged. Before
    selecting, the loop lists closed, unmerged loop PRs and collects the item IDs they carry;
    those IDs are passed to item selection as the rejected set and are skipped.
- To retry a rejected item, the developer gives it a new ID. The old ID stays rejected.
- The loop's branch name and PR title both carry the item ID, which is how a closed PR is matched
  back to its item.
- The loop never pushes to `master` and never merges.

### Backlog

- Shipped items and the "Completed" section are deleted.
- A Now / Next / Later section at the top lists item titles in order; item bodies stay below.
- Loop eligibility is a `[loop-safe]` tag in the item heading.
- Every item gets a short, stable ID in its heading, assigned during the prune. IDs are never
  reused and do not change when an item is reordered or retitled. The existing inconsistent
  numbering is replaced by these IDs.

### Glossary

- File: `GLOSSARY.md` at the repo root (the current upstream name for what older versions of the
  domain-modeling skill call `CONTEXT.md`).
- Built in two steps: a draft mined from existing sources with a list of inconsistently used
  terms, then a short domain-modeling session that settles only those terms.
- Terms only; no implementation detail.

### Rules

- The global instructions lose their "Git Workflow" section. Leftover worktrees are caught by the
  existing leftover-work-review skill when asked, not by a standing rule.
- The project instructions' git and deploy section is rewritten to describe the two lanes, the
  tiers, the verification steps and the confirmation rule.
- The memory note on the solo git workflow is updated to match.

### Rollout order

1. Deploy gating and health check.
2. Written rules (project instructions, global instructions, memory) and hygiene (stale branches,
   attributes file).
3. Backlog prune and reorder.
4. Reviewer briefs and the two review workflows (`code`, `security`, `architecture`).
5. Glossary, then `domain-reviewer`.
6. The loop.

### Decisions not needing an ADR

Every decision here is cheap to reverse (a dashboard toggle, a workflow file, a rules paragraph),
so none is recorded as an ADR.

## Testing Decisions

A good test here checks behaviour a person would notice — which item the loop would take, which
comment a reviewer would post — and not how a prompt is worded or how a workflow file is laid out.

Most of this feature is configuration and written rules, which are verified by acceptance checks
rather than unit tests. Two pieces are real logic and get tests.

**Seam 1: loop item selection (new, unit tested).** A pure function from backlog text and a set of
rejected item IDs to "the next eligible item, or none". Cases: picks the first tagged item in
priority order; skips untagged items; refuses a tagged item in the risky tier; skips a tagged item
whose ID is in the rejected set and moves on to the next; picks a previously rejected item once it
carries a new ID; returns none for an empty or untagged backlog, or when every tagged item is
rejected; ignores an item with no ID. Gathering the rejected set from closed PRs is outside the
function and is covered by the supervised acceptance run. Prior art: the pure-logic tests under the unit test
directory, such as those for the letter compose-URL builders.

**Seam 2: review request assembly in the custom review script (existing seam, unit tested).**
Given a reviewer name and a diff, the script produces a request containing that reviewer's brief
and listed documents, and a comment signed with that reviewer's name. Cases: each of the two
reviewers loads its own brief; an unknown reviewer name fails loudly; an empty diff yields an
all-clear without calling the model. The model call is the only thing mocked. Prior art: the
server tests that mock only external I/O (fetch, email, Turnstile) and exercise everything else
for real.

**Acceptance checks (manual, once, at rollout):**

- Deploy gating: read the backend service settings and confirm the trigger is "after checks pass"
  and the health check path is set. Not tested by pushing a deliberately failing commit to
  `master`.
- Reviewers: open one trial PR and confirm four separately signed comments appear, from four
  separate jobs.
- Loop: one supervised run that produces a PR for a tagged item; a second run that does nothing
  because that PR is still open; then, after closing that PR unmerged, a third run that skips the
  item and takes the next tagged one (or reports that none is left).

## Out of Scope

- Auto-merging any PR, including docs-only or test-only ones.
- The loop proposing its own work or taking untagged items.
- More than one loop PR at a time, or a cadence faster than weekly.
- Using the four named reviewers in the trunk lane.
- Removing the duplicated test run on `master` pushes.
- Ignoring or deleting the untracked debug log and its symlink.
- A rollback mechanism for migrations (they remain forward-only).
- Moving the queue to an issue tracker or to Trello.
- Changing the backend host's region or plan.
- Applying this workflow to other projects.

## Further Notes

- **The loop's feed is manual.** Because every trunk-lane review finding is fixed before push,
  reviews do not generate loop work. The loop only has something to do when the developer tags
  backlog items.
- **Two points assumed, not explicitly confirmed:** the reviewer names are plain role names, and
  four reviewers produce four comments, not one merged summary.
- **Seams were proposed without a separate confirmation round.** If item selection should stay
  inside the agent's prompt instead of being a tested function, Seam 1 disappears and the risky-tier
  refusal becomes a prompt rule only.
- **Upstream skill naming.** The installed domain-modeling skill (1.2.3) still says `CONTEXT.md`;
  upstream has since renamed the convention to `GLOSSARY.md`, which this spec follows.
- **Observed while investigating, not addressed here:** the backend runs in a US region while the
  database is in the EU; and PR preview environments are enabled on the backend host, which the
  PR lane will start exercising.
- **This spec was not published to an issue tracker.** The project has no tracker or triage
  labels configured for the to-spec skill, and the agreed queue is the backlog file.
