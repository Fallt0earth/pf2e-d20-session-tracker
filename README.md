# PF2e d20 Session Tracker

A Foundry VTT v13 module for the Pathfinder Second Edition system. It records every natural d20 each player rolls, groups the rolls by evening of play, and shows who ran hot or cold tonight with honest statistics, plus fun session aggregates: full 1–20 result tables, streaks, degree-of-success splits, hero-point reroll returns, awards, and a chat summary card.

## What it measures
Luck is the natural die only. Totals and outcomes mix in modifiers and DCs, so they are not luck. Everything is compared with a fair d20, and the first thing you see is plain: a **luck percentage** ("luckier than 86% of evenings with this many rolls"; 50% is dead average), the **average roll** against the fair 10.5, the **share of high rolls** (11 or more; fair is 50%) and **Nat 20 / Nat 1 counts with their rate** (fair is 5%). The statistics behind the percentage (z-score, exact percentile, tail probabilities) are one click down, in the expanded row and in tooltips. Below 15 rolls the luck figure is greyed; below 5 it is not shown. "One in N nights" labels come from simulated fair evenings with the same number of rolls. The module measures the dice, not the players.

## Requirements
- Foundry VTT 13.351 (v13 line), PF2e system 7.12.x
- No dependency on Dice So Nice, socketlib or libWrapper
- Works with PF2e Toolbelt's Target Helper (saves rolled from damage cards are captured) and the PF2e Flat Check module (V3.x cards are read)

## How it works
- The **active GM client** is the single writer. It normalises every d20-bearing chat message (checks, saves, attacks, initiative, flat checks, raw `/r 1d20`, both dice of fortune/misfortune, both dice of a hero-point reroll) into one record per physical die and stores them in a hidden journal, one page per evening.
- A **session** is whatever your table needs it to be (Sessions tab → Session definition):
  - *By day* (default): one session per day in the world timezone with a turnover hour (default 06:00 America/Chicago), so a game running past midnight stays one session. A preview sentence shows what the current values mean, and "we usually start at" sets the turnover for you.
  - *By pause*: a new session starts only after a number of idle hours (default 5). Works for any timeslot, overnight games, date changes and two games in one day.
  - *Start / End buttons*: the GM marks sessions by hand; stray rolls are kept aside as unscheduled.
  - Changed your mind? *Re-apply to stored history* regroups every stored roll (each keeps its raw timestamp), after showing what would move. Merge and split tools cover the odd case.
- Players read the same journal; the window filters blind and secret rolls out of their view for the running session (configurable). The GM decides what players may open with the **Players see** control in the tracker header: the whole table, only their own rolls, or nothing. It takes effect at once on every client, no reload.
- If the GM reloads or the server restarts mid-evening, a catch-up scans tonight's chat for anything missed. Deleting the chat log does not affect stored evenings.

## Install
Manifest URL:
```
https://github.com/Fallt0earth/pf2e-d20-session-tracker/releases/latest/download/module.json
```
Foundry setup → Add-on Modules → Install Module → paste the URL. On The Forge: Bazaar → Marketplace → Toolbox → Install from Manifest.

## Using it
Open the window from the token controls (d20 icon), a keybinding you assign, or `game.modules.get("pf2e-d20-session-tracker").api.open()`.
- **Tonight:** party headline and the leaderboard (n, mean, luck z, percentile, Nat 20 and Nat 1 vs expected). Expand a row for the 1–20 histogram.
- **Fun:** awards, streaks with times, degree-of-success bar, hero-point and fortune returns, clutch / heartbreaker / wasted-20 moments, chi-square shape test.
- **History:** all-time rank, best and worst evening, a z trend per player.
- **Sessions:** session definition with preview, re-apply to history, merge, split, rename, exclude, export CSV/JSON, catch-up, reset (GM).
- The scroll icon opens the **evening report** in its own popup, on your screen only. Nothing is posted to chat. A GM can choose "Post a link in chat" inside the popup, which adds a single line with an Open button; the report itself never enters the chat log. `api.openReport(key)` does the same from a macro.

## Settings (GM)
Session definition (by day / by pause / Start–End), idle hours, timezone and turnover hour; capture on/off (pause while prepping); count raw d20 rolls; minimum dice to list an evening; player access (whole table / own rolls / GM only); blind-roll policy for player views; Monte Carlo iterations.

## Privacy and trust
Blind and secret roll results are stored in a GM-only journal and filtered out of the player-facing view. Like blind chat messages themselves, they are technically readable through the browser console by anyone with a client; the filter is a UI guarantee, not a cryptographic one.

Foundry rolls dice on the roller's own client, so no module can prove a die was really rolled; a player who edits their own messages can invent their own dice, with or without this module. What the tracker does guarantee is that a player's messages cannot change **anyone else's** numbers: a recorded die, its time and its roller are settled once stored, a reroll only ever links to the roller's own earlier roll, and everything read from a message is bounded in size and shape. When grouping by character, the character is whatever the message's speaker says; group by player for attribution the server enforces.

## Development
- Node 24 LTS (`.node-version`; `npm ci` refuses older lines, because the dependency policy relies on the npm that ships with 24). `npm ci`, then `npm test` (pure stats/normalizer layer under `node --test`) and `npm run lint` (the TypeScript compiler checks every name and import, and compiles the pure layer with no Foundry or DOM globals, so it cannot touch them).
- **Supply chain:** the module ships plain files with no packages in them. Development needs two exact-pinned packages without dependencies of their own (`typescript`, `playwright-core`); install scripts are disabled in `.npmrc`; the release workflow uses only GitHub's own checkout action pinned to a commit, installs nothing, and attaches `SHA256SUMS.txt` to each release. `test/supply-chain.test.js` fails if any of that drifts.
- `npm run build:macro` bundles `macros/analyze.js`, a pasteable script macro that validates the normaliser against a world's recent chat.
- Dev instance and headless verification: see `docs/PLAN.md`, `docs/TESTING.md`, `dev/e2e/`.

## License
GPL-3.0, see `LICENSE`. Design patterns (not code) were informed by three MIT-licensed modules, credited with thanks: Simple d20 stats (Yosoy-Ed), Roll Tracker (drexl93) and dice-stats (jacobwojoski).
