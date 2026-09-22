# Changelog

All notable changes to this module. Versions are never reused.

## [1.2.0] — 2026-09-22
Resource pass and toolchain baseline. Stored data opens unchanged; pages move to the new layout on their next write.
- **History tab: seconds to milliseconds.** The all-time Nat 20 / Nat 1 tails were computed with a quadratic sum, which cost 0.4 s after a year of play and 10 s after five, on every roll while the tab was open. Now 6–25 ms, with the same numbers to twelve decimals.
- **One roll is under 1 KB on the wire.** Every roll used to send the whole session page to every connected client (about 80 KB at 300 dice). Rows are now keyed by id in the journal page, so a roll travels as one key: 761 bytes, whatever the page size.
- **Fewer, cheaper redraws.** An open window redraws once, 300 ms after the last roll of a burst; the Fun tab's Monte Carlo and the History model run only when that tab is actually drawn, and the tab you are watching stays current instead of going stale; the report popup no longer reruns its Monte Carlo on every refresh.
- **GM start with a big chat log:** the catch-up no longer runs a timezone conversion on every message in the world (120 ms per 50 000 messages → 1 ms).
- Measured budget and what was left alone (capture 5 µs per message, 643 B of memory per stored die, load time 0.1 s for five years of play): docs/TESTING.md.
- **Node 24 LTS is the development baseline** (`engines.node >=24`, enforced by `engine-strict` in `.npmrc`, so `npm ci` refuses an older Node instead of warning). The dependency policy's release-age cooldown relies on npm 11, which ships with Node 24; on the npm of older lines it would silently do nothing.
- Dev tooling: `playwright-core` 1.55.1 → 1.63.0 (the 1.55 line was the last one for Node 18).

## [1.1.1] — 2026-09-21
Hardening release. Nothing changes in how the tracker looks or is used; stored data opens unchanged.
Chat messages are written by the players' own clients, so the module now treats every part of one as
untrusted input.
- **A reroll can only ever touch the roller's own earlier record.** The reroll annotation a client adds to its message is checked against the message itself; it can refresh the reroll link of that user's own original roll (or of any roll when a GM rerolls it) and nothing else. A stored die, its time and its roller never change once recorded.
- **Toolbelt saves are credited to the named roller only when that user could have rolled for the token** (its owner or a GM); otherwise the record falls back to whoever made the update and is marked as a guess. Save entries that are not keyed by a token id are ignored, and endless re-rolls of one save stop producing records.
- **Bounds everywhere:** at most 24 dice per message and 5 000 per session are recorded; a d20 result outside 1–20 is not a die; roll data is walked to a fixed depth; text fields are clipped and enumerated fields only keep known values; one malformed message can no longer abort a catch-up.
- **Message time is checked:** nothing is filed in the future, and a player's live roll whose timestamp is more than 15 minutes from the GM's clock is filed under the GM's clock.
- **Card parsing is linear-time** (rerolls recovered from HTML, PF2e Flat Check cards): clipped input and bounded patterns, so a crafted message cannot stall the GM's client.
- **Report links:** only a GM's own link message gets a working Open button, and only well-formed keys of stored sessions open a window.
- **CSV export:** text a spreadsheet would run as a formula opens as text.
- Summaries use prototype-free tallies, so a statistic or name such as `constructor` stays plain data.
- The analyzer macro escapes names in its optional whisper.
- **Supply chain:** nothing from npm has ever shipped in the module; now the development tree is minimal too: 90 installed packages became 2 (`typescript` and `playwright-core`, both exact-pinned, neither with dependencies or install scripts), and install scripts are disabled outright. ESLint 9 (end of life, 86 packages) is replaced by a small check on the TypeScript compiler that also enforces the pure layer by construction; esbuild (a native binary with an install script) is replaced by a thirty-line bundler on the same compiler, and the analyzer macro it builds is verified against its sources by a test. The release workflow uses only GitHub's checkout action pinned to a commit, creates the release with the runner's own `gh`, validates the tag, never installs packages, and attaches `SHA256SUMS.txt`. A policy test fails on any drift. Development moves to the Node 24 LTS line (`engines.node >=22`; the test script now uses default discovery, because a directory argument runs nothing on Node 22+), and `.npmrc` adds a 14-day release-age cooldown.

## [1.1.0] — 2026-09-19
- **Configurable session definition** (Sessions tab → Session definition, also in module settings). Three ways to define a session:
  - *By day* (the 1.0 rule): one session per day with a turnover hour, now with a plain-language preview and a "we usually start at" helper that places the turnover 12 hours away from play.
  - *By pause*: a session is one run of play; a new one starts only after a set number of idle hours (default 5). No clock boundary exists, so overnight games, odd timeslots and date changes never split a game, and two games on one date become two sessions (`2026-09-19`, `2026-09-19 (2)`).
  - *Start / End buttons*: the GM marks sessions by hand; rolls outside a session are kept aside as unscheduled and can be moved into a session or discarded; a session left running closes itself after the idle hours.
- **Re-apply to stored history**: regroups every stored roll under the current definition after showing exactly what would move. Names and exclusions survive where a session survives; no roll is deleted. Round-trips cleanly (by day → by pause → by day restores the original sessions).
- **Merge with previous / split at a pause** for the rare case a rule guesses wrong. Sessions are ordered by when they were played, not by their key.
- **"Players see" control in the tracker header** (GM): whole table, own rolls only, or nothing. Takes effect immediately on every client; players' tracker button appears or disappears without a reload, and windows they may no longer see close.
- Catch-up now covers the running session under any definition.
- 1.0 data opens unchanged; the default definition is still *by day* at 06:00.

## [1.0.0] — 2026-09-19
- Capture: one normalizer for PF2e checks (all types, fortune/misfortune, hero-point rerolls with roller-side enrichment), raw d20 rolls, PF2e Toolbelt Target Helper saves, and PF2e Flat Check cards.
- Storage: hidden "d20 Session Log" journal, one page per evening, compact rows; GM-only writer with a debounced serial queue; every client mirrors it live.
- Evening bucketing by world timezone and boundary hour; catch-up for the current evening on GM start and on demand.
- Window: Tonight leaderboard, Fun tab (awards, streaks, DoS, rerolls, moments, chi-square, Monte Carlo rarity), History tab (all-time rank, trends), Sessions tab (rename, exclude, delete, export CSV/JSON, pause, reset).
- Evening report as its own popup, opened only by an explicit click; optional one-line chat link for the GM. No report content is ever posted to chat.
- Human-readable first layer: luck percentage with a meter, average roll, high-roll share, Nat 20 / Nat 1 rates; z-score and tail probabilities kept in the expanded details and tooltips.
- Player views hide blind/secret rolls for the current evening (configurable) and can be restricted to own rolls or disabled.
