# PF2e d20 Session Tracker — source survey, docs, and scope

Prepared 2026-09-14 for David (rev. 3, same day). Intended as the seed context for a Claude Code build.
Every claim is tagged: **[V]** verified against the cited source today, **[U]** unverified / from memory — confirm before relying on it.

## Handoff summary for Claude Code

**Goal.** A Foundry VTT v13 module for the PF2e system that records every natural d20 per player, groups them by evening of play, and shows (a) who ran hot or cold that session with honest statistics and (b) fun session aggregates (full 1–20 result tables, totals, streaks, awards). Runs on David's Forge-hosted game; developed locally in Docker.

**Decisions already made (don't re-ask):**
- D1 session = one real-world evening: bucket by `message.timestamp` with a 06:00 America/Chicago boundary (world settings). No Start/End button.
- D2 single writer = the active GM client (`game.users.activeGM`).
- D3 storage = hidden JournalEntry, one page per session, raw compact records in flags; small world setting for config/session index. Measure size before committing (§11).
- D4 attribute to both User and Actor; UI groups by User by default.
- Luck metric = natural die only; leaderboard column is the mean-based z (§4.3). Fun aggregates are in scope (§4.4). Percentiles via Monte Carlo (§4.5).
- Every physical die counts by default (both dice of fortune/misfortune and of rerolls); "kept only" is a toggle.

**Suggested repo layout:** put this file at `docs/SCOPE.md`; keep a short `CLAUDE.md` at the root that says "read docs/SCOPE.md first; target Foundry v13 / PF2e 7.12.2; test on the Docker instance at <url>; never call `Roll` in stats code; keep the stats layer free of Foundry globals so `node --test` can run it".

**First three tasks:** (1) M0 analyzer macro against a copy of the Forge world (§8); (2) confirm the §11 open items that are cheap to test; (3) module skeleton with capture + backfill and the "Tonight" window.

---

## 0. Target environment

| Item | Value | Status |
|---|---|---|
| Foundry core on David's host | v13 (13.351 is the last v13 build the PF2e package page lists as verified) | [V] memory: v13; [V] foundryvtt.com/packages/pf2e |
| PF2e system | 7.12.2 — the **final v13 line**; 8.x requires Foundry v14 (8.5.0 = 14.361–14, verified 14.367, released ~Sep 3 2026) | [V] foundryvtt.com/packages/pf2e |
| Foundry v14 status | Stable since 14.359 (Apr 2026); latest seen 14.366 (Aug 2026); felddy Docker image already builds 14.367 | [V] foundryvtt.com/releases/14.359, /14.366; felddy README |
| **Hosting** | **The Forge** (forge-vtt.com) — managed hosting; no filesystem/SSH access; custom modules go in via Bazaar "Install from Manifest" or the Import Wizard (see §7). Server idles after inactivity. | [V] stated by David; [V] forums.forge-vtt.com docs (§7) |
| Implication | Build for v13 / PF2e 7.12.2 now, but use only APIs that are unchanged in v14 (ApplicationV2, record-shaped scene controls, `message.author`) so the v14 + PF2e 8.x jump is a manifest bump. Develop against a **local Docker dev instance**, ship to the Forge as GitHub releases. | design note |

modules in env can be found in the E:\code4fun\Foundry\session_dice\enabled_modules folder as screenshots

**First action for Claude Code:** have David run `game.version`, `game.system.version` in the Forge game's console and confirm; the doc assumes v13 + 7.12.2.

---

## 1. Existing modules — survey and verdict

Cloned and read on 2026-09-14. All three are MIT licensed [V] (LICENSE files) — code may be borrowed with attribution.

| Module | Version / compat | Storage & capture | Session / per-day support | PF2e awareness | Verdict |
|---|---|---|---|---|---|
| **Simple d20 stats** (`simple-dice-stats`, Yosoy-Ed) | 0.2.1, min 11, verified 13.346; last commit 2025-10-04; 1 star | Per-**user flags** keyed by `dd/mm/yyyy` date string (roller's *local* date); per-date 20-bin histogram + `attacks1/attacks20`; roller's own client writes on `createChatMessage` (only `rolls[0]`) [V] scripts/sds.js | **Yes — date-range picker (per day)**, Nat1/Nat20 table, "pause data acquisition" toggle for between-session test rolls [V] README | Attack rolls only (`rolls[0].type === "attack-roll"`) [V] | **Closest existing fit for "per day".** Try it first. Gaps: keyed by user *name* (rename breaks it); no check-type / DoS breakdown; per-day buckets only, no session labels; date keyed in each roller's timezone; hero-point rerolls that *keep the original* are double-counted (see §5.3). |
| **Roll Tracker** (`roll-tracker`, drexl93) | 2.0.0, min/verified 13.0.0; last commit 2025-12-23 | Per-user flags: `sorted`, `unsorted`, `streak`, `combat` arrays; capture on `createChatMessage`, roller-side [V] | **No.** Aggregate all-time + "combat-only" subset. Source header TODO literally lists "Session logs" as unimplemented [V] scripts/roll-tracker.js L1–7 | Optional filter: only count messages with `flags.pf2e.context.type` [V] | Likely the "aggregate-only tracker" you already have. Not extensible to sessions without a rewrite. |
| **dice-stats** (jacobwojoski) | 1.22.2, min/verified 13; last commit 2025-05-16 | In-memory since-join, optional "auto DB" persistence (aggregate); socketlib for blind-roll push [V] README | "Session" = since you joined; resets on rejoin; no history of past sessions [V] README | Splits d20s by PF2e type in charts [V] README | Not a fit for per-session history. |
| **Indy Dice Stats** | v13, dnd5e 5.2.5 only | — | Per-session or total, with charts [V] package page | **dnd5e only** | Not usable in PF2e. |
| Encounter Stats | — | journal-based encounter/streak tracking | per-encounter, not per-session d20 | — | Not a fit. |

**Bottom line:** if "per day" is the whole requirement, install Simple d20 stats and stop. If you want any of: per-session labels (not just calendar day), check-type / save / skill / initiative breakdown, degree-of-success vs. DC, correct reroll handling, GM-vs-player attribution, CSV export, or **retroactive backfill from the existing chat log** — build it. Nothing found does those for PF2e.

---

## 2. Requirements

### Must
1. Record every natural d20 result per **User** (who clicked) and per **Actor** (speaker), with a timestamp.
2. Group by **session** (see decision D1) and show per-session and all-time: histogram 1–20, mean, count, Nat1/Nat20 counts, per check type.
3. Work on Foundry v13 + PF2e 7.12.2; no hard dependency on Dice So Nice or socketlib.
4. Not reveal blind/secret roll results to players through the stats UI.
5. Survive chat-log flushes (persist, don't just recompute from chat).

### Should
6. Backfill history from `game.messages` (the world's existing chat log) on demand.
7. Break down by PF2e check type and record degree of success + DC when present.
8. Handle hero-point rerolls (both dice counted once, kept/discarded flagged) and fortune/misfortune (`2d20kh`/`2d20kl`).
9. Export CSV/JSON per session.
10. "Pause capture" toggle (between-session test rolls; Simple d20 stats has this pattern).

11. Session aggregates "for fun" (§4.4): full 1–20 result tables per player and party, totals, streaks, awards, DoS split; Monte Carlo percentiles for them (§4.5).

### Could
12. Chat card summary at session end; per-actor vs per-user toggle; trend charts across sessions.

### Non-goals (v1)
- Damage dice, non-d20 dice, other systems, cross-world aggregation.

---

## 3. Decisions (D1 decided by David; D2–D4 are the defaults Claude Code should build unless David objects; D5 is a question for David)

**D1 — What is a "session"? — DECIDED 2026-09-14.** A session is one evening of play, so bucket by **real-world day** with a boundary hour. Foundry has no native session concept [U — no core API found; treat as true].
- Rule: `sessionKey = date( ts − boundaryHour ) in world timezone`. Store `timezone` (default `America/Chicago`) and `boundaryHour` (default `06`) as world settings so every client buckets identically; do the bucketing from `message.timestamp` (ms epoch, tz-independent), never from a client's local date (Simple d20 stats' mistake).
- Session label auto-generated (`2026-09-13 Sat`), optionally renamable by the GM. **No Start/End button in v1**; idle-gap splitting and multi-session days are out of scope.
- Store the raw timestamp on every roll so bucketing can be recomputed later if the rule ever changes.
- **Primary use case:** at any point during or at the end of an evening, show who is running hot and who is running cold *this session* — see §4.3 for the luck metrics this implies.

**D2 — Who writes the data?**
- (a) **GM client only.** `createChatMessage` fires on every connected client for every message, including whispers/blind (visibility is applied client-side via `isContentVisible`) [U — confirm on a blind roll in a player client with a console hook]. GM has `world` settings write permission; players don't (world-scope settings require the "Modify Configuration Settings" permission, default GM/Assistant only) [V] foundryvtt.wiki/en/development/api/settings, foundryvtt.com/article/settings.
- (b) Each roller writes their own User flags (how all three surveyed modules do it). Works when the GM is offline, but data is spread across User documents, no single writer for dedupe, and blind results live on the player's own doc.
- **Default:** (a). Sessions never happen without the GM. If a roll lands while the GM is disconnected it's recoverable via backfill (Should-6).

**D3 — Where is it stored?** (all [U] on size limits — no documented cap found; verify empirically)
- (a) One `world`-scope setting holding everything: simplest, but every `game.settings.set` rewrites and broadcasts the whole JSON blob. Fine for aggregates; poor for a raw log that grows to MBs. A setting value must survive `JSON.stringify` [V] foundryvtt.wiki settings page.
- (b) Aggregates only (per user × session × type: 20 bins + counts): tiny, but you lose per-roll analysis later.
- (c) A hidden `JournalEntry` ("d20 Log") with **one page per session**, raw roll records in page `flags` (or JSON in page text). Documents update independently, are permission-controlled (players: no access), and export/import natively. Recommended.
- (d) Module-defined `JournalEntryPage` subtype with a `TypeDataModel` schema via `documentTypes` in `module.json` — cleanest, more setup. [U] exact manifest syntax; check v13 API `Package#documentTypes` before choosing.
- **Default:** (c) for raw records + a small `world` setting for the session index/config. Revisit (d) if Claude Code finds it cheap.

**D4 — Attribution unit.** User (`message.author`) vs Actor (`message.speaker.actor`). Store both; default UI groups by User, with an Actor toggle. GM rolling NPC saves/attacks shows as GM.

**D5 — Backfill.** If the world chat log has never been flushed, `game.messages` contains every message with `timestamp` and `flags.pf2e.context` intact → the entire campaign's history can be reconstructed on first run. Ask: has the chat log been flushed? (If yes, only post-install data exists.) Note the reroll caveat in §5.3 — the discarded die of a reroll is only present as rendered HTML in the surviving message.

---

## 4. Architecture

```
module: pf2e-d20-session-tracker (id TBD)
├─ capture/      GM-only hooks → normalize → append to session page
├─ backfill/     scan game.messages → same normalizer → rebuild pages
├─ sessions/     bucketing rules (D1), session index in world setting
├─ stats/        pure functions: records[] → histograms/means/DoS tables
├─ ui/           ApplicationV2 + HandlebarsApplicationMixin dashboard, CSV export
└─ settings      pause capture, day-boundary hour, tz, player visibility
```

Key design rule: **one normalizer** (`messageToRollRecords(message) → RollRecord[]`) used by both live capture and backfill, so the two paths can't drift.

### 4.1 RollRecord (proposed)
```js
{
  id: message.id,                 // dedupe key (+ dieIndex for 2d20)
  ts: message.timestamp,          // ms epoch [V] ChatMessage schema: timestamp NumberField
  userId: message.author?.id,     // v12+ 'author' (v11 'user') [V] v13 schema: author DocumentAuthorField
  actorId: message.speaker?.actor ?? null, tokenId: message.speaker?.token ?? null,
  alias: message.speaker?.alias,
  natural: 17,                    // die.results[i].result
  kept: true,                     // false for the discarded die of 2d20kh/kl
  formula: "1d20" | "2d20kh" | "2d20kl",
  total: roll.total,
  type: ctx.type,                 // "attack-roll" | "check" | "counteract-check" | "flat-check" | "initiative" | "perception-check" | "saving-throw" | "skill-check"
  domains: ctx.domains,           // e.g. ["reflex","saving-throw"]; use to derive stat (fortitude/stealth/…)
  action: ctx.action ?? null,
  dc: ctx.dc?.value ?? null, dcVisible: ctx.dc?.visible ?? null,
  outcome: ctx.outcome ?? null,   // "criticalSuccess" | "success" | "failure" | "criticalFailure" | null
  unadjustedOutcome: ctx.unadjustedOutcome ?? null,
  isReroll: ctx.isReroll ?? false,
  mode: ctx.messageMode ?? null,  // 'roll' | 'gmroll' | 'blindroll' | 'selfroll'
  blind: message.blind, whispered: message.whisper.length > 0,
  inCombat: !!game.combat?.active,   // at capture time only; null on backfill
  sessionKey: <derived>,
}
```

### 4.2 Stats layer
Pure functions over `RollRecord[]` (no Foundry globals) so they can be unit-tested with plain `node --test`. Outputs: histogram[20], n, mean, sd, nat1/nat20 counts, per-type tables, DoS distribution where `dc != null`, kept-vs-discarded fortune stats.

### 4.3 Luck metrics (the point of the module)
Luck = the natural d20 only. Totals and outcomes mix in modifiers and DCs (skill and difficulty), so they are not luck. Fair-d20 constants: mean **10.5**, variance (20²−1)/12 = **33.25**, sd ≈ **5.766** (basic math, not sourced).

Per user per session, with n = number of counted dice:
- **Mean natural** and **Δ = mean − 10.5** (positive = hot, negative = cold). Readable, but not comparable across players with different n.
- **Luck z-score** = Δ ÷ (5.766 / √n). This is the leaderboard number: it normalizes for how many times each player rolled. Rough reading: |z| < 1 noise, 1–2 "noticeably hot/cold", > 2 "genuinely cursed/blessed tonight" (~5% chance under a fair die). Requires n ≥ ~15 before it means anything; show n next to it and grey out below that.
- **Nat20 / Nat1 counts vs expected** (expected = n/20 each), shown as "3 vs 1.6 expected".
- **Longest cold/hot streak** (consecutive naturals ≤ 5 / ≥ 16) — optional, good for table banter.
- **Session vs all-time**: show the same z-score for the campaign to date so a player can see "cold tonight, average overall".

Which dice count toward luck (setting, default in bold):
- **Every physical die** (both dice of a 2d20kh/kl, both dice of a reroll): measures the RNG, which is what "luck" means. Alternative view: kept dice only (what actually hit the table).
- Include all check types (attack, save, skill, initiative, flat, raw `/r 1d20`); the type breakdown is secondary for this use case.
- Blind/secret rolls count in the GM view; the player-facing view excludes them (or hides the delta) until session end so a secret Stealth natural can't be inferred from the histogram.

UI for the use case: a single "Tonight" panel — one row per player (alias + user), columns n / mean / z / Nat20 / Nat1, sorted by z, with a session picker to look back at any earlier evening; histogram per player on expand.

### 4.4 Session aggregates — "for fun" (DECIDED 2026-09-14: in scope)
Everything below is a pure function of the session's `RollRecord[]`; no extra capture needed. All are per session, with a per-player and a whole-party version.

**Raw aggregates**
- Full result table: count of each face 1–20 per player and for the party (the literal "aggregate roll results"), as a bar chart + numeric table.
- Totals: dice rolled, sum of all naturals ("the party rolled 4,317 pips tonight"), mean, median, mode, min/max, spread (sd).
- Most- and least-rolled face; faces never rolled tonight.
- Nat 20s and Nat 1s: count, and *when* (first/last of the night, time between them).
- Rolls per check type: attacks / saves / skills / initiative / flat; per PF2e domain (Reflex, Stealth, …) from `domains`.
- Hero-point rerolls: count, original vs kept natural, net gain ("rerolls gained +37 pips").
- Fortune/misfortune: how many 2d20 rolls, how often the discarded die would have been better.
- Where a DC was present: degree-of-success split (crit success / success / failure / crit failure) per player and party — not luck, but fun ("the party crit-failed nine saves").

**Streaks and moments**
- Longest hot streak (consecutive naturals ≥ 16) and cold streak (≤ 5) per player, with timestamps.
- Longest run of the same face; longest run without a Nat 20.
- "Clutch" — highest natural on a roll that had a visible DC and succeeded; "Heartbreaker" — Nat 1 on a roll that would have succeeded on a 2 (needs `dc` and `total`).
- "Wasted 20" — Nat 20 on a check with no DC (flat checks aside).

**Awards (one line each, auto-generated at session end)**
- Blessed / Cursed: highest / lowest luck z (n ≥ 15).
- The Grinder: most dice rolled. Consistent / Chaotic: lowest / highest sd.
- Snake Eyes: most Nat 1s. Golden: most Nat 20s (ties → per-roll rate).
- Comeback: biggest single reroll improvement.
- Party Mood: party mean vs 10.5 with its own z (party n is large, so this one is usually meaningful).

**Trend views (all-time)**
- Per-player session-by-session z line; cumulative luck (running Δ) across the campaign.
- Player rank by all-time z and by all-time Nat20 rate; each player's best and worst evening.

### 4.5 Statistical measures — what to compute and how to keep them honest
Everything is measured against a fair d20 (uniform on 1..20). Basic math, no external source needed; textbook thresholds noted where relevant.

| Measure | Formula / method | Use | Guardrail |
|---|---|---|---|
| Luck z (mean) | z = (mean − 10.5) / (5.766 / √n) | Leaderboard ranking; per session and all-time | show n; grey out n < 15 |
| Luck percentile | Φ(z) (normal CDF) → "tonight was a 91st-percentile night" | Friendlier than z | same n guard |
| Nat20 / Nat1 excess | binomial with p = 1/20: expected n/20; one-sided tail P(X ≥ k) for an excess, P(X ≤ k) for a drought — sum the binomial pmf directly; n ≤ ~1000 so it's cheap | "3 Nat 20s in 22 rolls (expected 1.1, P(≥3) ≈ 0.10)" | report expected count next to observed; don't rank on this — it is noisy |
| Distribution shape | chi-square goodness of fit vs uniform. 20 bins needs expected ≥ 5 per bin → n ≥ 100 (textbook rule of thumb); below that use 4 coarse bins (1–5, 6–10, 11–15, 16–20) → n ≥ 20 | "Is the die itself weird tonight, not just the mean?" party-level mostly | pick bin count from n automatically; label which was used |
| Streak oddness | Monte Carlo (below) | "How unusual is a 6-roll cold streak in 40 rolls?" | never use closed-form run formulas here — Monte Carlo is simpler and correct for every stat |
| Party mood | same z on the pooled party rolls | headline number | party n is usually ≥ 100, so this is the most trustworthy stat of the night |
| Hero-point ROI | mean(kept − original) over rerolls; expected value of a reroll vs a fair die is 0 in natural terms | fun only | n of rerolls is tiny; show raw numbers, no p-values |

**Monte Carlo null distribution (recommended as the one general mechanism).** For any per-player or party stat S: simulate K = 5,000–20,000 fair sessions with the *same number of dice per player*, compute S each time, and report the percentile of the observed S. In-browser JS handles 20k × 500 dice in well under a second. This gives every "fun" stat (longest streak, pips total, mode count, time-to-first-20) a defensible "1 in N nights" label without deriving a formula for each. Use plain `Math.random` (or `new foundry.dice.MersenneTwister(seed)` for reproducible runs — class exists at that path in v13 [V] foundryvtt.com/api/v13/classes/foundry.dice.MersenneTwister.html); never route simulations through `Roll` (Dice So Nice would animate them and they would hit chat).

**Sample-size honesty rules (bake into the UI, not just the doc):**
- A single evening gives each player ~20–60 d20s. That is enough for the mean-based z to say "hot" or "cold" at the ±1.5–2 level and *not* enough to say anything about individual faces. Display accordingly.
- Everything is per fair-die expectation; the module is measuring the RNG, not the player. Say so once in the UI help text so the results are read as banter, not accusation.
- Multiple comparisons: with 5 players and 8 awards, someone will be "p < 0.05" most nights by chance. Fine for fun; the doc just notes it so nobody treats an award as evidence of a broken RNG.

---

## 5. Capture details (PF2e specifics — read from source)

Source files verified in `foundryvtt/pf2e` at `main` (package.json version 8.5.0, commit a496e26, 2026-09-13) **and** at tag `7.8.0` (closest published tag to 7.12.2; no 7.12.x tag exists on GitHub). Same fields at both [V]:

- `src/module/system/check/types.ts` — `CheckType` union (list above), `CheckCheckContext` (`type`, `identifier`, `action`, `rollTwice`, `dc`, `domains`, `isReroll`, `substitutions`, `dosAdjustments`).
- `src/module/system/rolls.ts` — `BaseRollContext.outcome` / `unadjustedOutcome` (`DEGREE_OF_SUCCESS_STRINGS`), `messageMode`.
- `src/module/chat-message/data.ts` — `flags.pf2e.context` is `CheckContextChatFlag` = the context above with `actor`/`token` ids, `dc` (`label, scope, slug, value, visible`), `origin`/`target`, `options[]`.
- `src/module/system/check/check.ts` — builds the message: `flags.pf2e.context = {type, identifier, action, actor, token, domains, options, messageMode, rollTwice, dc, isReroll, outcome, unadjustedOutcome, …}`; also `flags.pf2e.modifiers`, `flags.core.initiativeRoll = true` for initiative.
- `src/module/system/check/roll.ts` — `CheckRoll` getters: `type` (`options.type ?? "check"`), `degreeOfSuccess` (`options.degreeOfSuccess`), `isReroll`; `options.rollerId = game.userId` is set at roll time (useful as a second attribution source).

### 5.1 Which messages to count
`message.isRoll && message.rolls.some(r => r.dice.some(d => d.faces === 20))`. Iterate **all** `rolls`, not just `rolls[0]` (both existing modules only read `rolls[0]`). Distinguish:
- PF2e checks: `flags.pf2e.context?.type` present → full record.
- Raw `/r 1d20` or macro rolls: no context → record with `type: "raw"` (setting: include/exclude).
- Damage rolls: `flags.pf2e.context?.type === "damage-roll"` [V] src/module/system/damage/types.ts L46 → skip.

### 5.2 Fortune / misfortune
`rollTwice: "keep-higher"` → formula `2d20kh`; `"keep-lower"` → `2d20kl` [V] check.ts. `roll.dice[0].results` then has two entries. `DiceTermResult` is `{ result: number; active?: boolean; discarded?: boolean; rerolled?; exploded?; count?; success?; failure? }` — `active` = contributes to the total, `discarded` = dropped by kh/kl [V] foundryvtt.com/api/v13/interfaces/foundry.dice.DiceTermResult.html. Record both dice; `kept = result.active !== false && !result.discarded`.

### 5.3 Hero-point / mythic rerolls — the double-count trap
`Check.rerollFromMessage` **deletes the original message and creates a new one** containing only the kept roll, with `context.isReroll = true` and `check:reroll` in options; the old die appears only in the new message's HTML (`div.reroll-discard`) [V] check.ts ~L428–640 (main) and L530/L639 (7.8.0). Consequences:
- Naive `createChatMessage` counting: original counted, then the kept roll counted again → a reroll that keeps the original double-counts it (Simple d20 stats and Roll Tracker both do this).
- Correct handling (live): listen to `Hooks.on("pf2e.reroll", (oldRoll, newRoll, resource, keepOrOptions) => …)` [V] — 4th arg is a `keep` string in 7.8.0 and an options object in main; write both dice once, mark discarded/kept; then on `createChatMessage` skip messages with `context.isReroll` (already handled). `deleteChatMessage` for the original must **not** remove its record.
- Backfill: the original message is gone; parse the kept message's `content` for the `.reroll-discard` die if you want the discarded natural (fragile — HTML), else count only the kept die and set `isReroll: true`.

### 5.4 Substituted rolls (Assurance etc.)
A selected substitution replaces the d20 with a constant — the formula is a plain number, no d20 term [V] check.ts (`return [substitution.value.toString(), …]`). These produce a `CheckRoll` with `dice = []` → excluded automatically by §5.1; optionally count them as `substituted` for completeness.

### 5.5 Blind / secret / GM rolls
- Secret checks set `messageMode` to `gm` (GM roller) or `blind` (player) unless "show secret checks" is on [V] check.ts L87–93.
- Capture everything on the GM client; in the **player-visible** UI exclude records with `blind || whispered` (or expose per-setting), so a player can't infer a secret Stealth natural from the histogram delta.
- Dice So Nice: irrelevant for storage; only matters if you post live results to chat before the animation finishes (`diceSoNiceRollComplete(messageId)` hook, used by all three modules) [V] module sources.

### 5.6 Attribution
`message.author` (User doc) for "who clicked"; `message.speaker.actor` for the character. `flags.pf2e.context.actor` also carries the actor id. GM-rolled NPC checks → author = GM.

### 5.7 Initiative
`context.type === "initiative"` and `flags.core.initiativeRoll = true` [V] check.ts. PF2e initiative is a Perception/skill check, so it *is* a d20 check — include, tagged.

### 5.8 Test-roll hygiene and single writer
- **Live capture:** run the capture hook only on `game.users.activeGM` ("Get one User who is an active Gamemaster (non-assistant if possible) … useful for workflows which occur on all clients, but where only one should act") [V] foundryvtt.com/api/v13/classes/foundry.documents.collections.Users.html — `if (game.user !== game.users.activeGM) return;`. This also means player test rolls made while no GM is online are never captured live.
- **Backfill** sees everything in `game.messages`, including between-session sheet-testing rolls. Mitigations, cheapest first: (1) a per-session "exclude this day" toggle in the UI; (2) auto-hide sessions with fewer than N party rolls (setting, default 30); (3) a "GM present" heuristic — only count a day if the GM user authored at least one message that day. Store the exclusion, don't delete the records.
- Keep the "pause capture" world setting anyway (Simple d20 stats pattern) for prep evenings where the GM is online but not playing.

---

## 6. Foundry API surface to use (v13)

| Need | API | Ref |
|---|---|---|
| Hook on new messages | `Hooks.on("createChatMessage", (message, options, userId) => …)` — a `createDocument`-family hook | [V] foundryvtt.com/api/v13/functions/hookEvents.createDocument.html |
| Message fields | `author`, `timestamp`, `rolls[]`, `speaker`, `blind`, `whisper[]`, `flags`, `isRoll`, `isContentVisible` | [V] foundryvtt.com/api/v13/classes/foundry.documents.ChatMessage.html |
| Dice | `roll.dice` → `DiceTerm.faces`, `.results: DiceTermResult[]` | [V] foundryvtt.com/api/v13/classes/foundry.dice.terms.DiceTerm.html |
| Settings | `game.settings.register(id, key, {scope: "world"|"client"|"user", config, type, default, onChange})`; world scope = GM/Assistant write only; `user` scope new in v13 | [V] foundryvtt.wiki/en/development/api/settings; foundryvtt.com/api/v13/classes/foundry.helpers.ClientSettings.html |
| UI | `foundry.applications.api.ApplicationV2` + `HandlebarsApplicationMixin`; `_prepareContext()`, `actions` map, `PARTS` | [V] foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html; foundryvtt.wiki/en/development/guides/applicationV2-conversion-guide |
| Entry button | `Hooks.on("getSceneControlButtons", controls => { controls.tokens.tools.myTool = {name, title, icon, order, button: true, visible, onChange} })` — v13+ `controls` and `tools` are **records keyed by name, not arrays** | [V] foundryvtt.com/api/v13/functions/hookEvents.getSceneControlButtons.html (v14 page shows the example verbatim) |
| Alt entry | `renderPlayers` hook (Roll Tracker injects into the Players list; v13 signature `(app, element, context, options)`) | [V] roll-tracker.js L23 |
| Hooks reference | foundryvtt.wiki/en/development/api/hooks | [V] |
| Module basics | foundryvtt.com/article/module-development/ ; foundryvtt.com/article/modules/ | [V] URLs resolve |
| PF2e module compat notes | github.com/foundryvtt/pf2e/wiki (Module-Compatibility page) | [V] URL resolves |

v13 gotchas seen in the surveyed repos: dice-stats needed a "v13 button issue" fix; Simple d20 stats guards `controls.tokens ?? controls.find(...)` and `Array.isArray(bar.tools)` for the array→record change [V] sds.js L336–350. Use `onChange` (not `onClick`) for tools [U — v13 accepts `onClick`? the v14 doc uses `onChange`; a tool with neither throws inside core per a third-party migration note].

**Charts:** render the 1–20 histogram as plain HTML/CSS bars or inline SVG from the Handlebars template — no library, no CDN, nothing extra to load on the Forge. Simple d20 stats already does exactly this (a `chartdice` div with CSS bars, `templates/sds.hbs` + `css/sds.css`) [V] — borrow the pattern, not its `Application` (AppV1) shell. dice-stats loads Google Charts from the network at render time (`google.charts.load` in its templates) [V] — avoid. If David later wants trend lines, bundle Chart.js (MIT) inside the module rather than referencing a CDN.

---

## 7. Manifest, hosting on The Forge, and the dev loop

### 7.1 module.json skeleton (v13 manifest)

```json
{
  "id": "pf2e-d20-session-tracker",
  "title": "PF2e d20 Session Tracker",
  "version": "0.1.0",
  "compatibility": { "minimum": "13", "verified": "13.351" },
  "relationships": { "systems": [{ "id": "pf2e", "type": "system", "compatibility": { "minimum": "7.12.0" } }] },
  "esmodules": ["scripts/main.js"],
  "styles": ["styles/tracker.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "languages/en.json" }],
  "authors": [{ "name": "David" }],
  "flags": { "hotReload": { "extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "languages"] } },
  "manifest": "https://github.com/<user>/pf2e-d20-session-tracker/releases/latest/download/module.json",
  "download": "https://github.com/<user>/pf2e-d20-session-tracker/releases/download/v0.1.0/module.zip"
}
```
- `flags.hotReload: { extensions, paths }` is the core hot-reload config (v11+); the server must be started with hot reload enabled (`--hotReload` / config option) [V] foundryvtt.com/api/v14/interfaces/foundry.packages.types.PackageFlagsData.html; foundryvtt.com/article/configuration/; foundryvtt.com/releases/11.294. JS changes still need a page reload.
- `manifest` must be a stable "latest" URL; `download` must pin the exact zip for that version; never reuse a version number (explicitly called out as a problem for Forge users) [V] foundryvtt.wiki/en/development/guides/package-best-practices.

### 7.2 The Forge — what it changes
- **No filesystem or SSH.** You cannot symlink or edit files in place. Every iteration on the live game is a package install. Custom (non-Bazaar) packages count against the account's data storage; Bazaar packages don't [V] forums.forge-vtt.com/t/how-to-upload-a-modified-version-of-a-module-system/10510. This module is < 1 MB, so storage is a non-issue.
- **Two install routes for a module that is not on Foundry's package list:**
  1. **Bazaar → Marketplace → Toolbox → "Install from Manifest"**, paste the GitHub `releases/latest/download/module.json` URL [V] theteamplus.us/how-to/how-to-installing-a-foundry-module (Nov 2024, community source — confirm the button still exists in the current Forge UI).
  2. **Games Configuration (forge-vtt.com/setup) → Table Tools → "Summon Import Wizard"**, toggle off "Install found packages from the Bazaar", upload the module **folder or ZIP**, Analyze → import. Then **Stop and Start the Foundry server** so it sees the new package [V] Forge docs, same thread (Oct 2020, still the linked doc).
  - Route 1 is the release path (one click to update to a new tagged release). Route 2 is the emergency path (test a zip that isn't published anywhere).
- **Updates:** re-run "Install from Manifest" (or the Bazaar update prompt, once the Bazaar knows the package) after each release. If the module id ever collides with a Bazaar package, **lock** it on the Bazaar [V] Forge docs.
- **Idle shutdown:** the Forge idles a game after a period of inactivity (a Jan 2026 forum thread describes about an hour) and auto-starts it on next access [V] forums.forge-vtt.com/t/question-about-game-timeout/181968 — the exact timeout is plan-dependent [U]. Consequence for D2a: capture runs only while the GM client is connected, which is exactly the play window; between-session player test rolls are *not* captured live (good) but *will* be in `game.messages` for backfill (see §5.8).
- **Nothing else in this design touches Forge-specific behaviour**: world settings, `JournalEntry` storage, hooks and ApplicationV2 are plain Foundry. The module must not use `FilePicker` uploads or server-side file writes (the Forge redirects uploads to its Assets Library) — not needed here anyway.
- Optional: the Forge has an account API (start/stop/idle a game with an API key) [V] forums.forge-vtt.com/t/how-to-control-your-games-using-custom-api-requests-and-reset-your-worlds-periodically/5982 — irrelevant to v1, noted for automation later.

### 7.3 Recommended dev loop (fast local, slow Forge)
1. **Local dev instance in Docker on the NAS** using `ghcr.io/felddy/foundryvtt:13` (version-pinned tags exist per major/minor; `FOUNDRY_HOT_RELOAD=true` env enables hot reload; needs `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD` or `FOUNDRY_LICENSE_KEY`) [V] github.com/felddy/foundryvtt-docker README. Bind-mount the repo into `<data>/Data/modules/pf2e-d20-session-tracker`. Install PF2e 7.12.2 there and import a copy of the Forge world (export from Games Configuration) so backfill can be tested against real history.
   - **License:** Foundry's FAQ explicitly permits a second personal-only test/dev server on one license as long as nobody but the owner can get past its login screen [V] foundryvtt.com/article/faq (Licensing); the EULA wording is "only one hosted instance … accessible to users other than the license owner at any given time" [V] foundryvtt.com/article/license. So: dev instance behind Tailscale/LAN only, with a password on every user, never shared with players.
2. **Release:** tag → GitHub Actions builds `module.zip` + rewrites `version`/`download` in `module.json`, attaches both to the release. Starting points: League-of-Foundry-Developers/FoundryVTT-Module-Template (CI/CD template, URL resolves [V]); foundryvtt.wiki/en/development/guides/local-to-repo (manual walkthrough of the manifest/zip/release flow) [V].
3. **Deploy to the Forge:** Bazaar "Install from Manifest" (first time) / update (subsequent). Restart the game server if the new version isn't picked up.
4. Optional dev tooling: League `foundryvtt-devMode` module (template-cache off, debug flags) [V] github.com/League-of-Foundry-Developers/foundryvtt-devMode.

---

## 8. Milestones

- **M0 — Analyzer macro (½ day):** a script macro that runs the normalizer over `game.messages`, buckets by evening (D1 rule, boundary 06:00 America/Chicago), and prints the §4.3 leaderboard (n / mean / z / Nat20 / Nat1 per user) for each session to console/chat. Proves the data path and answers D5 (how much history is intact) with zero storage risk. Deliverable: `macros/analyze.js`.
- **M1 — Read-only module:** same analyzer behind an ApplicationV2 "Tonight" window with a session picker; no persistence yet.
- **M2 — Persistence + live capture:** GM-only capture (D2a), JournalEntry-per-session storage (D3c), `pf2e.reroll` handling, pause toggle, backfill button (idempotent on `message.id`), live refresh of the leaderboard on each roll.
- **M3 — Fun aggregates + stats:** §4.4 result tables/awards/streaks and §4.5 Monte Carlo percentiles, binomial and chi-square; end-of-session chat summary card.
- **M3.5 — Polish + export:** session rename/exclude, CSV/JSON export, player-safe view (blind exclusion), all-time trend views.
- **Forge deploy gate (after M1 and again after M2):** cut a GitHub release, install on the Forge via Bazaar "Install from Manifest", run the §9 checklist in the live world with the GM client only. Nothing is "done" until it has run on the Forge, since the dev instance is Docker.
- **M4 — v14 pass:** manifest bump, retest scene-control hook and ApplicationV2 on 14.36x + PF2e 8.x.

---

## 9. Verification checklist (do these in a test world before trusting numbers)

1. Roll a skill check, save, attack (with MAP), flat check, initiative, `/r 1d20`, and a damage roll → confirm which produce records and with what `type`.
2. Fortune (`2d20kh`) and misfortune → two dice recorded, one `kept: false`.
3. Hero-point reroll keeping **old** → exactly two records (old, new), no triple count; original `deleteChatMessage` leaves the record intact.
4. Assurance (Athletics) → no d20 record (or `substituted`).
5. Player blind roll → recorded on GM client; **absent** from player view.
6. GM secret NPC save → attributed to GM user / NPC actor.
7. Game crossing local midnight → one session under the boundary-hour rule.
8. Flush chat log → stats unchanged (persistence works); backfill button is a no-op.
9. Rename a user → history still attached (keyed by id, not name — Simple d20 stats fails this).
10. Second GM/Assistant online → no duplicate writes (guard: `game.user === game.users.activeGM` — getter verified in v13, see §5.8).
11. Forge-specific: install from manifest, restart the game server, confirm the module loads and the world setting/journal writes persist across a Forge idle/wake cycle.

---

## 10. Reference implementations to borrow from (MIT)

- `Yosoy-Ed/simple-d20-stats` — `scripts/sds.js`: per-date flag structure, pause-capture pattern, DSN wait, roll-mode classification (public/blind/GM/self) L410–460; `templates/sds.hbs` + `css/sds.css`: library-free CSS histogram.
- `drexl93/roll-tracker` — `scripts/roll-tracker.js`: `parseMessage` requirements object (L272–310), `renderPlayers` injection (L23), export-to-text, streak logic.
- `jacobwojoski/dice-stats` — `scripts/systemMessageParsers/pf2eSystemMessageParser.js` (237 lines): reads `rolls[].dice[]`, `roll.type`, `flags.pf2e.context.outcome` / `unadjustedOutcome` / `dc.value` — closest existing PF2e parser; socketlib blind-roll push if a player-side live view is ever wanted.

---

## 11. Unverified items to close early
Closed today (now [V] in the text above): `DiceTermResult` fields; `"damage-roll"` context type; `game.users.activeGM`; `flags.hotReload` syntax; `foundry.dice.MersenneTwister` path.

Still open:
- [U] `createChatMessage` fires on the GM client for player blind rolls (expected yes — `ChatMessage#visible` exists precisely because clients hold messages they can't see; test on the Forge with a player account).
- [U] Practical size ceiling for a JournalEntryPage `flags` blob / world setting value (measure with a synthetic 50k-record page on the Docker instance before choosing D3c vs D3d).
- [U] Whether David's world chat log has ever been flushed (drives M0 value).
- [U] Forge: the Bazaar "Install from Manifest" button still exists in the current UI (community source is Nov 2024); exact idle timeout for David's plan.
- [U] Forge: whether a game-server restart is required after "Install from Manifest" updates (the Import Wizard doc says stop/start; assume yes until observed).
- [U] v13 `SceneControlTool` accepts `onClick` as well as `onChange` (use `onChange`; irrelevant if the Players-list entry point is chosen instead).
