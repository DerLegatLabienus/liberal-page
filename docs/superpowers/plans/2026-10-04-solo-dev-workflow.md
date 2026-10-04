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
| Render auto-deploy trigger | on commit | after CI checks pass | developer, dashboard |
| Render health check path | empty | `/api/health` | developer, dashboard |
| Render PR previews | automatic, copy prod env | on, against the dev database | see A |
| `ANTHROPIC_API_KEY` repo secret | not set | see decision D1 | developer |
| `CLAUDE_CODE_OAUTH_TOKEN` repo secret | set | unchanged | — |

Render copies **all** of the base service's environment variables into a preview when it is
created (Render docs, "Working with PR previews"), and sets `IS_PULL_REQUEST=true` on it. There is
no per-preview override before first boot for a service not managed by a Blueprint. So today a
preview boots against the prod database, runs the PR's migrations there, and starts a second poller.

## Open decisions

- **D1 — how `architecture-reviewer` and `domain-reviewer` run.** The custom review workflow
  needs `ANTHROPIC_API_KEY`, which is not set, so it currently skips. Either the developer adds
  the secret (API-billed), or the custom workflow is rewritten to use the official action with the
  existing OAuth token and the Python script is removed.
- **D2 — confirm mechanism A** for pointing previews at the dev database.

## A. Previews use the dev database (do first)

1. Database client: when `IS_PULL_REQUEST` is `true`, connect with `PREVIEW_DATABASE_URL` and
   ignore `DATABASE_URL`. If `PREVIEW_DATABASE_URL` is unset in a preview, **refuse to start**
   with a clear error. Outside a preview nothing changes.
2. Extract the choice into a pure function (environment in, connection string or error out) and
   unit test it: not a preview → `DATABASE_URL`; preview with the variable → the preview URL;
   preview without it → throws; `IS_PULL_REQUEST=false` → `DATABASE_URL`.
3. Developer: add `PREVIEW_DATABASE_URL` (the Neon `dev` branch connection string) to the Render
   service, and set PR previews to **Manual** until this change is live on `master`.
4. Document the variable in `.env.example`, `render.yaml` and the project `CLAUDE.md`.
5. Known side effect, accepted: a preview also copies the email, Calendly and LLM keys. The dev
   database has no real users, so alert digests have no recipients; a preview can still spend LLM
   budget if someone calls its summarize route.

**Verify:** gate; then, after the developer's dashboard changes, read the service settings back.
The first trial PR's preview log must show the dev database host.

## B. Render gating (developer, dashboard)

1. Auto-deploy: "After CI checks pass".
2. Health check path: `/api/health`.
3. Agent reads the settings back (`autoDeployTrigger`, `healthCheckPath`) and updates the "As of
   2026-10-04" warning in the project `CLAUDE.md` and the backend row of the infrastructure table.
4. `render.yaml`: rename the service to match the live one (`liberal-page`) and add
   `PREVIEW_DATABASE_URL`. The file is a record only; the live service is not Blueprint-managed.

**No trial PR is opened until A and B are both verified by reading the settings.**

## C. Reviewers in CI (step 4)

1. Official review workflow: two jobs, `code-reviewer` and `security-reviewer`. Each passes its
   brief from `.claude/agents/` as the prompt and posts one comment signed with its name.
2. Custom review workflow: two jobs, `architecture-reviewer` and, once the glossary exists,
   `domain-reviewer`. Shape depends on D1:
   - **API key:** the script takes a reviewer name, loads that brief and the documents it lists,
     signs the comment. Unit tested with the model call mocked (spec, Seam 2): each reviewer loads
     its own brief; unknown name fails loudly; empty diff posts an all-clear without a model call.
   - **OAuth:** the script is deleted and the jobs use the official action with the brief as the
     prompt. Seam 2 disappears; the trial PR is the only check.
3. Jobs are independent (no `needs` between them) and none reads another's comment.
4. Every reviewer job stays advisory: it never fails the PR check.

**Verify:** one trial PR shows three signed comments from three separate jobs (four after step 5).

## D. Glossary and `domain-reviewer` (step 5)

Docs only, not risky; listed for order. Draft `GLOSSARY.md` from existing sources, settle the
conflicting terms with the developer, then write the `domain-reviewer` brief and add its job.

## E. The loop (step 6)

1. Item selection as a pure, unit-tested function (spec, Seam 1): backlog text and a set of
   rejected IDs in; the first `[loop-safe]`, non-risky, non-rejected item out, or none.
2. A small command wrapping it that also asks GitHub for an open loop PR (stop if any) and for
   closed, unmerged loop PRs (their IDs form the rejected set).
3. Loop PR convention: branch `loop/LibPage-NNN-short-slug`, title starting `[LibPage-NNN]`,
   label `loop`.
4. The loop's instructions as a checked-in prompt: run the command; stop if it returns nothing;
   implement; run the gate; open the PR, deleting the item from the backlog in the same PR.
5. Scheduled cloud agent, weekly. Created only after the developer confirms the schedule and
   that at least one item is tagged `[loop-safe]`.

**Verify:** the three supervised runs in the spec (opens a PR; does nothing while it is open;
skips the item after the PR is closed unmerged).

## Order and stop points

1. A (code + tests) → **confirm** → push.
2. Developer: dashboard changes for A and B → agent reads them back.
3. C → **confirm** → push → trial PR.
4. D (auto-push, docs).
5. E → **confirm** → push → supervised runs → **confirm** → schedule.
