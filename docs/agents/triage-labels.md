# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker. The meaning of each, and the triage checks, are in
[`backlog-rules.md`](backlog-rules.md).

| Label in mattpocock/skills | Label in our tracker | Meaning |
| -------------------------- | -------------------- | ------- |
| `needs-triage`             | `needs-triage`       | Not assessed yet |
| `needs-info`               | `needs-info`         | Waiting on the developer (or the issue's author) for a decision or more information |
| `ready-for-agent`          | `ready-for-agent`    | Assessed, clear and wanted; the unattended loop may take it. Applied only when the developer says so |
| `ready-for-human`          | `ready-for-human`    | Wanted, but the developer builds it, in a trunk-lane session |
| `wontfix`                  | `wontfix`            | Not wanted, or already done. Labelled and explained; the developer closes it |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

Each role's label has the same name as the role (since 2026-10-15).
