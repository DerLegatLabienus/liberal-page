# Weekly loop — instructions for the unattended agent

You are the weekly loop for the liberal-page repo. Nobody is watching this run. You take **one**
backlog item, open **one** pull request for it, and stop. The developer reviews and merges by hand.

Design: `docs/superpowers/specs/2026-10-04-solo-dev-workflow-design.md`. Project rules: `CLAUDE.md`.

## Hard limits

- **Never push to `master`. Never merge a pull request.** Your only output is a PR.
- **Never touch the risky tier**, even if the item seems to need it:
  1. database migrations or any schema change;
  2. auth and access control (sign-in, tokens, the invite allowlist, admin gating);
  3. production data scripts (seeds, backfills, any one-off against the prod database);
  4. deploy and CI configuration (`.github/`, `render.yaml`, environment variables).
  If the item cannot be done without one of these, follow **Blocked** below.
- Work only on the item you were given. Do not pick, invent or bundle other work.
- Never use production credentials or a production database connection.

## Steps

1. **Pick the item.** Run `npm run loop:next`.
   - Exit code 2 (too many loop PRs open): stop. Report which PRs are open. Do nothing else.
   - Prints `none`: stop. Report that no eligible `[loop-safe]` item exists. Do nothing else.
   - Prints JSON `{"id":"LibPage-NNN","title":"...","openPrs":[...]}`: that is your item. Read its
     full entry in `BACKLOG.md`. `openPrs` lists earlier loop PRs that are still open; their items
     were already skipped for you.
   - Any other failure: stop and report the error. Do not choose an item by reading the backlog
     yourself.

2. **Branch.** This is ordinary trunk-based development: one short-lived branch off an up-to-date
   `master`, named `<type>/LibPage-NNN-short-slug`, where `<type>` is the conventional-commit
   type of the change (`feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`) and the slug is
   two to four lowercase words. Example: `fix/LibPage-009-auth-button-token`. The ID in the
   branch name is how this PR is recognised later, so it must be there, exactly as printed.
   Never base your branch on another open PR's branch.

3. **Implement** the item and nothing more. Follow `CLAUDE.md`: `docs/design-system.md` for any
   UI, `GLOSSARY.md` for terms, tests in the matching feature folder. Add or update tests for the
   behaviour you change. Update the docs the change makes stale. Use conventional commit
   messages.

4. **Check for collisions with work in flight.** For each number in `openPrs`, run
   `gh pr diff <number> --name-only` and compare with your own changed files
   (`git diff --name-only origin/master...HEAD`).
   - `BACKLOG.md` overlapping is expected (every loop PR removes its own item); ignore it.
   - If another open PR adds a database migration, or your item would need one, that is risky
     tier: follow **Blocked**. Two branches must never each add a migration.
   - Any other overlapping file: carry on, and list the overlapping files and PR numbers in your
     PR body under "Overlaps", so the developer can choose the merge order.

5. **Run the gate — all four must pass:**
   `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
   If you cannot get it green, follow **Blocked** below. Never open a normal PR for a red build.

6. **Remove the item from the backlog** in the same branch: delete its `## LibPage-NNN — …`
   section and its line in the Now / Next / Later list in `BACKLOG.md`. Do not renumber anything
   and do not reuse the ID.

7. **Open the pull request** against `master`:
   - Title: a conventional-commit subject ending with the ID, e.g.
     `fix(auth): use the primary token in AuthControl (LibPage-009)`
   - Label: `loop`. If adding the label fails, open the PR without it and say so in the report;
     the branch name is enough for the PR to be recognised.
   - Body: the backlog item's ID and title; what you changed and why; **what you verified and
     how** (gate results with test counts, any manual check); "Overlaps" if step 4 found any; and
     anything you could **not** verify, stated plainly. Never describe a check you did not run as
     passed.

8. **Stop.** Do not respond to review comments, do not push follow-up commits unprompted, and do
   not start a second item.

## Blocked

When the item needs risky-tier work, or you cannot get the gate green, the backlog must end up
explaining why, so the developer knows what the item really involves and the loop does not pick
it again. You cannot push to `master`, so the explanation travels in a small docs-only PR:

1. Discard your code changes and start a clean branch off `master` named
   `docs/LibPage-NNN-blocked`.
2. Edit only the item's entry in `BACKLOG.md`:
   - remove `[loop-safe]` from its heading;
   - add `[risky]` to the heading if risky-tier work is the reason;
   - append a section to the item:

     ```
     **Loop attempt YYYY-MM-DD — blocked.**
     - **Why it is harder or riskier than it looked:** the specific risky area and why the
       item cannot be done without it (which table, route, workflow or secret), or the exact
       gate step that failed with its key output.
     - **What was tried:** the approach taken and how far it got.
     - **What it would take:** the migration, design decision or prerequisite item needed first.
     ```

     Be concrete: name files, routes and error messages. A vague note is worse than none.
3. Open a PR titled `docs(backlog): record why LibPage-NNN is blocked (LibPage-NNN)`, label
   `loop`, with the same explanation in the body.

The developer merges it (it changes only the backlog), which records the explanation and removes
the tag. If they close it instead, the item is treated as rejected and is not retried.

## Report

End with a short report: the item taken (or why none was), the PR link (or why none was opened),
and the gate result.
