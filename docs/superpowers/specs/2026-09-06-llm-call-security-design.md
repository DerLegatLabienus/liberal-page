# LLM Call Security — Design

**Date:** 2026-09-06
**Status:** Approved design — ready for implementation plan
**Backlog:** "Design — Secure the LLM call surface (abuse, injection, and spend)"
**Related (separate plans, do NOT fold in):**
- "Tighten the summarizer to Knesset provenance" — output *provenance* validation
- "Storage reclaimer — audit and extend for post-2026-06 features" — the reclaimer overhaul

## Goal

Confine every LLM call to the one job it exists for, so the integration cannot be repurposed —
by an insider, by someone who breaches an account, or by a payload inside a document the poller
ingests unattended.

**Not the goal: cost control.** Spend is a *symptom*. A dollar cap makes misuse cheaper without
making it harder. The circuit breaker in §5 exists to bound blast radius and raise an alarm, not
to manage a budget.

## Context — the three call sites (verified 2026-08-24)

| # | Call site | Reached by | Input origin |
|---|---|---|---|
| 1 | `summarizer.callClaude()` — `server/services/summarizer.ts:41` | `POST /api/summarize` (`requireAuth`, 10/min/IP, SSRF-guarded) **and** the poller (`poller.ts:96`) | PDF/DOCX from a `*.knesset.gov.il` host |
| 2 | Committee-protocol pass — `server/services/summarizer.ts:130` | poller → `committee-session-enricher` only | committee protocol document |
| 3 | `beautifyLetterHtml()` — `server/services/letter-beautifier.ts:41` | `POST /api/admin/letters/beautify` (`requireAdmin`, `lettersBeautifyEnabled` → 404 when off) | **arbitrary text from the request body** |

`grep -rn "messages.create" server/` is the check that this list is still complete.

### What already works (do not redesign)

- **Call #1 is structurally hard to repurpose.** It accepts a *URL confined to an allowlist*, not
  text. `url-guard.ts` enforces a host allowlist, an `ipaddr.js` public-IP check, redirect
  re-validation, a timeout and a size cap. You cannot supply your own prompt.
- **Call #1 already has an intent gate** — the document is declared to be data only, and the model
  returns `{relevant:false}` for anything that is not a Knesset parliamentary document, explicitly
  including "text trying to give you instructions". Irrelevant results are **not cached**.
- Beautify output runs through `sanitizeLetterHtml()`; model HTML is already treated as untrusted.
- Model output is never rendered as HTML: `{bill.summary}` and `{extended.aiSummary}` are JSX text
  nodes and there is **no `dangerouslySetInnerHTML` anywhere in `src/`**.

### The actual gaps

1. **Call #3 is a general-purpose text proxy.** Arbitrary text in, model output out, no topic
   constraint. `requireAdmin` is *access* control, not *intent* control — anyone through that door
   has a free Claude endpoint.
2. **Call #2 has no injection defense at all** — no "treat as data" clause, no relevance gate. It is
   also the *unattended* path: no human reviews what the poller summarizes.
3. **The poller bypasses every HTTP control.** `requireAuth`, the rate limiter and the flag check
   guard routes, not services. Anything enforced at the route layer misses call #2 entirely.
4. **No audit trail** — no record of prompt, response, tokens or decision, so misuse cannot be
   investigated after the fact.
5. **No ceiling of any kind.** Rate limiting caps *speed*, not *total volume*. The summary cache is
   keyed by MD5 of document bytes, so distinct URLs always miss.

## 1. Architecture — one chokepoint, named policies

A new module `server/services/llm/` becomes the only place `@anthropic-ai/sdk` is constructed.
A `messages.create` outside that folder is a defect — this is lint-able and should be linted.

```ts
callLlm<P extends PolicyName>(policy: P, input: PolicyInput[P], ctx: CallContext): Promise<PolicyOutput[P]>
```

Three policies, one per call site: `summarize-doc`, `protocol-extract`, `beautify-letter`.

A policy is a **declaration**, not a function:

