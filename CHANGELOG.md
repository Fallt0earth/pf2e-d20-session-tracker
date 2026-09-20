# Changelog

All notable changes to this module. Versions are never reused.

## [Unreleased] — towards 1.0.0
- Capture: one normalizer for PF2e checks (all types, fortune/misfortune, hero-point rerolls with roller-side enrichment), raw d20 rolls, PF2e Toolbelt Target Helper saves, and PF2e Flat Check cards.
- Storage: hidden "d20 Session Log" journal, one page per evening, compact rows; GM-only writer with a debounced serial queue; every client mirrors it live.
- Evening bucketing by world timezone and boundary hour; catch-up for the current evening on GM start and on demand.
- Window: Tonight leaderboard, Fun tab (awards, streaks, DoS, rerolls, moments, chi-square, Monte Carlo rarity), History tab (all-time rank, trends), Sessions tab (rename, exclude, delete, export CSV/JSON, pause, reset).
- Evening report as its own popup, opened only by an explicit click; optional one-line chat link for the GM. No report content is ever posted to chat.
- Human-readable first layer: luck percentage with a meter, average roll, high-roll share, Nat 20 / Nat 1 rates; z-score and tail probabilities kept in the expanded details and tooltips.
- Player views hide blind/secret rolls for the current evening (configurable) and can be restricted to own rolls or disabled.
