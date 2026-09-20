# Changelog

All notable changes to this module. Versions are never reused.

## [Unreleased]

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
