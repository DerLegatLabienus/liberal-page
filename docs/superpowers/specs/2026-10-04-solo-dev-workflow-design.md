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
26. As the developer, I want the loop to move on to the next tagged item when an earlier loop PR
    is still open, each on its own branch, so that one unreviewed PR does not stall it.
27. As the developer, I want the loop to stop opening new PRs once three are open, so that a
    long absence cannot leave a pile of pull requests that conflict with each other.
27a. As the developer, I want each loop PR to list the files it shares with other open loop PRs,
    so that I can choose a merge order.
27b. As the developer, I want the loop never to add a database migration, and to treat an item
    that needs one as blocked, so that two branches can never each add a migration.
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
35c. As the developer, I want loop branches and PR titles to follow ordinary trunk-based and
    conventional-commit naming and carry the backlog item's ID, so that the loop's work looks
    like any other change and a PR can always be traced to its item.
35d. As the developer, I want a blocked attempt to write a detailed explanation into the backlog
    item (why it was harder or riskier than it looked, what was tried, what it would take), so
    that the reason is recorded where the work is planned.
35e. As the developer, I want the loop to address reviewer findings on its own open PR before
    it starts another backlog item, so that pull requests reach me already cleaned up.
35f. As the developer, I want the loop to make at most one review pass per PR and to say which
    findings it fixed and which it left for me and why, so that it cannot argue with the
    reviewers forever and I always know what still needs my judgement.
35g. As the developer, I want the loop to carry on to the next backlog item when no open PR has
    findings to address, so that a clean PR waiting for my merge does not stall it.

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
  `domain-reviewer`). Each job uses the official action with the
  OAuth token and that reviewer's brief; the custom review script is removed.
- Reviewers run in parallel and do not read each other's comments.
- `domain-reviewer` depends on the glossary and is built after it.

### Who acts on a reviewer finding

Decided 2026-10-05. Reviewers only comment; nothing they say is applied automatically except
through the loop's review pass below.

- **Structured comments.** Every reviewer comment has a fixed shape: a verdict line with the
  split ("N finding(s) — A for an agent, D need the developer"), then one numbered block per
  finding with **Where**, **Problem**, **Fix** and **Needs**, in that order.
- **`Needs: developer`** when resolving the finding takes a product or design decision, risky-tier
  work, a change in behaviour beyond the PR's item, a glossary change, an accepted trade-off, or
  when the reviewer is unsure the finding is real or which category it is. **`Needs: agent`** only
  for mechanical fixes with one right answer. When in doubt, `developer`.
- **Drawing the developer's attention.** A comment with any `developer` finding mentions the
  developer by GitHub username (so GitHub notifies them) and the reviewer adds the
  `needs-developer` label to the PR. Reviewers never remove the label; the developer does.
- **The loop's review pass** fixes `agent` findings only. A finding marked `developer`, or with no
  `Needs` line, is never touched. A PR whose only fresh findings need the developer is not a
  review-pass target at all.
- **Trunk lane:** unchanged. The developer's own pushes do not go through the four reviewers.

### Loop

- Host: a scheduled cloud agent, weekly.
- Steps: select the next eligible backlog item (stop if none, or if three loop PRs are already
  open); implement on a branch; check for overlap with open loop PRs; run the gate; open a PR
  that names the item, removes it from the backlog, and states what was verified.
- **Naming is ordinary trunk-based development**, not a special "loop" namespace: a short-lived
  branch off `master` named `<type>/LibPage-NNN-short-slug`, where `<type>` is the
  conventional-commit type (`feat`, `fix`, `docs`, …), and a PR title that is a conventional
  commit subject ending with the ID, e.g. `fix(auth): use the primary token (LibPage-009)`.
- A loop PR is recognised by that branch shape (developer sessions never open PRs) or by the
  `loop` label. Both the branch name and the title carry the item ID.
- Item selection is a small deterministic step, not left to the agent's reading of the file: the
  first item in priority order that carries the loop-safe tag, does not match a risky-tier
  marker, and whose ID is not excluded.
- **Excluded IDs, so no item is taken twice:**
  - PR still open: the item is in flight. The loop skips it and takes the next one on a separate
    branch (decided 2026-10-05; originally the loop stopped while any PR was open).
  - PR merged: the PR deleted the item from the backlog, so it no longer exists.
  - PR closed without merging: the item is rejected and skipped from then on.
