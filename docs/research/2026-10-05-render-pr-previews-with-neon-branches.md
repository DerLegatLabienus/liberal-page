# Render PR previews with a temporary Neon database per pull request

Research note, 2026-10-05. Read-only investigation: nothing was changed on Render, Neon or GitHub,
and no Neon branch was created. Sources are official docs and first-party repos, cited inline.
Where a statement is my own inference rather than something a doc says, it is marked **(inference)**.

## Short answer

Yes, it can be built, but there is no ready-made Neon + Render preview integration and no
Render setting that does it for a hand-created service on the free plan. On this setup the only
thing that can change a preview's database **before its first boot** is code in the app's own
start path, keyed on `IS_PULL_REQUEST`; every other route (Render API, hooks, Blueprint
`previewValue`) is either too late, paid-only, or not documented to apply. Even with a temporary
database, a preview still receives a copy of every production secret (`DATABASE_URL`, `JWT_SECRET`,
R2, Resend, Calendly, Anthropic), and it runs the pull request's code, so a code-level switch
protects against accidents but is not a hard guarantee; the copied `JWT_SECRET` alone is enough to
sign tokens that production accepts for any user. The only hard guarantees are "previews off"
or hosting previews from a second Render service that never held production secrets.
**Recommendation: keep previews off.** CI already boots the server and runs every migration against
a fresh Postgres on each pull request, which is most of what a backend-only preview would prove.

## Current state (checked 2026-10-05, read-only)

| Item | Value | How checked |
|---|---|---|
| Render service `liberal-page` (`srv-d85nkvrbc2fs73f06830`) | plan `free`, `previews.generation: automatic`, `autoDeployTrigger: checksPass`, `healthCheckPath` empty, start command `npx tsx server/index.ts`, region `oregon` | Render API (`get_service`) |
| Neon project `empty-hill-56029538` | two branches: `production` (default, not protected) and `dev` (`init_source: parent-schema`, state `archived`) | Neon API (`list_branches`) |
| CI on pull requests | `.github/workflows/ci.yml` job `build + smoke` starts a `postgres:17` service container and runs `npm run smoke` against it | repo file |
| Where the DB connection is made | `server/db/client.ts` builds the `pg` pool at **import time** from `process.env.DATABASE_URL`; `server/index.ts` calls `runMigrations()` before `listen`, then `startPoller()` and `syncSharesIfRendererChanged()` | repo files |

