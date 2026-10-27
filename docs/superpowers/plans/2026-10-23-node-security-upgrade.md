# Node.js October 2026 security upgrade — plan

Spec: `docs/superpowers/specs/2026-10-23-node-security-upgrade-design.md`. Issue: #54.

1. `npm audit fix` (no `--force`); check that `package.json` dependency ranges are unchanged.
2. Pin `22.23.4` in `.nvmrc`, `render.yaml`, `.github/workflows/{ci,deploy,test}.yml`; set
   `engines.node` to `>=22.23.4`, then `npm install --package-lock-only` to sync the lockfile root.
3. Update `docs/dev-setup.md` (Node row).
4. On Node 22.23.4 itself: `npm ci`, then the gate (`npm run -s loop:gate`) and `npm run smoke`.
5. Independent review of the diff against this spec.
6. Commit, then **stop and confirm with the developer before pushing** (risky tier).
7. After the merge to `master`: check that the Render deploy log shows Node 22.23.4 and that
   `https://liberal-page.onrender.com/api/health` returns 200. Then tick the issue's checklist.
8. Open a follow-up issue (with the developer's approval) for the major-version upgrades listed
   in the spec.