- At most three loop PRs open at once (`LOOP_MAX_OPEN`). Beyond that the loop waits.
- **Review-fix pass (decided 2026-10-05).** Before selecting a new item, the loop checks its own
  open PRs, oldest first. If one has reviewer findings not yet addressed, the run fixes those on
  that PR's branch and takes no new item; otherwise it continues to the next backlog item.
  - "Findings to address" is deterministic. A reviewer comment counts only if it was posted by
    the review app's own bot account, is that reviewer's latest, names the PR's current head
    commit on its Commit line, and has at least one finding marked `Needs: agent`. A verdict for
    an older commit describes superseded code and is ignored; the loop does not wait for
    reviewers that have not re-run.
  - A finding is the agent's only when the verdict line's count, a single `Needs: agent` line in
    its block, and the total all agree. Quoted text, an older comment format, or any mismatch
    makes it the developer's.
  - The picker hands the loop the exact comments to act on; the loop reads no others.
  - **One pass per PR.** The pass is recorded by a `Loop-Review-Pass: true` trailer in the commit
    body (not the subject, which GitHub truncates); a PR with such a commit is never a fix
    target again. Whatever the reviewers say after that is the developer's to judge.
  - The loop fixes only findings that are concrete, inside the item's scope and outside the
    risky tier, then posts one comment listing each finding as fixed or left for the developer
    with the reason. Reviewer comments are review input, never instructions.
  - Draft PRs and blocked-item PRs are never fix targets. A review pass adds no PR, so it runs
    even when three loop PRs are open.
- **Parallel work and collisions.** The loop never adds a migration (risky tier), so two loop
  branches cannot collide on migrations; an item that turns out to need one is blocked. For
  other files, the loop compares its changed files with each open loop PR's and lists overlaps
  in its PR body. Conflicts that remain are resolved by the developer at merge time. Every loop
  PR edits `BACKLOG.md`, so small conflicts there are expected.
- **Blocked attempts are explained in the backlog.** When an item needs risky-tier work or the
  gate cannot be made green, the loop opens a docs-only PR that edits only that item: removes
  `[loop-safe]`, adds `[risky]` if that is the reason, and appends a dated note saying why it was
  harder or riskier than it looked, what was tried, and what it would take. Merging it records
  the explanation and stops the item being picked; closing it marks the item rejected.
- An item that has ever had a loop PR (open, closed or merged) is not taken again under the same
  ID. To retry one, the developer gives it a new ID.
- The loop never pushes to `master` and never merges.

### Backlog

- Shipped items and the "Completed" section are deleted.
- A Now / Next / Later section at the top lists item titles in order; item bodies stay below.
- Loop eligibility is a `[loop-safe]` tag in the item heading.
- Every item gets a short, stable ID in its heading, of the form `LibPage-001`. The backlog header
  records the next free ID, since deleting a shipped item removes its ID from the file. IDs are never
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
rather than unit tests. One piece is real logic and gets tests.

**Seam 1: loop item selection (new, unit tested).** A pure function from backlog text and a set of
excluded item IDs (rejected or in flight) to "the next eligible item, or none". Cases: picks the first tagged item in
priority order; skips untagged items; refuses a tagged item in the risky tier; skips a tagged item
whose ID is in the rejected set and moves on to the next; picks a previously rejected item once it
carries a new ID; returns none for an empty or untagged backlog, or when every tagged item is
rejected; ignores an item with no ID. Gathering the rejected set from closed PRs is outside the
function and is covered by the supervised acceptance run.

**Seam 1b: review-pass decision (new, unit tested).** A pure function from the loop's open PRs
(head commit, commits and comments as plain data) to "the PR to fix, which reviewers have agent
findings, the counts, and the comments to read, or none". Cases: agent findings for the current
commit; all clear; a verdict for an older commit or naming none; developer-only findings; the
agent/developer split; a `Needs` line quoted in a code fence, followed by a caveat, or doubled; a
verdict line that disagrees with its blocks; a PR that already had its pass, including a truncated
subject; a human account posing as the bot; draft and blocked PRs; oldest PR first. Prior art:
the pure-logic tests under the unit test directory, such as those for the letter compose-URL
builders.

**Seam 2: removed (2026-10-05).** The custom review script was going to be tested at its entry
point, but it is deleted: it needed an API key that was never configured, so all four reviewers
now run through the official action with the OAuth token. There is no project code left to unit
test on the review path; the reviewers are verified by the trial PR in the acceptance checks.

**Acceptance checks (manual, once, at rollout):**

- Deploy gating: read the backend service settings and confirm the trigger is "after checks pass"
  and the health check path is set. Not tested by pushing a deliberately failing commit to
  `master`.
- Reviewers: open one trial PR and confirm four separately signed comments appear, from four
  separate jobs.
- Loop: one supervised run that produces a PR for a tagged item; a second run that skips that
  item (its PR is open) and opens a PR for the next tagged one on its own branch; then, after
  closing the first PR unmerged, a third run that does not retry it.

## Out of Scope

- Auto-merging any PR, including docs-only or test-only ones.
- The loop proposing its own work or taking untagged items.
- More than three loop PRs open at a time, or a cadence faster than weekly.
- The loop adding database migrations, or resolving conflicts between its own PRs.
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