Note that PR previews are **still set to automatic** on the live service, so the known problem
(preview boots against prod and runs the PR's migrations there) is live until that setting changes.

---

## 1. Ways to give a preview a different `DATABASE_URL`

Background facts all options rest on:

- A PR preview copies all settings, including environment variables, from its base service when it
  is first created; later changes to the base service are not applied to an existing preview.
  Render's own advice is to "change environment variables on your preview instance" afterwards.
  https://render.com/docs/service-previews#working-with-pr-previews
- Free web services support service previews. https://render.com/docs/free#free-web-services
- Previews are billed at the base service's rate, so a preview of a free service is free, but it
  uses the workspace's 750 free instance hours per month while it is awake.
  https://render.com/docs/service-previews#billing-for-pr-previews and
  https://render.com/docs/free#monthly-usage-limits

### (a) Blueprint `previewValue` / preview environments

- `previewValue` overrides an environment variable "in preview environments".
  https://render.com/docs/blueprint-spec#preview-environments and
  https://render.com/docs/preview-environments#environment-variables
- **Preview environments require a Pro workspace plan or higher.**
  https://render.com/docs/preview-environments (banner at top) and
  https://render.com/docs/platform-features-by-plan
- The Blueprint reference separates two things: a service-level `previews.generation`
  (`manual`/`automatic`) that controls single-service **pull request previews** and "does not affect
  configuration for preview environments", and the root-level `previews.generation` that turns on
  **preview environments**. https://render.com/docs/blueprint-spec#previews
- **The docs do not say whether `previewValue` is applied to a single-service pull request preview**
  (the free kind). Every mention of `previewValue` says "preview environments". Treat it as not
  available on this plan until tested. Same gap for `sync: false`: the docs say such variables are
  not copied to preview *environments*
  (https://render.com/docs/blueprint-spec#prompting-for-secret-values), while the service-previews
  page says a PR preview copies all environment variables.
- Adopting a Blueprint for the existing service is possible: add the service to `render.yaml` with
  **the same name and every option currently set in the dashboard** (name, type, plan, build and
  start commands, and so on), then create/sync the Blueprint; omitted options fall back to defaults
  that will differ from the live service, and existing environment variable values not overwritten
  by the Blueprint are kept. The dashboard can also generate a `render.yaml` from an existing
  service. https://render.com/docs/infrastructure-as-code#adding-an-existing-resource and
  https://render.com/docs/infrastructure-as-code#generating-a-blueprint-from-existing-services
  The repo's current `render.yaml` names the service `liberal-page-api`, which does not match the
  live `liberal-page`; syncing it as-is would create a second service **(inference from the
  "same name" requirement)**.
- `previewValue` is a fixed string in the YAML. Even where it works, it gives all previews **one
  shared** database, not one per pull request. Render's own wording: "if you'd like to use a single
  database across all preview environments".

| Works for a hand-created service | Before first boot | Plan |
|---|---|---|
| No, needs a Blueprint | Yes for preview environments; unknown for single-service previews | Pro workspace for preview environments |

### (b) A hook or build/start command that calls the Neon API

- `initialDeployHook` runs "after a service's first successful deploy". The server has already
  booted and migrated by then, so it is **too late**. It is also a Blueprint field.
  https://render.com/docs/blueprint-spec#initialdeployhook
- The pre-deploy command is "available for paid web services" only, and it "executes on a separate
  instance from your running service", so it could not hand an environment variable to the server
  process anyway. https://render.com/docs/deploys#pre-deploy-command
- The **start command** is the one place that runs on every plan, before the server starts, in the
  same process tree. The preview copies the base service's start command along with everything
  else. A start wrapper, or code at the very top of the server entry point, can detect a preview,
  call the Neon API to create-or-find a branch, set `DATABASE_URL`, and only then load the server.
  This is not a Render feature; it is ordinary app code, so nothing in the Render docs describes it
  **(inference)**.
- Cost of this route: the Neon API key has to live in the base service's environment (so that the
  preview inherits it), which puts a Neon management key on the production service too. See
  section 4.

| Works for a hand-created service | Before first boot | Plan |
|---|---|---|
| Start command: yes. Hooks: no | Start command: yes. `initialDeployHook`: no | Start command: free. Pre-deploy: paid instance |

### (c) GitHub Actions creates the branch, then sets the variable through the Render API

The API pieces exist:

- `GET /v1/services` has an `includePreviews` query parameter (default `true`), and service objects
  carry a `parentServer` field. https://api-docs.render.com/reference/list-services
- `PUT /v1/services/{serviceId}/env-vars/{envVarKey}` adds or updates one variable.
  https://api-docs.render.com/reference/update-env-var
- The bulk variant states that changes "will **not** be deployed automatically. Instead you must
  call the deploy API". https://api-docs.render.com/reference/update-env-vars-for-service
  (The single-variable page does not say either way.)

Problems:

- **There is a race, and the preview loses it.** Render creates the preview and starts its first
  deploy as soon as the pull request (or the label, in manual mode) appears. The preview service
  does not exist before that moment, so there is nothing to set a variable on in advance. The
  workflow can only patch the variable after creation and then trigger another deploy. Whether the
  first boot has already run migrations on prod by then depends on timing. The docs describe no way
  to create a preview in a paused state.
- The API docs do not document how to map a preview service to its pull request number. A lookup
  by `parentServer` plus branch or name would have to be worked out by trial.
- Render webhooks (which could announce "preview created") need a Pro plan.
  https://render.com/docs/webhooks
- A Render API key "provides access to *all* workspaces you belong to"; there is no narrower scope.
  https://api-docs.render.com/reference/authentication It would sit in GitHub secrets.

| Works for a hand-created service | Before first boot | Plan |
|---|---|---|
| Yes | **No** (race) | Free |

Useful only as a second step on top of (d), never on its own.

### (d) App-level switch keyed on Render's own variables

Variables Render sets on every service, including previews
(https://render.com/docs/environment-variables):

`IS_PULL_REQUEST` (the string `"true"` for PR previews, `"false"` otherwise), `RENDER` (always
`true`), `RENDER_GIT_BRANCH`, `RENDER_GIT_COMMIT`, `RENDER_GIT_REPO_SLUG`, `RENDER_SERVICE_ID`,
`RENDER_SERVICE_NAME`, `RENDER_SERVICE_TYPE`, `RENDER_EXTERNAL_HOSTNAME`, `RENDER_EXTERNAL_URL`,
`RENDER_INSTANCE_ID`, `RENDER_DISCOVERY_SERVICE`, `RENDER_CPU_COUNT`, `RENDER_WEB_CONCURRENCY`.

**There is no documented pull-request-number variable.** The per-PR key therefore has to be
`RENDER_GIT_BRANCH` (documented as "the Git branch for a service or deploy"). The docs do not
describe how a preview's `RENDER_SERVICE_NAME` is formed.

How the switch would work **(inference, not a documented pattern)**:

1. When `IS_PULL_REQUEST === 'true'`, **ignore the copied `DATABASE_URL` completely.**
2. Resolve a preview URL instead: either a fixed `PREVIEW_DATABASE_URL` held on the base service
   (one shared preview database), or a Neon API lookup/create for a branch named after
   `RENDER_GIT_BRANCH` (one database per pull request).
3. **Fail closed:** if no preview URL can be resolved, exit before connecting to anything.
4. The same switch should blank the other copied secrets (section 4).

Placement matters in this repo: `server/db/client.ts` creates the pool when the module is imported
(`export const db = createDb()`), and `server/index.ts` imports routes that import it. The switch
must run before those imports, which in practice means a small separate entry file or a start
wrapper, not a line inside `server/index.ts` after the imports.

| Works for a hand-created service | Before first boot | Plan |
|---|---|---|
| Yes | Yes | Free |

Limit: the switch is code in the repository, and a preview runs **the pull request's version** of
that code with the production `DATABASE_URL` still present in its environment. A pull request that
edits or bypasses the switch reaches prod. For pull requests opened by an unattended agent, that is
a real gap, not a theoretical one.

### (e) Manual preview mode

- In manual mode Render creates no preview unless the PR has the label `render-preview` or its
  **title** contains `[render preview]`; removing them deprovisions the preview.
  https://render.com/docs/service-previews#manual-vs-automatic-pr-previews
- In automatic mode a single PR can be skipped with the label `render-preview-skip` or `[skip
  preview]` in the title. https://render.com/docs/service-previews#skipping-a-preview

What manual mode does and does not do:

- It **does not** let anything set the preview's variables before first boot; the preview still
  starts from a copy of the base service the instant the label lands.
- It **does** let a workflow do things in order: create the Neon branch first, then add the label.
  Combined with (d), the branch already exists when the start-path code looks it up, so the app only
  needs to *find* a branch, not create one.
- It puts a human or an explicit workflow step between "agent opens PR" and "PR code runs with
  production secrets". That is its main safety value here.

---

## 2. The Neon side

**Creating a branch.**

- GitHub Action `neondatabase/create-branch-action` (current major `v6`). Inputs include
  `project_id`, `api_key`, `branch_name`, `parent_branch`, `branch_type` (`default` or
  `schema-only`), `database` (default `neondb`), `role` (default `neondb_owner`), `expires_at`,
  `ssl`. Outputs include `db_url`, `db_url_pooled`, `branch_id`, `created`. If the named branch
  already exists it is returned rather than recreated, so re-runs are safe.
  https://github.com/neondatabase/create-branch-action (README and `action.yml`)
- API: `POST /projects/{project_id}/branches`, with `init_source` one of `parent-data` (default,
  schema **and data**), `parent-schema` (schema only), `schema-only` (a new root branch with schema
  only). https://api-docs.neon.tech/reference/createprojectbranch
- CLI: `neon branches create`. https://neon.com/docs/reference/cli-branches

**Which parent. This is the part that can leak real data.**

- If no parent is given, the new branch is created from the project's **default branch**
  (https://neon.com/docs/manage/branches#default-branch). In this project the default branch is
  `production`. A default branch copies schema **and data**. So a workflow that forgets
  `parent_branch` produces a full copy of production, with real user emails and live session
  tokens, attached to a preview running unreviewed code. **`parent_branch` must always be explicit.**
- Parent = `dev`: a normal child branch of `dev` copies dev's schema, its rows (no real user data,
  per `CLAUDE.md`) and the Drizzle migration journal, so the preview's boot applies only the PR's
  new migrations. This is the natural choice inside the existing project. `dev` is currently
  **archived**; Neon archives branches older than 14 days that were not accessed for 24 hours, and
  the docs describe unarchiving on access. https://neon.com/docs/guides/branch-archiving Whether
  branching from an archived parent adds a delay is not stated.
- Schema-only branch per PR (`branch_type: schema-only`): not suitable here, for two reasons.
  It is a **root branch**, and the Free plan allows **3 root branches per project**
  (https://neon.com/docs/guides/branching-schema-only#schema-only-branch-allowances); `production`
  takes one, and `dev` may take another (the API does not show me whether `dev` is a root). And a
  schema-only copy has the tables but **no rows in Drizzle's journal table**, so the boot-time
  migrator would try to re-create existing tables **(inference; `CLAUDE.md` describes this same
  desync for the `dev` branch)**. The feature is also marked Beta.
- A truly empty database (every migration runs from zero) needs an empty parent. Inside this
  project that means a dedicated empty branch; the cleaner way is a **separate Neon project** for
  previews, whose root branch is simply empty. The Free plan includes 100 projects.
  https://neon.com/docs/introduction/plans

**Getting the connection string.** The action's `db_url` output; or
`GET /projects/{project_id}/connection_uri`
(https://api-docs.neon.tech/reference/getconnectionuri); or `neon connection-string <branch>`
(https://neon.com/docs/reference/cli-connection-string).

**Deleting on PR close.** `neondatabase/delete-branch-action` (`v3`), with `project_id`, `api_key`
and `branch` (name or id). https://github.com/neondatabase/delete-branch-action The workflow needs
`closed` listed under `types:`, because by default `pull_request` workflows run only for `opened`,
`synchronize` and `reopened`.
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request
Neon's own example uses branch names of the form `preview/pr-<number>-<branch>` and a delete job
guarded by `github.event.action == 'closed'`. https://neon.com/docs/guides/neon-github-integration
A branch with child branches cannot be deleted. https://neon.com/docs/manage/branches#delete-a-branch

**Auto-expiry.** A branch can be given `expires_at` (RFC 3339, at most 30 days ahead); it is then
deleted automatically, with its compute. Expiry cannot be set on a default branch, a protected
branch, or a branch that has children, and children cannot be created from an expiring branch (so
`dev` must never get an expiry if it is the parent). https://neon.com/docs/guides/branch-expiration
**Contradiction:** the guide lists no plan restriction, but the API reference says of `expires_at`
"Access to this feature is currently limited to participants in the Early Access Program".
https://api-docs.neon.tech/reference/createprojectbranch Whether it works on this Free account is
unverified. Use it as a safety net, not as the only cleanup.

**Free-plan limits that matter at about one PR a week** (https://neon.com/docs/introduction/plans):

| Limit | Free plan | Effect here |
|---|---|---|
| Branches per project | 10; "Extra branches are not available on the Free plan" | 2 used today. Room for 8 previews at once. A full project makes branch creation fail outright, so orphans matter |
| Root branches per project | 3 | Rules out per-PR schema-only branches |
| Compute | 100 CU-hours per project per month | **Shared with production** if previews live in the same project. A preview's poller and health checks keep its compute awake |
| Storage | 1 GB per project, all branches together | Production is about 35 MB (logical size from the API). Child branches add only their changes |
| Scale to zero | After 5 minutes idle, cannot be disabled | See next point |

**Cold start.** An idle compute reactivates "within a few hundred milliseconds".
https://neon.com/docs/introduction/scale-to-zero and https://neon.com/docs/connect/connection-latency
Render's free instance separately spins down after 15 minutes without traffic and takes about a
minute to wake. https://render.com/docs/free#spinning-down-on-idle The Render service is in
`oregon` and the Neon project in `eu-central-1`, so every query crosses the Atlantic regardless.

**API keys.** Personal keys reach every project the user can; organization keys reach every project
in the organization; **project-scoped keys** reach one project, cannot delete it, and can only be
created by an organization admin. https://neon.com/docs/manage/api-keys Any key that can manage
project `empty-hill-56029538` can also read the production connection string through
`connection_uri` **(inference from the endpoint's existence; no read-only key type is documented)**.

---

## 3. Is there an official Neon + Render preview integration?

**No.** Neon's Render guide covers only pasting a connection string into a web service's
`DATABASE_URL`; it mentions that Render has PR previews but describes no branching setup.
https://neon.com/docs/guides/render Neon's integrations index lists Render only as that deploy
guide, whereas Vercel has a managed integration that creates a branch per preview deployment and
has its own cleanup page. https://neon.com/docs/guides/integrations and
https://neon.com/docs/guides/vercel-overview Neon's GitHub Actions guide is generic: it creates the
branch and leaves "send the connection details to a hosting platform" to the user.
https://neon.com/docs/guides/branching-github-actions Render's docs do not mention Neon on any page
read for this note.

---

## 4. Cleanup and failure modes

**Orphaned branches.** If the delete job fails, is skipped, or the workflow file is changed, the
branch stays. Eight orphans fill the Free plan's 10-branch limit and the next create fails. Guards:
`expires_at` on every preview branch (subject to the Early Access question above), a fixed name
prefix such as `preview/` so leftovers are easy to list, and the action's create-or-reuse behaviour
so a re-run never duplicates.

**Preview boots before its database URL exists.** With only the Render API route (1c) the first
boot uses the copied production URL and runs the PR's migrations on prod. With the start-path
switch (1d) and fail-closed behaviour, the first deploy simply fails until the branch exists; the
PR shows a failed preview instead of touching prod. Render keeps running "its most recent
successful deploy (if any)" on a failed deploy (https://render.com/docs/deploys), and a brand-new
preview has none.

**Secrets present in a preview.** The copy is wholesale, so a preview with a temporary database
still holds:

| Copied variable | What a preview can do with it | Notes from this repo |
|---|---|---|
| `DATABASE_URL` (prod) | Everything | Still in the environment even when the app ignores it |
| `JWT_SECRET` | **Impersonate any production user, admins included** | Tokens are `{userId, role}` signed with this secret (`server/services/auth-service.ts`). Anything holding the secret can sign a token for any `userId`. `requireAdmin` re-reads the role from the database, but it looks the user up by the token's `userId` in **production's** database (`server/middleware/auth.ts`), so a token carrying a real admin's id passes. A fresh preview database also numbers its users from 1, so ids issued by a preview collide with real production ids. Independent of where the preview's database points |
| `R2_*` | Write or delete production share pages and letter images (same bucket) | `syncSharesIfRendererChanged()` runs on boot; on an empty database the `publicSharePages` flag is absent, so it should do nothing **(inference)** |
| `RESEND_API_KEY` | Send real email from the production sender | Reachable through invite, magic-link and poller digest paths once the preview database has users |
| `CALENDLY_API_TOKEN` | Create real single-use booking links | Public route `/api/meetings/booking-link` |
| `ANTHROPIC_API_KEY` | Spend money | Summarize, beautify, and the poller when `COMMITTEE_AI=true` |
| `NEON_API_KEY` (if added for 1b/1d) | Manage the Neon project, including reading the prod connection string | Only if the key covers the prod project |

Dev sign-in cannot be switched on in a preview: `isDevLoginAllowed()` refuses whenever Render's
`RENDER` variable is set (`server/services/auth-providers/dev.ts`). So a preview on an empty
database has no way to log in at all unless an invite row is seeded, which also limits what a
preview is good for.

**The poller.** Each preview starts its own poller on boot. Against a temporary database its writes
are harmless, and with nothing tracked it has little to fetch. It still calls the external Knesset
APIs from one more instance, and its activity keeps the preview's Neon compute awake, which spends
compute hours.

**Cost.** Render: free, but each awake preview draws on the shared 750 instance hours per month;
if they run out, Render suspends **all** free web services, production included, until the next
month. https://render.com/docs/free#monthly-usage-limits Neon: free within the limits in section 2;
previews in the production project draw on production's 100 CU-hours.

**Workflow tampering.** On a `pull_request` event GitHub runs the workflow file from the pull
request itself, so a PR can change the workflow that holds `NEON_API_KEY` or `RENDER_API_KEY`.
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request
`pull_request_target` runs the base branch's version instead and is the safer trigger for a
workflow that only creates or deletes a Neon branch and never checks out PR code; read GitHub's
warnings on that event before using it.

---

## 5. Recommendation

### What a backend preview would add here

The frontend is on GitHub Pages and has no per-PR preview, and production `CORS_ORIGIN` points at
the Pages site. A Render preview is therefore a backend that can be reached with `curl`, on an
empty database, with no way to sign in. What it proves is "the PR's code boots and its migrations
apply". `.github/workflows/ci.yml` already proves that on every pull request, against a throwaway
`postgres:17` container, with no production secret anywhere near it.

One caveat for the unattended agent: "events triggered by the `GITHUB_TOKEN` will not create a new
workflow run" (apart from `workflow_dispatch` and `repository_dispatch`).
https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
If the weekly loop opens its pull requests with the repository's `GITHUB_TOKEN`, neither `ci.yml`
nor any create-branch workflow from option C runs on them. Render previews would still be created,
because Render reacts to the pull request through its own GitHub connection, not through Actions
**(inference)**. The loop needs a different credential (a GitHub App or personal token) for CI to
cover its pull requests.

### Recommended: keep previews off

"Just turn previews off" **remains the safer choice** for a solo developer, and it is also the one
that loses almost nothing:

- It is the only option that needs no new code, no new secrets, and no cleanup job.
- It is one of only two options that give a hard guarantee (the other is option B below).
- The unattended weekly agent is exactly the case where running PR code beside production secrets
  before a human has read the diff is least acceptable.
- The decision already recorded on 2026-10-04 in
  `docs/superpowers/plans/2026-10-04-solo-dev-workflow.md` stands. Note the live service still
  reads `automatic`; the dashboard change has not been made yet.

Developer does by hand: Render Dashboard → service `liberal-page` → **Previews** tab → Pull Request
Previews → off. Verify by reading the service back (`previews.generation` should read `off`).

### If previews are wanted later

**Option B: previews from a second service that never held production secrets (hard guarantee).**
A preview copies from *its own* base service. So:

1. Leave previews **off** on `liberal-page`.
2. Create a second free web service from the same repo and branch, for example
   `liberal-page-preview`, with its own environment: `DATABASE_URL` pointing at a non-production
   Neon database, and no Resend, Calendly, Anthropic or R2 variables (the app already treats each
   of those as "feature off" when unset, per `CLAUDE.md`). A **different `JWT_SECRET` is
   mandatory**: with the production value, a preview can sign tokens for production users.
3. Turn previews on, in **manual** mode, on that second service only.

Nothing a preview inherits can then reach production, whatever the PR's code does. This uses only
documented behaviour, but Render does not describe it as a pattern **(inference; untested)**. Costs:
a second service to keep in step by hand (build and start commands, Node version), a second deploy
on every push to `master`, and free instance hours whenever it is awake. With one shared preview
database this needs no Neon API key at all; the database can be reset after each PR with Neon's
"reset from parent", which keeps the connection string unchanged
(https://neon.com/docs/guides/reset-from-parent).

**Option C: B plus one database per pull request.** Add on top of B:

1. Put preview databases in a **separate Neon project** with a project-scoped API key, so the key
   cannot see production and previews do not spend production's compute hours.
2. Workflow on PR `opened`/`reopened`: `create-branch-action` with an explicit `parent_branch`, a
   name derived from the PR's branch (the only per-PR value the preview can see is
   `RENDER_GIT_BRANCH`), and `expires_at` about 14 days out; then add the `render-preview` label.
3. Start-path code on the preview: when `IS_PULL_REQUEST === 'true'`, look up the branch for
   `RENDER_GIT_BRANCH` through the Neon API, set `DATABASE_URL`, and exit if it is not found.
4. Workflow on PR `closed`: `delete-branch-action`. Removing the label or closing the PR removes
   the Render preview by itself.

**Not recommended: the switch alone on the production service** (1d without B). It fixes the
accident that prompted this note, and it is the least work, but the production secrets stay in
every preview's environment and the protection is a file the PR can edit. If it is ever used, pair
it with manual mode so no preview starts before the diff has been read.

### What the developer must do by hand, for B or C

- Create the second Render service and enter its variables (dashboard).
- Create the Neon preview project or branch, and the API key (Neon console; project-scoped keys
  need organization-admin rights).
- Add `NEON_API_KEY` and the project id to GitHub repository secrets/variables.
- Create the `render-preview` label in the GitHub repository.
- These are deploy and CI configuration changes, so they fall under the repo's **risky** tier:
  spec, plan, and confirmation before pushing.

---

## Not verified

Each of these is either absent from the docs or contradictory, and none was tried.

1. Whether `previewValue` (or the `sync: false` exclusion) applies to single-service PR previews of
   a Blueprint-managed service on a non-Pro workspace. The docs only speak of preview environments.
2. Which workspace plan this account is on (assumed Hobby; only the service's `free` instance plan
   was confirmed).
3. That a preview of a second "preview base" service inherits only that service's variables and
   nothing from `liberal-page`. Follows from the documented copy rule; untested.
4. How a preview's `RENDER_SERVICE_NAME` is formed, and whether `RENDER_GIT_BRANCH` in a preview is
   exactly the PR's head branch name. The docs give one generic sentence for each.
5. How to identify a given PR's preview through the Render API (`parentServer` exists in the schema;
   the mapping to a PR is undocumented), and whether the single-variable `PUT` triggers a deploy.
6. How long after a label or PR event Render starts the first deploy, that is, how wide the race in
   1(c) is.
7. Whether `expires_at` works on this Free Neon account (guide says yes without restriction; API
   reference says Early Access only).
8. Whether `dev` is a root branch (`init_source: parent-schema`, which the API describes as a
   schema-only copy *from a parent*, but the listing shows no parent id), and so how many of the
   3 root-branch slots are in use.
9. Whether creating a child from the archived `dev` branch works without delay, and whether dev's
   Drizzle journal is in step with its tables today.
10. That `syncSharesIfRendererChanged()` and the poller are side-effect-free on an empty database.
    Read from code, not run.
11. Free-instance behaviour of previews under the 750-hour pool when several are open; the docs
    state the pool rule but not how previews are counted beyond "billed at the same rate".
12. Which credential the weekly loop will use to open pull requests (it is not built yet), and so
    whether CI and any branch-creating workflow will run on its pull requests at all.
13. No secondary sources (blogs, forum posts) were used, so there is no claim in this note that
    rests on one. Community workarounds for Render + Neon previews may exist and were not surveyed.
