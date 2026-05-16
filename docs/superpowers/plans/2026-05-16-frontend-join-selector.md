# Frontend-Only Join Selector — Implementation Plan

**Goal:** Replace the inactive local join form with a safe frontend-only selector that routes users to official effective-soft forms.

**Key constraints:** No `POST /api/members/join`, no `members.json`, no local collection of ID/payment/signature data, and no proxying effective-soft's private `Contact` endpoint.

## Implementation

1. Add `JoinSelector` under `src/components/parliament/`.
   - Maintain status/mode state locally.
   - Map status + mode to the four official effective-soft URLs.
   - Disable the main CTA until both choices are selected.
   - Include WhatsApp support and direct fallback links.

2. Replace `JoinSection` content.
   - Render explanatory copy and `JoinSelector`.
   - State that sensitive details are entered only in effective-soft.

3. Update hero CTA.
   - Link to `#join` instead of bypassing the selector.

4. Remove obsolete local form path.
   - Delete inactive `JoinForm.tsx`.
   - Remove `joinFormUrl` from `SiteConfig` and `site.json`.
   - Update backlog and docs to remove local storage/backend-submit guidance.

5. Add focused tests.
   - CTA is disabled until both choices are selected.
   - Existing Likud couple route opens `licudliberal4`.
   - Renewal individual route opens `licudliberal`.

## Acceptance

- Users can choose the correct path without entering personal data locally.
- The selected CTA opens the official effective-soft URL in a new tab.
- No backend member route or local member JSON file exists.
- Tests, build, and lint pass.

