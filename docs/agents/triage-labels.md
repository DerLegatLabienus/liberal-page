# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker. The meaning of each, and the triage checks, are in
[`backlog-rules.md`](backlog-rules.md).

| Label in mattpocock/skills | Label in our tracker | Meaning |
| -------------------------- | -------------------- | ------- |
| `needs-triage`             | `needs-triage`       | Not assessed yet |
| `needs-info`               | `needs-developer`    | Waiting on the developer (or the issue's author) for a decision or more information |
| `ready-for-agent`          | `loop-safe`          | Assessed, clear and wanted; the unattended loop may take it. Applied only when the developer says so |
| `ready-for-human`          | `ready-for-human`    | Wanted, but the developer builds it, in a trunk-lane session |
| `wontfix`                  | `wontfix`            | Not wanted, or already done. Labelled and explained; the developer closes it |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

**This mapping is temporary.** The repo is moving to the canonical names, so the right-hand
column will equal the left (`needs-developer` becomes `needs-info`, `loop-safe` becomes
`ready-for-agent`). That rename ships as one change with the loop's code and the reviewer
workflows; see `backlog-rules.md`. Update this table in the same change.
