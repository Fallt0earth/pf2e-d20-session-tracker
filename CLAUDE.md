# pf2e-d20-session-tracker

Read docs/SCOPE.md (requirements, decisions D1–D5, PF2e specifics) then docs/PLAN.md (current plan, status checklists, verified findings) before any work. Update the PLAN.md checklists as milestones land.

Target: Foundry VTT v13 build 351 + PF2e 7.12.2, hosted on The Forge. Use only APIs unchanged in v14 (ApplicationV2, record-shaped scene controls, `message.author`, `foundry.*` namespaces).

Dev/test instance: a felddy Docker container on the owner's NAS. Its URL and SSH target are in `dev/local.json` and `dev/local.ps1`, which are git-ignored on purpose. Deploy with `.\dev\deploy.ps1` (sync only; `-Compose` after compose changes, `-Restart` to restart the container). Never hand-edit files under the host's `app/` folder. Before any SSH or deploy step read `docs/nas-quickstart.MD` (local only, git-ignored) and follow its rules without exception: BatchMode ssh, no secrets in the repo or in output, no array/network/DNS actions. Never test against the Forge game except at the deploy gates in PLAN §5.

This repository is PUBLIC. Never commit host names, IP addresses, logins, port inventories, other projects' scripts, or anything from `docs/nas-quickstart.MD`, `dev/reference/`, `dev/local.*`. Check `git status` before every commit; never `git add -A` without reading the list.

Code rules: `scripts/stats/**`, the normalizer and extractors, and `scripts/sessions/bucket.js` import nothing from Foundry and use no Foundry or DOM globals (ESLint enforces it). Never call `Roll` in stats or Monte Carlo code. One normalizer for live capture and catch-up. Record ids are deterministic. Run `npm test` and `npm run lint` before declaring anything done. Never reuse a released version number.