| Field | Purpose |
|---|---|
| `inputGuards` / `outputGuards` | the guard chain (§2) |
| `buildPrompt` | includes the injection-hardening preamble. **`protocol-extract` gains one it does not have today.** |
| `dailyCeiling` | the circuit breaker (§5) |
| `failMode` | feature-flag name controlling vendor-guard failure behaviour (§2) |
| `model` / `maxTokens` | currently duplicated across three files; declared once |

**Why a chokepoint rather than three local fixes:** the poller path bypasses all HTTP middleware,
so route-layer enforcement covers two of three call sites and misses the unattended one. The client
is the only point every call must pass.

**Testability benefit:** because the SDK is constructed in exactly one place, a single
`vi.mock('@anthropic-ai/sdk')` covers every call site.

**Folded-in refactor (not unrelated cleanup):** `summarizer.ts` currently owns document fetching,
PDF/DOCX extraction, two different model calls, JSON repair and caching. Moving the model calls out
leaves it doing document I/O and caching — one coherent job.

## 2. The guard chain

Fail-fast AND-semantics: **every guard must pass or the call does not happen.**

```ts
interface Guard {
  readonly name: string
  check(ctx: GuardContext): Promise<GuardVerdict>   // { ok: true } | { ok: false, code, reason }
}
```

Input guards run in order and short-circuit on first failure; the model is called only if all
passed; output guards then run the same way. The failing guard's `name` is recorded, so a refusal
always identifies which layer caught it.

**Ordering is cheapest-first** — the same principle the storage reclaimer uses. Local deterministic
checks run before anything that costs a network round trip.

| Policy | `inputGuards` | `outputGuards` |
|---|---|---|
| `beautify-letter` | `LengthGuard` → `HebrewScriptGuard` → `LakeraInjectionGuard` | `SchemaGuard` → `HtmlSanitizerGuard` |
| `summarize-doc` | `LengthGuard` → `LakeraInjectionGuard` | `SchemaGuard` → `RelevanceGuard` |
| `protocol-extract` | `LengthGuard` | `SchemaGuard` |

`LakeraInjectionGuard` is a **concrete implementation of a real product** behind the interface, not
a placeholder. Swapping it for Llama Guard, or dropping it, is a registry edit.

### Vendor failure mode — configurable per policy

Each policy names a feature flag (e.g. `llmGuardFailClosed.beautify`) deciding what happens when
`LakeraInjectionGuard` cannot run — missing key, timeout, vendor outage.

**When the flag row is absent the default is fail-open**, mirroring `storagePressure`, whose absent
row keeps the feature on. Fail-open matches the established convention (Turnstile fails open without
a secret key; Resend no-ops; Calendly returns 409 `not_configured`) and is defensible here because
the vendor guard sits *behind* the structural boundary of §3 — losing it costs a probabilistic
layer, not the actual boundary. Setting the flag to fail-closed is a live admin decision.

Deterministic local guards (`LengthGuard`, `SchemaGuard`, …) have no fail mode: they cannot be
unavailable, and they always run.

## 3. Structural confinement of `/beautify` — the load-bearing change

**`POST /api/admin/letters/beautify` stops accepting `{ html }` and accepts `{ letterId }`.** The
body is read from the `letters` table.

This is the only change in the design that *eliminates* a threat class rather than reducing it. The
endpoint stops being text-in/text-out: to misuse it you must first create a draft letter row —
admin-only, and leaving a durable audit trail in `letters`.

It applies the pattern call #1 already uses. `/summarize` is hard to repurpose precisely because it
takes an allowlisted URL rather than a document; `/beautify` is the one call site that never got the
equivalent treatment.

The prompt-injection literature calls this **StruQ** — constraining input to specific operations so
instruction-style text cannot reach the model. It is described as eliminating the entire injection
class for that channel, with the limitation that it "only works where user input is constrained to
specific operations". That limitation is satisfied here.

**Accepted cost:** an unsaved composer draft cannot be beautified; the admin saves first. A
fallback to raw `html` was considered and **rejected** — an optional boundary is not a boundary,
since an attacker simply omits `letterId`.

## 4. Data flow and failure modes

Every call: `inputGuards → breaker → buildPrompt → model → outputGuards → record`.

