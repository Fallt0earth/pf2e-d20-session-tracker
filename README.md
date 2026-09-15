# PF2e d20 Session Tracker

A Foundry VTT v13 module for the Pathfinder Second Edition system. It records every natural d20 each player rolls, groups the rolls by evening of play, and shows who ran hot or cold tonight with honest statistics, plus fun session aggregates (full 1–20 result tables, streaks, awards).

Status: pre-alpha, under construction. See `docs/PLAN.md` for the plan and current state, `docs/SCOPE.md` for requirements and decisions.

## Requirements
- Foundry VTT 13.351 (v13 line)
- PF2e system 7.12.x
- No dependency on Dice So Nice, socketlib or libWrapper

## Install
Once released: Foundry setup → Add-on Modules → Install Module → paste the manifest URL from the latest GitHub release. On The Forge: Bazaar → Marketplace → Toolbox → Install from Manifest.

## Development
- `npm install` then `npm test` (pure stats/normalizer layer, `node --test`) and `npm run lint`.
- Dev instance on the NAS: `.\dev\deploy.ps1` syncs the module; `.\dev\deploy.ps1 -Init` for the first start. See `docs/nas-quickstart.MD`.

## Privacy note
Blind and secret roll results are stored in a GM-only journal and filtered out of the player-facing view. Like blind chat messages themselves, they are technically readable through the browser console by anyone with a client; the filter is a UI guarantee, not a cryptographic one.

## License
MIT. Patterns borrowed with attribution from Simple d20 stats (Yosoy-Ed), Roll Tracker (drexl93) and dice-stats (jacobwojoski), all MIT.
