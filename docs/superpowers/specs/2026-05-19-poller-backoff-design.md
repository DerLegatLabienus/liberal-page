# Poller — Backoff on Failure Design

**Date:** 2026-05-19
**Status:** Approved
**Backlog item:** #11

---

## Problem

`startPoller()` uses `setInterval(runPollCycle, INTERVAL_MS)`. Individual fetch
errors are caught silently inside each sub-poll. When all three external APIs
(oknesset, Knesset OData) are unreachable simultaneously, the poller retries at
the normal 6-hour interval with no indication anything is wrong, and no
reduction in request frequency during an outage. On Render's free tier, where
the server restarts frequently, the poller fires immediately on each startup —
multiplying requests during network trouble.

---

## Design

### Constants

```typescript
const BACKOFF_INITIAL_MS = 60_000    // 1 minute  — minimum delay on failure
const BACKOFF_MAX_MS     = 600_000   // 10 minutes — maximum delay on failure
// INTERVAL_MS stays as-is (env var, default 6 hours)
```

### Poll function return type

Each of `pollBills`, `pollCommittees`, `pollMks` changes from `Promise<void>`
to `Promise<boolean>`:

- `true`  — no items to poll, OR at least one item fetched successfully
- `false` — items existed but every single fetch call threw an error

The internal per-item `try/catch` blocks stay; the function returns `false`
only when the overall result of the loop is total failure.

### `runPollCycle` return type

Changes from `Promise<void>` to `Promise<boolean>`. Uses `Promise.allSettled`
to run all three sub-polls, then returns `true` if at least one resolved to
`true`.

### `startPoller` — backoff loop

Replaces `setInterval` with a recursive `setTimeout`:

```typescript
let currentDelayMs = INTERVAL_MS

async function runAndSchedule(): Promise<void> {
  const success = await runPollCycle()
  if (success) {
    currentDelayMs = INTERVAL_MS
  } else {
    currentDelayMs = Math.min(currentDelayMs * 2, BACKOFF_MAX_MS)
    currentDelayMs = Math.max(currentDelayMs, BACKOFF_INITIAL_MS)
    console.warn(`Poller: all polls failed — backing off ${currentDelayMs / 1000}s before next cycle`)
  }
  setTimeout(runAndSchedule, currentDelayMs)
}

export function startPoller(): void {
  runAndSchedule()
}
```

State: single module-level `let currentDelayMs = INTERVAL_MS`. No new classes
or abstractions.

### Backoff sequence on sustained failure

| Cycle | Delay before next |
|-------|------------------|
| 1st failure | 60s (BACKOFF_INITIAL_MS floor) |
| 2nd failure | 120s |
| 3rd failure | 240s |
| 4th failure | 480s |
| 5th+ failure | 600s (BACKOFF_MAX_MS cap) |
| Any success | reset to INTERVAL_MS (6h) |

---

## Files changed

| File | Change |
|------|--------|
| `server/services/poller.ts` | Return types, backoff loop, constants |
| `tests/server/poller.test.ts` | New — one test for `runPollCycle` returns `false` when all sub-polls fail |

---

## Out of scope

- Per-sub-poller independent backoff (overkill for this scale)
- Persisting backoff state across server restarts
- Alerting / webhook on sustained failure