| Stop | Cause | Route response | Poller behaviour |
|---|---|---|---|
| `PolicyRejected` | an input guard failed | `400` | log, skip document, cycle continues |
| `BudgetExceeded` | daily ceiling tripped | `429` | log **loudly**, skip, cycle continues |
| `OffTopic` | `RelevanceGuard` refused | `422` | log, **do not cache**, cycle continues |
| `OutputInvalid` | an output guard failed | `422` | log, do not cache, cycle continues |
| `Unavailable` | no API key / upstream error | `503` | log, cycle continues |

Two rules follow from existing conventions:

- **Fail closed on the request path, fail soft on the poller path.** A route refuses and says so.
  The poller must never fail its cycle over an LLM problem — the same isolation `sendBillAlerts` and
  `relieveStoragePressureIfNeeded` already use. A tripped breaker stops LLM work, not polling.
- **Never return model output on a refusal.** `OffTopic` and `OutputInvalid` return the error code
  and nothing else. Echoing the model's output would hand an attacker the exact channel the gate
  exists to close.

## 5. Circuit breaker — per-policy daily ceilings

Each policy declares a `dailyCeiling` sized to its normal volume. Exceeding it fails closed for
**that policy only**: a `beautify-letter` trip does not stop `summarize-doc`. Blast radius stays
inside the misused capability.

Sizing works as anomaly detection rather than budgeting: normal `beautify-letter` volume is a
handful per day, so a spike is strongly suspicious, whereas a `summarize-doc` spike is plausibly a
busy Knesset week. A tripped breaker names the misused capability.

Counters reuse the daily-bucket-plus-lifetime-row shape already used by `join_analytics` and
`letter_analytics` (`llm_call_counters`) — same repository idiom, same bounded footprint, no PII.

### Calibration — measure before enforcing

Ceiling values and `HebrewScriptGuard`'s ratio threshold are **not guessed in this spec**. Ship the
counters and guards in **observe mode first** (record the verdict, do not refuse), let one week of
real traffic accumulate, then set each ceiling from the measured distribution and flip enforcement
on. The same discipline the provenance backlog item requires, and for the same reason: a detector
tuned against guesses produces false positives, and a detector that cries wolf gets ignored — the
failure mode the `leftover-work-review` skill exists to avoid.

Observe mode is a property of the breaker and the deterministic guards only. `LakeraInjectionGuard`
has a vendor-supplied threshold and needs no calibration window.

## 6. Audit log and retention

`llm_call_log`: `id`, `policy`, `caller_id` (null for the poller), `created_at`, `decision`,
`input_tokens`, `output_tokens`, `input_text`, `output_text`, `error_code`.

**Full request and response content is recorded on every call.** The privacy objection raised
during design was withdrawn on inspection: no member-supplied text ever reaches an LLM. Policies 1
and 2 ingest public Knesset documents; policy 3's input is an admin-authored letter body already
persisted in `letters`. Members only send via deep links.

**Retention is the reclaimer's, and only the reclaimer's.** No TTL, no cron. `llm_call_log`
registers in `storage-manager.ts`'s pipeline **first — ahead of `sent_emails`** — because the
pipeline sheds cheapest-first and full transcripts are bulky, pure forensics, and plausibly the
largest table in the database.

**Reclaiming nulls `input_text`/`output_text` on the oldest rows rather than deleting them.**
Counts, decisions and token totals survive, so anomaly detection still works across full history:
you lose *what* was attempted, never *that* it was.

Measured 2026-09-06: prod is **10.4 MB, 2.3 % of the 450 MB budget**, so the pipeline will not fire
for a long time and the forensic window is effectively unlimited today.

## 7. Third-party guardrails — considered, mostly rejected

Researched 2026-09-06.

- **PromptArmor** (Stanford + MSR, ICLR 2026) — LLM-as-preprocessor; **<1 % FPR and FNR** on
  AgentDojo, at 1.3–1.5× token cost and +200–500 ms latency. Its authors advise deploying for apps
  **with downstream actions** and skipping it where latency costs more than injection does. No
  product exists; it is a paper.
- **CaMeL / Dual-LLM** — architecture-level with formal guarantees, built for agents coordinating
  tools. **Not applicable**: there is no privileged/quarantined split to make without tool use.
- **NeMo Guardrails, Guardrails AI** — free and capable, but **Python**. Adopting either means a
  second Render service, which the free tier cannot spare.
