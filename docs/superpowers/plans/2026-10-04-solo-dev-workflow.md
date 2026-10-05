# Solo developer workflow — implementation plan for the risky steps

**Spec:** `docs/superpowers/specs/2026-10-04-solo-dev-workflow-design.md`
**Backlog:** LibPage-001
**Tier:** risky (deploy and CI config, database connection). Nothing in this plan is pushed without
the developer's confirmation.

Rollout steps 2 (written rules, hygiene) and 3 (backlog prune) are done and are not covered here.
The three reviewer briefs for step 4 are committed; wiring them into CI is covered below.

## State on 2026-10-04

| Setting | Now | Target | Who |
|---|---|---|---|
| Render auto-deploy trigger | after CI checks pass (done 2026-10-05) | after CI checks pass | done |
| Render health check path | empty | `/api/health` | developer, dashboard |
| Render PR previews | off (done 2026-10-05) | off | done |
| `ANTHROPIC_API_KEY` repo secret | not set | not needed (D1) | — |
| `CLAUDE_CODE_OAUTH_TOKEN` repo secret | set | unchanged | — |

Render copies **all** of the base service's environment variables into a preview when it is
created (Render docs, "Working with PR previews"), and sets `IS_PULL_REQUEST=true` on it. There is
no per-preview override before first boot for a service not managed by a Blueprint. So today a
preview boots against the prod database, runs the PR's migrations there, and starts a second poller.

## Decisions

- **D1 — how `architecture-reviewer` and `domain-reviewer` run: decided 2026-10-05, OAuth.** The
  custom review workflow needed `ANTHROPIC_API_KEY`, which was never set, so it skipped every PR.
  It now uses the official action with the existing `CLAUDE_CODE_OAUTH_TOKEN`, like the other two
  reviewers. The Python review script is deleted; no new secret is needed.

## A. PR previews off (developer, dashboard)

Decided 2026-10-04: turn Render PR previews **off**. Pointing them at the dev database would need
an app-level switch, which the developer chose not to build. Loop PRs are reviewed from the diff,
CI and the reviewer comments only. No code change.

## B. Render gating (developer, dashboard)

1. Auto-deploy: "After CI checks pass".
2. Health check path: `/api/health`.
3. Agent reads the settings back (`autoDeployTrigger`, `healthCheckPath`) and updates the "As of
   2026-10-04" warning in the project `CLAUDE.md` and the backend row of the infrastructure table.
4. `render.yaml`: rename the service to match the live one (`liberal-page`). The file is a record only; the live service is not Blueprint-managed.

**No trial PR is opened until A and B are both verified by reading the settings** (previews off,
trigger after checks, health check path set).

## C. Reviewers in CI (step 4)

1. Official review workflow (`claude-code-review.yml`): two jobs, `code-reviewer` and
   `security-reviewer`.
2. Custom review workflow (`pr-review.yml`): two jobs, `architecture-reviewer` and
   `domain-reviewer`.
3. Every job runs the official action with the OAuth token. Its prompt points the reviewer at its
   brief in `.claude/agents/`, has it review the PR's diff against `origin/master`, and has it post
   exactly one signed comment with `gh pr comment`, including an all-clear when it finds nothing.
4. Tools are limited to reading the repo and the PR and posting a comment. Job permissions:
   `contents: read`, `pull-requests: write`, `id-token: write`.
5. Jobs are independent (no `needs` between them) and none reads another's comment.
6. Every reviewer job stays advisory (`continue-on-error`): it never fails the PR check. A PR from
   a fork receives no secrets, so the jobs skip.
7. Known behaviour, accepted: each push to an open PR re-runs all four reviewers, so a PR that is
   updated gets a fresh set of four comments per push.

**Verify:** one trial PR shows four signed comments from four separate jobs. There is no unit
test: with the script gone, the trial PR is the only check.

## D. Glossary and `domain-reviewer` (step 5)

Docs only, not risky; listed for order. Draft `GLOSSARY.md` from existing sources, settle the
conflicting terms with the developer, then write the `domain-reviewer` brief and add its job.

## E. The loop (step 6)

1. Item selection as a pure, unit-tested function (spec, Seam 1): backlog text and a set of
   excluded IDs in; the first `[loop-safe]`, non-risky, non-excluded item out, or none. **Built.**
2. A small command wrapping it (`npm run loop:next`) that asks GitHub for open loop PRs (their
   items are in flight; stop only when three are open) and for closed, unmerged ones (rejected).
   **Built.**
3. Loop PR convention, ordinary trunk-based naming: branch `<type>/LibPage-NNN-short-slug` with a
   conventional-commit type, PR title a conventional commit subject ending `(LibPage-NNN)`,
   label `loop`. A PR is recognised by the branch shape or the label.
4. The loop's instructions as a checked-in prompt (`scripts/loop/PROMPT.md`): pick; branch;
   implement; list overlaps with open loop PRs; gate; remove the item; open the PR. **Built.**
5. A run that cannot finish its item opens a docs-only PR that writes a detailed explanation
   into the backlog item and removes its `[loop-safe]` tag (adding `[risky]` when that is why).
6. **Before the first supervised run:** create the `loop` label on GitHub, and find out which
   GitHub identity the cloud agent pushes and opens PRs as. The review action refuses workflows
   started by a non-human actor unless that login is listed in its `allowed_bots` input; because
   the reviewer steps are advisory, that refusal would show as a green check with no comments. If
   the loop acts as a bot or app, add `allowed_bots: <login>` to all four reviewer jobs. Also
   confirm that PRs opened by that identity trigger workflows at all (events made with the
   repository `GITHUB_TOKEN` do not). A human-opened trial PR reveals neither.
7. Scheduled cloud agent, weekly. Created only after the developer confirms the schedule and
   that at least one item is tagged `[loop-safe]`.

**Verify:** the three supervised runs in the spec (opens a PR; with that PR open, opens a second
for the next item; does not retry an item whose PR was closed unmerged).

## Order and stop points

1. Developer: dashboard changes for A and B → agent reads them back.
2. `render.yaml` and `CLAUDE.md` updated to match → **confirm** → push.
3. C → **confirm** → push → trial PR.
4. D (auto-push, docs).
5. E → **confirm** → push → supervised runs → **confirm** → schedule.
