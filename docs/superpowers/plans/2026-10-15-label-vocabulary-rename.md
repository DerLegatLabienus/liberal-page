# Plan: rename the workflow labels to the triage vocabulary (#38)

**Tier:** risky (touches `.github/workflows/`). **Spec:**
`docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md`, "Triage and one vocabulary".

## Goal

One vocabulary for the loop, the agent skills and developer sessions: `loop-safe` becomes
`ready-for-agent`, `needs-developer` becomes `needs-info`, and `needs-triage` is added
(`ready-for-human` was created when the tickets were filed; `wontfix` exists). No behaviour
changes: the picker selects the same issues, the reviewers flag the same PRs, under the new names.

## State on 2026-10-15

- `loop-safe` is on 4 issues (#17 and #18 open, #15 and #16 closed); `needs-developer` is on 4 closed PRs and no issues.
- No pull request is open, so no reviewer run can add the old label between the rename and the
  push.

## Changes

| File | Change |
|---|---|
| `scripts/loop/select-item.ts` | Label constants and comments |
| `scripts/loop/next-item.ts` | The issue query's label filter |
| `scripts/loop/issue.ts` | A comment's example heading that used the old label |
| `tests/unit/loop/select-item.test.ts`, `issue.test.ts` | Fixtures and names |
| `scripts/loop/PROMPT.md` | Hard limit, commands table, steps, Blocked section |
| `.github/workflows/pr-review.yml`, `claude-code-review.yml` | The reviewers' label instruction and its `--allowedTools` entry |
| `.claude/agents/*-reviewer.md` (4) | The label the reviewer adds |
| `docs/agents/backlog-rules.md` | Labels table; the "approved, not yet made" note removed |
| `docs/agents/triage-labels.md` | Identity mapping; the "temporary" note removed |
| `docs/agents/issue-tracker.md`, `CLAUDE.md` | Remaining mentions |

Dated specs, plans and research notes keep the old names: they record what was true then.

## Steps

1. Edit the files above; run the loop's unit tests, then the gate.
2. Independent review of the diff against the spec (fresh agent).
3. **Stop: the developer confirms, and pauses the routine in claude.ai.** While there, the
   developer checks that the routine's own saved instructions do not name `loop-safe` or
   `needs-developer`; they live outside the repo, so no search here can see them.
4. Rename on GitHub, immediately before the push:
   ```
   gh label edit loop-safe --name ready-for-agent --description "Assessed, clear and wanted; the loop may take it"
   gh label edit needs-developer --name needs-info --description "Questions for the author, or the loop is blocked"
   gh label create needs-triage --description "Not assessed yet"
   gh label edit wontfix --description "Not wanted, or already done; the developer closes it"
   ```
5. Push to `master`.
6. Check: `npm run -s loop:next` picks a `ready-for-agent` issue (read-only); the four issues
   that had `loop-safe` now show `ready-for-agent`.
7. The developer triggers one routine run by hand, then resumes the schedule.

## Rollback

Rename the two labels back with `gh label edit`, and revert the commit. Both are quick; nothing
else changes state.