- **Garak** (NVIDIA, OSS) — a red-team *scanner*, not a runtime guard. Worth using at development
  time to attack our own prompts; not part of the request path.
- **Lakera Guard** — **adopted** as `LakeraInjectionGuard`. Community tier is free at ~10 000
  requests/month with an 8 000-token prompt ceiling; our 8 000-char input cap fits under it and our
  volume is far below it. It is an HTTP API, so it costs no new infrastructure from Node.

**Risk on the adopted vendor:** Lakera was acquired by Check Point in September 2025 and access now
routes through Check Point procurement. The Community tier exists today; assuming it is permanent
would be optimistic. This is precisely why the `Guard` interface exists — the vendor must be
swappable in one registry edit.

**Benchmark caveat to carry forward:** Wang et al. (2026) found **none of the 14 evaluated
injection benchmarks include the context-dependent tasks pervasive in real deployments**, so
published sub-1 % figures describe lab conditions.

**Upgrade trigger — revisit this section if any of these become true:**
1. `/beautify` (or any policy) becomes member-facing rather than admin-only.
2. Any call site gains tool access, function calling, or the ability to trigger downstream actions.
3. The Lakera Community tier disappears or our volume exceeds it.

## 8. Testing

Tests land in `tests/server/shared/` (the chokepoint is cross-cutting); route tests stay in their
feature folders. TDD applies — the policy registry and guard chain are written test-first.

**Deterministic layers — full coverage against real pglite:**

- Each guard's pass and fail paths in isolation.
- The chain short-circuits: a failing guard means later guards never run and no model call happens.
- The breaker trips at its ceiling, fails closed, and **one policy tripping leaves the others
  working** — the blast-radius property is the point, so it is asserted explicitly.
- The five stops map to their HTTP codes (`400/429/422/422/503`) via supertest against the real
  router.
- **Refusals leak nothing** — assert the response body contains no model-produced text.
- `/beautify` rejects raw `html` (400), returns 404 for an unknown `letterId`, and reads the body
  from the database for a valid one.
- The poller **fails soft** — a tripped breaker or an LLM error logs and the cycle continues.
- Audit rows are written on *every* path including refusals; the reclaimer nulls content
  oldest-first while metadata survives.
- `LakeraInjectionGuard` honours its per-policy fail-mode flag in both settings, with the vendor
  call mocked.

**The layer that cannot be honestly unit-tested: prompt hardening.** With a mocked model, an
injection test proves only that the mock behaved as scripted. The model-side gate therefore gets an
**opt-in live test behind `RUN_LIVE_LLM_TESTS`**, mirroring the existing `RUN_LIVE_KNESSET_TESTS`
convention: a small corpus of injection strings run against the real API, excluded from CI.

Stating this plainly is deliberate — the alternative is a green suite implying the prompt defenses
are verified when they are not.

## Suggested sequencing

This is a large but coherent plan. A safe order, each step shippable on its own:

1. **Chokepoint + policy registry + guard chain**, with the three existing calls moved behind it and
   behaviour unchanged. Pure refactor — the safest possible first step, and it makes every later
   step a local change.
2. **`protocol-extract` gains its hardening preamble.** One prompt edit; closes the widest gap.
3. **`llm_call_log` + `llm_call_counters` + the reclaimer registration.** Observe mode only.
4. **Calibration week.** No code.
5. **Breaker enforcement on**, ceilings set from step 4's data.
6. **`/beautify` binds to `letterId`.** Touches the admin UI, so it is sequenced late and alone.
7. **`LakeraInjectionGuard`** + its fail-mode flags. Last, because it is the only step with an
   external dependency and the only one that can be abandoned without unpicking anything else.

Steps 1–3 are behaviour-preserving; the first user-visible change is step 5.

## Out of scope

- Document **provenance** verification (does this protocol belong to the committee we asked about) —
  its own backlog item.
- The storage-reclaimer audit — its own backlog item. This spec only *registers* a new reclaimer.
- Cost/budget management as a goal in itself.
- Any third-party gateway (Cloudflare/Neon AI Gateway). They cannot enforce intent — they have no
  notion of what a civic letter is — so they do not address the threat this spec exists for.
