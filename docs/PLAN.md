# PF2e d20 Session Tracker — Implementation Plan

Prepared 2026-09-15. Companion to the scope document (`pf2e-d20-session-tracker-scope.md`, to become `docs/SCOPE.md`; referenced below as SCOPE §n). Same tagging convention: **[V]** verified against a cited source today, **[U]** unverified — confirm before relying on it.

This plan does not re-open decisions D1–D4 (SCOPE handoff summary). Where it refines them it says so and stays inside them.

---

## 0. How to read this plan

- §1 — what today's checks added to the scope doc (three findings change the design).
- §2 — inputs only David can supply, and which milestone each one blocks.
- §3 — repo layout, tooling, conventions.
- §4 — architecture refinements: normalizer/extractor pipeline, reroll handling, record schema, storage, sessions, stats, UI, settings.
- §5 — milestones as checklists with acceptance criteria. Work top to bottom; each milestone is shippable.
- §6 — test and verification strategy. §7 — dev loop, release, Forge deploy. §8 — merged risk/open-item register. §9 — effort. §10 — what to do first.

Checklist states: `[ ]` not started, `[~]` in progress, `[x]` done and verified. Update this file as work lands; it is the running state for future Claude Code sessions.

**Release status.** **v1.0.0 released 2026-09-19** from `main` at https://github.com/Fallt0earth/pf2e-d20-session-tracker (tag `v1.0.0`; the Release workflow attached `module.json` and `module.zip`, verified by download: 79 files, manifest at the top level, download pinned to the tag). Install manifest: `https://github.com/Fallt0earth/pf2e-d20-session-tracker/releases/latest/download/module.json`. The intermediate tags planned for M1–M3 (`v0.1.0`–`v0.3.0`) were never cut; 1.0.0 is the first release. Next: the Forge gates (manual, David) and M5.

---

## 1. New findings since the scope doc (2026-09-15)

### 1.1 Reroll code path — order of operations confirmed [V]
Read `src/module/system/check/check.ts` at tag `7.8.0` (closest tag to 7.12.2; SCOPE §5 found the same fields at `main`). Inside `rerollFromMessage`, in this order:

1. `unevaluatedNewRoll.options.isReroll = true;` then `const newRoll = await unevaluatedNewRoll.evaluate({ allowInteractive })`.
2. `Hooks.callAll("pf2e.reroll", Roll.fromJSON(oldRollJSON), newRoll, resource, options.keep);`
3. Kept roll: `keptRoll = newRoll` unless `(keep === "higher" && oldRoll.total > newRoll.total) || (keep === "lower" && oldRoll.total < newRoll.total)`, in which case `keptRoll = oldRoll` — **the original Roll object, same natural**.
4. `await message.delete({ render: false });`
5. `keptRoll.toMessage({ content: <div class=oldRollClass>…old…</div><div class="reroll-second newRollClass">…new…</div>, flavor, speaker: message.speaker, flags: { core: { initiativeRoll }, pf2e: systemFlags } }, { rollMode: context.rollMode })`. One of the two divs carries class `reroll-discard`. The discarded roll is **not** stored in flags — HTML only.

Consequences: (a) the `pf2e.reroll` hook fires on the **rolling client only** (Foundry hooks are local) and **before** the delete and the create, so the rolling client can annotate the new message before it exists (§4.2). (b) When the old roll is kept, the new message's `rolls[0]` *is* the old die — the double-count trap in SCOPE §5.3 is real, and the enrichment in §4.2 avoids it without parsing HTML on the live path.

### 1.2 PF2e Toolbelt "Target Helper" saves never reach `createChatMessage` [V]
The Toolbelt wiki (Target-Helper page) says target rows on a damage message let users "roll the saves by simply clicking on the button **without generating an extra message in the chat**"; results live in the damage message and show in a tooltip; a "Roll NPC Saves" button lets the GM roll all at once; a save can be rerolled by clicking again. Toolbelt 3.41.1 is **active on David's world** (screenshot 3). If Target Helper is enabled there, **a large share of the party's saving throws exist only as `updateChatMessage` events on damage messages**, in Toolbelt's flags. A design that only listens to `createChatMessage` would silently miss them. See §4.1 (extractors) and spike S5 in §5.

### 1.3 Workbench "Keeley's Hero Point Rule" leaves the die intact [V]
README: "if reroll die is 10 or less, get a +10 bonus". It changes the total/outcome, not the natural. No effect on luck metrics; a footnote in the fun tab only. Whether it is enabled on David's world is input I7 (§2).

### 1.4 The active module list (screenshots) — what matters
66 active modules. Relevant to this build:

| Module (version) | Relevance |
|---|---|
| Dice Stats 1.22.2 | The aggregate tracker already in use (SCOPE §1). Coexists fine — both only read messages. Consider disabling after M2 to avoid two stats buttons (David's call). |
| PF2e Toolbelt 3.41.1 | §1.2. Its "Upgrade Checks Messages" option also rewrites check-card HTML — never parse card HTML except for the reroll fallback. |
| PF2e Workbench 6.35.7 | §1.3; auto-damage creates `damage-roll` messages (skipped per SCOPE §5.1). |
| PF2e Flat Check V3.2.0 | **Identified [V]:** Latharne's fork of jessev14's module, id `pf2-flat-check`, release tag `V3.2.0` (last v13 build; 4.0.0 is v14-only). Read from `scripts/main.js` at that tag: it evaluates a plain `new Roll("1d20")` and creates a message with **no `rolls` array** — the result exists only in HTML rendered from `templates/flat-check.hbs`, flagged `flags["pf2-flat-check"] = true`; it runs on the **first active GM's client** (author = GM, speaker = the attacker's token/actor); `blind` + GM whisper only when a target is Undetected; with the world setting `hideRollValue` on, the number is replaced by success/failure text. Needs its own extractor (§4.1 item 4). |
| Dice Tray 3.5.5 | Produces raw `/r 1d20`-style rolls → `type: "raw"`, covered by the `captureRawRolls` setting. |
| Pf2E Modifiers Matter 1.16.9 | Updates check messages after creation (highlighting). The `updateChatMessage` listener must be idempotent (dedupe by record id, §4.3). |
| socketlib v1.1.4, libWrapper 1.13.5.1 | Present, so optional integrations are possible, but the module takes **no hard dependency** on either (SCOPE Must-3). |
| PopOut! 2.24 | The ApplicationV2 window should tolerate being popped out (no reliance on globals beyond the app element). |
| The Forge 1.14.10 | Confirms hosting; deployment per SCOPE §7.2. |
| Dice So Nice | **Not in the active list** (alphabetically it would sit between Dice Stats and Dice Tray). Nothing to wait on before posting summaries; keep the `diceSoNiceRollComplete` guard anyway (cheap). |

Nothing else in the list (HUDs, Token Action HUD, Argon, Sequencer, Item Piles, Polyglot…) changes how d20 checks are created; they all route through PF2e's check system.

### 1.5 Small API confirmations
- felddy image tags: `ghcr.io/felddy/foundryvtt:13`, `:13.x`, `:13.x.x`; env `FOUNDRY_HOT_RELOAD=true`, `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD` or `FOUNDRY_LICENSE_KEY`, `FOUNDRY_ADMIN_KEY`; data at `/data` [V] README.
- v13 progress notifications: `ui.notifications.info(msg, { progress: true })` returns a Notification; `ui.notifications.update(n, { pct, message })` [V] api/v13 Notifications page example. Use for backfill progress.
- `ChatMessage.timestamp` is a plain `NumberField` [V]; whether its initial value comes from the *creating client's* clock is [U] (believed `initial: Date.now`). If so, a player with a wrong system clock can land in the wrong evening. Mitigation in §4.4.

### 1.6 Live environment facts (2026-09-15)
- **Forge game:** Foundry 13 Stable build **351**, PF2e **7.12.2**, 66 active modules [V] David's screenshot. Input I1 is closed; `module.json` gets `compatibility.verified: "13.351"` and PF2e minimum `7.12.0`.
- **NAS dev host:** reachable over SSH with Docker up and port 30000 free. Host details are deliberately kept out of this public repository.
- **Image:** `ghcr.io/felddy/foundryvtt:13.351.0` exists; digest `sha256:41d518782f2fabbec887413c56da8ef8175c22fb5a75fde45382661443a8ae6b` [V] `docker buildx imagetools inspect` on the NAS. Pin by digest per the NAS rules.
- The NAS operating rules in `docs/nas-quickstart.MD` bind every SSH/deploy step in this plan (no SMB for appdata, compose runs on the NAS over SSH, secrets only in `env/` on the NAS, tar → scp → staging → rsync for file transfer, never touch array/network/DNS).

### 1.7 Scope and ground-truth changes (David, 2026-09-15)
- **Historical backfill is post-1.0.** Reading the world's past chat log (SCOPE Should-6, decision D5) is no longer a v1 goal. v1 records live play from install onward. What stays in v1 is a small **catch-up for the current evening** (§5 M2) because it is the same normalizer with a date filter and it protects against a GM page reload or a Forge idle mid-session. Everything else about history is listed in the post-1.0 backlog at the end of §5.
- **Ground truth:** the scope document came from a web-UI Claude session. Its environment assumptions (candidate modules, `<url>` placeholders, the deploy-script reference in the NAS quickstart) are superseded by the module screenshots, `docs/nas-quickstart.MD`, and the honey-tasting `deploy.ps1` David placed at the repo root. Its PF2e source claims were re-verified here where they matter (§1.1).
- **GitHub identity:** `Fallt0Earth`, confirmed by David 2026-09-19. Manifest URLs in `module.json` and §7.2 use it; the remote is `https://github.com/Fallt0Earth/pf2e-d20-session-tracker.git`.

### 1.8 Presentation decisions (David, 2026-09-19)
- **D6 — Human-readable first layer.** The first thing anyone sees is percentages and plain sentences, never a z-score: a **luck percentage** ("luckier than 86% of evenings", the normal CDF of the mean-based z, clamped to 1–99% and hidden below 5 rolls), the **average roll** against the fair 10.5, the **share of high rolls** (11+, fair is 50%), and **Nat 20 / Nat 1 counts with their rate** (fair is 5%). A centre-anchored meter shows luck at a glance. The z-score, exact percentile and binomial tails stay available one level down: the expanded row on Tonight, a details line on Fun, and tooltips on History. Ranking is unchanged (percentile and z order identically). Implemented in `ui/tonight-decorate.js`; `luckSummary` gained `high` and face `rate`.
- **D8 — Licence: GPL-3.0.** David created the GitHub repo with a GPL-3.0 `LICENSE`; the locally drafted MIT file was dropped when the histories were merged. README and `package.json` say GPL-3.0. Only design patterns, no code, came from the three MIT modules surveyed in SCOPE §1, so nothing conflicts. As sole author David can relicense later.
- **D7 — The report is a popup, opened only by an explicit click.** The chat summary card is gone. The scroll button in the tracker (any user who may open the tracker), `api.openReport(key)`, or a chat link someone chooses to click opens `ui/report-app.js`, a window of its own on that client only. Opening it posts nothing. The GM may press "Post a link in chat" inside the popup: one line with an Open button (`ui/report-link.js`, `renderChatMessageHTML`), never the report itself.

---

## 2. Inputs needed from David

| # | Input | How to get it | Blocks |
|---|---|---|---|
| I1 | ~~Forge `game.version` and `game.system.version`~~ **Closed 2026-09-15: 13.351 / PF2e 7.12.2** (§1.6) | — | — |
| I2 | ~~Has the world's chat log ever been flushed?~~ **Dropped 2026-09-15:** history backfill is post-1.0 (§1.7). | — | — |
| I3 | Dev instance — **mostly closed** by `docs/nas-quickstart.MD` and §7.1. Still needed from David: (a) Foundry account credentials or licence key written by David into `/mnt/user/appdata/foundry-dev/env/foundry-dev.env` on the NAS (I never handle or persist them), (b) optionally a Forge world export zip so the dev world matches production (actors, tokens, module settings) — a fresh PF2e test world also works now that history backfill is post-1.0, (c) go-ahead to create the appdata folder and start the container (Step 0b). | David | M0.5 and everything after |
| I4 | **Closed 2026-09-19: `Fallt0Earth`.** ~~GitHub account that will host the repo~~, because `module.json` carries two absolute URLs the Forge fetches: `manifest` (`https://github.com/<owner>/pf2e-d20-session-tracker/releases/latest/download/module.json`) and `download` (the zip of one exact version). `git config` here says `Fallt0Earth` — confirm that is the GitHub login, or choose the no-GitHub route (Forge Import Wizard zip upload, §7.3). | — | M1 release |
| I5 | Confirm module id `pf2e-d20-session-tracker` and title "PF2e d20 Session Tracker" | — | M1 (the id is permanent: it keys journal flags and settings) |
| I6 | ~~Which "PF2e Flat Check" module this is~~ **Closed 2026-09-15:** `pf2-flat-check` V3.2.0 by Latharne (§1.4). Only its world setting `hideRollValue` still matters — if it is on, flat-check naturals are not recoverable from chat. | Module settings → PF2e Flat Check | Footnote only |
| I7 | Toolbelt Target Helper enabled? Workbench Keeley rule enabled? | Module settings | M2 extractor priority (§1.2); footnote in the fun tab (§1.3) |
| I8 | Player access default: `all` (players open the window, blind rolls filtered) vs `own` vs `none` | Preference | M3.5 default only; the setting exists either way |
| I9 | Should the GM's own rows (NPC rolls) appear on the leaderboard by default? | Preference | Default of a client toggle only |

I1–I2 are five minutes in the Forge console and unblock the most. Step 0 and M0 need none of them.

---

## 3. Repo layout, tooling, conventions

### 3.1 Layout
```
pf2e-d20-session-tracker/
├─ CLAUDE.md                      short pointer (text in §3.4)
├─ README.md, LICENSE (MIT), CHANGELOG.md
├─ module.json                    SCOPE §7.1, ids from I4/I5
├─ package.json                   scripts: test, lint, build:macro, zip
├─ docs/SCOPE.md, docs/PLAN.md    (this file), docs/TESTING.md (the SCOPE §9 checklist as a runbook, filled in per run)
├─ macros/
│  ├─ analyze.js                  M0 — GENERATED single-file bundle (esbuild) of the pure layer + a console/chat report
│  └─ dump-fixtures.js            exports message samples as JSON for test fixtures
├─ scripts/                       shipped ES modules, no bundler, relative imports
│  ├─ main.js                     init/ready: settings, hooks, scene control, api
│  ├─ constants.js                MODULE_ID, flag keys, schema version, d20 constants
│  ├─ types.js                    JSDoc typedefs (RollRecord, SessionSummary, ...)
│  ├─ settings.js                 world/client settings + keybinding
│  ├─ api.js                      game.modules.get(id).api surface
│  ├─ capture/
│  │  ├─ normalize.js             messageToRollRecords(msgObj, ctx) — pure; runs the extractors
│  │  ├─ extractors/
│  │  │  ├─ pf2e-check.js         flags.pf2e.context checks (incl. initiative, fortune, reroll)
│  │  │  ├─ raw-d20.js            d20 terms with no PF2e context
│  │  │  ├─ toolbelt-saves.js     saves embedded in damage messages (§1.2)
│  │  │  ├─ flat-check.js         pf2-flat-check messages: d20 baked into HTML, no rolls array (§1.4)
│  │  │  └─ index.js              ordered list; each: { id, on: ["create"|"update"|"backfill"], extract(msg, ctx) → RollRecord[] }
│  │  ├─ dice-walk.js             recursive walk of roll JSON terms → d20 results
│  │  ├─ reroll-html.js           fallback parser for .reroll-discard (regex, no DOM)
│  │  ├─ live.js                  GM-only hooks: create/update/delete message → store (queue, debounce, dedupe)
│  │  └─ roller-enrich.js         ALL clients: pf2e.reroll → preDelete → preCreate annotation (§4.2)
│  ├─ backfill/catchup.js         tonight's game.messages → normalize → store (on GM ready + a button); full-history backfill is post-1.0
│  ├─ sessions/
│  │  ├─ bucket.js                sessionKeyFor(ts, { timezone, boundaryHour }) — pure (Intl)
│  │  └─ index.js                 session index (world-setting cache) + rebuild from pages
│  ├─ storage/
│  │  ├─ journal.js               hidden JournalEntry, one page per session, flags read/write, chunked batches
│  │  └─ store.js                 facade: ensureLog(), append(records), getSession(key), listSessions(), setMeta(key, meta)
│  ├─ stats/                      PURE — no Foundry globals, no DOM, no Roll
│  │  ├─ constants.js  basic.js  luck.js  streaks.js  dos.js  rerolls.js
│  │  ├─ binomial.js   chisq.js  normal.js  montecarlo.js  rng.js (mulberry32)
│  │  ├─ awards.js     trends.js  summarize.js (summarizeSession / summarizeCampaign)
│  │  └─ index.js
│  ├─ ui/
│  │  ├─ tracker-app.js           ApplicationV2 + HandlebarsApplicationMixin, tabs
│  │  ├─ view-model.js            records → template context (player filters, count mode, grouping)
│  │  ├─ entry.js                 getSceneControlButtons + keybinding
│  │  ├─ export.js                CSV/JSON via foundry.utils.saveDataToFile
│  │  └─ summary-card.js          chat summary card (M3)
│  └─ util/log.js, util/queue.js
├─ templates/tracker/*.hbs        header, tabs, tonight, fun, history, sessions; partials/histogram.hbs, partials/player-row.hbs
├─ styles/tracker.css             CSS-bar histograms, v13 theme variables
├─ languages/en.json
├─ test/                          node --test; fixtures/ (anonymized message dumps), *.test.js
├─ dev/                           NOT shipped: docker-compose.yml, foundry-dev.env.example, deploy.ps1, backup.ps1, nas-README.md (recovery notes copied to the NAS), anonymize-fixtures.mjs, build-macro.mjs, e2e/ (optional Playwright)
├─ dev/reference/honey-deploy.ps1 the honey-tasting deploy script David supplied (currently at the repo root as deploy.ps1) — the pattern dev/deploy.ps1 copies
├─ docs/nas-quickstart.MD         NAS connection and interaction rules — read before any SSH or deploy step
└─ .github/workflows/release.yml
```

### 3.2 Tooling decisions
- **No bundler for the module.** Foundry serves `scripts/**` as native ES modules; relative imports work; hot reload covers css/hbs/json; JS needs a browser reload. Keeps the Forge zip trivial and stack traces honest.
- **esbuild as a devDependency only**, to produce `macros/analyze.js` (IIFE) from the pure layer so M0 runs on the Forge as a pasted script macro with zero install.
- **Tests: `node --test`** (Node 20+ ships full ICU, so `Intl` timezone tests need nothing extra). No test-framework dependency.
- **Lint: ESLint flat config.** `no-restricted-globals` (`game`, `foundry`, `Hooks`, `Roll`, `ui`, `canvas`, `document`, `window`) and `no-restricted-imports` scoped to `scripts/stats/**`, `scripts/capture/normalize.js`, `scripts/capture/extractors/**`, `scripts/capture/dice-walk.js`, `scripts/capture/reroll-html.js`, `scripts/sessions/bucket.js`. This enforces SCOPE's "keep the stats layer free of Foundry globals" mechanically.
- **JS with JSDoc types**; `// @ts-check` in the pure layer with a minimal `jsconfig.json` (`checkJs`) so editors surface type errors without a build step.
- **Versioning:** semver; never reuse a version (SCOPE §7.1); `CHANGELOG.md` per release.

### 3.3 Coding conventions
- One normalizer, two callers (live and backfill) — SCOPE §4 key rule. The normalizer takes `ChatMessage#toObject()`-shaped plain data (`rolls` as JSON strings or objects, `content` as an HTML string), never a live document, so fixtures and tests use the exact shape production sees.
- Record ids are deterministic (§4.3) so every path is idempotent.
- No `Roll` in stats or simulation code (SCOPE §4.5).
- All user-facing strings in `languages/en.json`.
- Timestamps are ms epoch everywhere; everything else is derived.

### 3.4 CLAUDE.md (create in Step 0; fill `<url>` from I3)
```
# pf2e-d20-session-tracker
Read docs/SCOPE.md (requirements, decisions D1–D5, PF2e specifics) then docs/PLAN.md (current plan and status) before any work.
Target: Foundry VTT v13 (verified 13.351) + PF2e 7.12.2. Use only APIs unchanged in v14 (ApplicationV2, record-shaped scene controls, message.author, foundry.* namespaces).
Dev/test instance: http://your-docker-host:30000 (felddy Docker image on the NAS, hot reload on). Deploy the module there with dev/deploy.ps1; never hand-edit files under /mnt/user/appdata/foundry-dev/app/. Read docs/nas-quickstart.MD before any SSH or deploy step and follow its rules without exception. Never test against the Forge game except at the deploy gates in PLAN §5.
Rules: scripts/stats/** and the normalizer/extractors must import nothing from Foundry and use no Foundry/DOM globals (lint enforces it); never call Roll in stats or Monte Carlo code; one normalizer for live capture and backfill; record ids are deterministic; run `npm test` and `npm run lint` before declaring anything done; update docs/PLAN.md checklists as milestones land; never reuse a released version number.
```

---

## 4. Architecture refinements

### 4.1 Normalizer and extractors
`messageToRollRecords(msg, ctx) → RollRecord[]` where:
- `msg` = plain object as from `ChatMessage#toObject()` (`_id, timestamp, author, speaker, blind, whisper, rolls[], flags, content, flavor`). `rolls[]` entries may be JSON strings (as stored) or parsed objects; the normalizer accepts either.
- `ctx` = `{ sessionKeyFor(ts), event: "create"|"update"|"backfill", updaterUserId?, inCombat?: boolean|null, existing?: (baseId) => RollRecord|undefined }`.
- Runs the ordered extractors; each returns zero or more records. Precedence: a message with `flags.pf2e.context.type === "damage-roll"` yields nothing from `pf2e-check`/`raw-d20` but **is** offered to `toolbelt-saves`.

Extractors:
1. **pf2e-check** — `flags.pf2e.context.type` in `CheckType` (SCOPE §5). Walks every roll's terms (`dice-walk.js`) for `faces === 20` results; one record per physical die; `kept = active !== false && !discarded`; formula from the Die term (`1d20`, `2d20kh`, `2d20kl`). Fills `type, domains, ident (context.identifier), action, dc, dcVisible, outcome, unadjustedOutcome, isReroll, mode (context.messageMode), rollTwice`. Initiative is a check with `type: "initiative"` (`flags.core.initiativeRoll` as a fallback tag). Reroll messages (`context.isReroll`) follow §4.2.
2. **raw-d20** — any other message whose rolls contain a d20 term and no PF2e context: `type: "raw"`, `source: "raw"`. Gated by the `captureRawRolls` setting at capture time (M0 still counts them in the coverage report).
3. **toolbelt-saves** — messages with `flags["pf2e-toolbelt"]?.targetHelper` (exact structure **[U]**, to be read from a fixture in spike S5). One record per target save present: `type: "saving-throw"`, `source: "toolbelt"`, `domains: [saveSlug, "saving-throw"]`, `actorId` from the target token/actor, `dc` from the message's save DC, `outcome` from the entry, `userId` = the updating user on live `update` events (hook `userId` argument); on backfill, the target actor's first non-GM owner, else the message author, flagged `userGuess: true`. Runs on `create`, `update`, `backfill`.
4. **flat-check** — messages with `flags["pf2-flat-check"] === true` (§1.4). They are not roll messages (`isRoll` is false), so this extractor runs on `content`: parse the natural from the rendered template (markup **[U]**, taken from the S6 fixture), `type: "flat-check"`, `source: "pf2-flat-check"`, `dc` from the rendered DC if present, `actorId`/`tokenId` from the speaker (the attacker), `userId` = the first non-GM owner of that actor else the GM author, flagged `userGuess: true` (the module creates the message on the GM's client, so the author is always the GM). When `hideRollValue` is on the number is absent: emit `natural: null, valueHidden: true` so coverage still counts the check while luck stats skip it. Whether flat checks count toward luck at all is a client toggle (default on; they are fair d20s).

Because of (3) and (4), the normalizer must not gate on `message.isRoll` globally; only extractors (1) and (2) require d20 terms in `rolls`.

`dice-walk.js` recurses through `terms[]`, pool `rolls[]` and parenthetical `roll`/`terms` so `/r 1d20 + 1d20` or `{1d20, 1d20}kh` are handled generically; each result gets `dieIndex` = its position in a depth-first walk. Substituted rolls (Assurance) have no Die term → no record, but M0's coverage report counts them as `substituted` (SCOPE §5.4).

### 4.2 Reroll handling (hero point / mythic) — the definitive design
Live path, using the verified order in §1.1.

**Rolling client** (every client runs this; only the one performing the reroll holds state):
```
Hooks.on("pf2e.reroll", (oldRoll, newRoll, resource, keepOrOptions) => {
  pending = { oldNaturals: d20s(oldRoll), newNaturals: d20s(newRoll),
              oldTotal: oldRoll.total, newTotal: newRoll.total,
              keep: typeof keepOrOptions === "string" ? keepOrOptions : (keepOrOptions?.keep ?? "new"), // 7.x string, 8.x object (SCOPE §5.3)
              resource, ts: Date.now() };
});
Hooks.on("preDeleteChatMessage", (msg, opts, userId) => {
  if (pending && userId === game.userId && !pending.oldMessageId) pending.oldMessageId = msg.id;
});
Hooks.on("preCreateChatMessage", (doc, data, opts, userId) => {
  if (pending && userId === game.userId && doc.flags?.pf2e?.context?.isReroll) {
    doc.updateSource({ [`flags.${MODULE_ID}.reroll`]: pending });   // [U] updateSource in preCreate adds the flag as expected (spike S4)
    pending = null;
  }
});
```
Stale guard: discard `pending` if it is older than 10 s when the next hook fires.

**GM client (single writer), on `createChatMessage` of a message with `context.isReroll`:**
- With enrichment `e`: the old die's record (`${e.oldMessageId}:r0:t0:d0`) already exists if it was captured live → update it: `kept = keptOld`, `rerollOutcome: "discarded"|"kept"`, `rerolledBy: newMessageId`. Create the new physical die's record under the new message id: `natural = e.newNaturals[0]`, `isReroll: true`, `kept = keptNew`, `rerollOf: e.oldMessageId`, `resource`. `keptNew = !((keep === "higher" && oldTotal > newTotal) || (keep === "lower" && oldTotal < newTotal))` — the exact PF2e rule [V]. Fortune rerolls (two dice each) generalise: one record per die, same rules.
- If the old record does not exist (rolled while paused / GM offline): create it from `e.oldNaturals` under `e.oldMessageId` with `ts = newMessage.timestamp − 1` and `source: "reroll-enrich"`.
- Without enrichment (older client, edge cases, and the **catch-up path**, since the original message is gone by then): the kept die comes from `rolls[0]`; the discarded die from `reroll-html.js` (`<div class="reroll-discard">` … `<li class="roll die d20…">N</li>`), stored with `source: "reroll-html"`, `kept: false`, `natural: null` if the parse fails (the record then only flags `discardUnknown: true` so the kept die still counts once). Backfill can never see the original message (it was deleted), so no double count arises there.
- `deleteChatMessage` for the original never removes records (SCOPE §5.3).

Verification: SCOPE §9 item 3, run for keep-new, keep-higher with the old die better, keep-higher with the new die better, and keep-lower — each must yield exactly two physical-die records, one kept.

### 4.3 Persisted record schema (v1)
Stored exactly as the normalizer emits, plain JSON, full keys (readability over bytes; measure in spike S2 and revisit only if a session page exceeds ~1 MB):
```
{ id, msgId, dieIndex, ts, sessionKey,
  userId, userGuess?, actorId, tokenId, alias,
  natural, kept, formula, total,
  type, source, domains, ident, action, dc, dcVisible, outcome, unadjustedOutcome,
  isReroll, rerollOf?, rerolledBy?, rerollOutcome?, resource?, rollTwice?,
  mode, blind, whispered, inCombat }
```
- `id` = `${msgId}:r${rollIndex}:t${termIndex}:d${resultIndex}` for dice from rolls; `${msgId}:tb:${targetId}:${seq}` for Toolbelt saves (`seq` increments when the same target's save is rolled again, so a save reroll produces a second record and marks the first `kept: false`); `${msgId}:html:${n}` for HTML-recovered discards.
- Dedupe is by `id`. Live `update` events re-run the normalizer and insert only ids not yet present (or apply the field updates listed in §4.2). This makes Modifiers Matter's post-creation updates harmless.
- `inCombat` is `null` on backfill (SCOPE §4.1).

### 4.4 Sessions (D1 as decided)
- `sessionKeyFor(ts, { timezone, boundaryHour })`: `Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(ts)` → `{ y, m, d, h }`; if `h < boundaryHour`, step back one calendar day via `Date.UTC(y, m - 1, d) - 86400000` (calendar arithmetic, immune to DST). Key `YYYY-MM-DD`; label `YYYY-MM-DD Ddd`.
- Tests: one minute either side of the boundary; DST transitions (Chicago 2026-03-08 and 2026-11-01); a session crossing local midnight; `boundaryHour` 0; a non-Chicago timezone.
- Clock-skew mitigation (§1.5): `live.js` logs a console warning when `|Date.now() − message.timestamp| > 15 min`, so a misconfigured player clock gets noticed. Bucketing stays on `message.timestamp` for live/backfill consistency.
- Session index (world setting `sessionIndex`, a cache): `{ [key]: { pageId, label, excluded, n, firstTs, lastTs } }`. The journal pages are the source of truth; "Rebuild index" reconstructs it from pages. The `gmPresent` heuristic from SCOPE §5.8 only matters for historical backfill and moves to the post-1.0 backlog; live capture already requires an active GM.
- "Current session" = `sessionKeyFor(Date.now())` on the viewing client; the Tonight tab opens on the latest session that has records and shows "no rolls yet" for the current one otherwise.

### 4.5 Storage (D3c as decided)
- One hidden `JournalEntry` named "d20 Session Log", `ownership: { default: 0 }`, flag `flags[MODULE_ID].isLog = true`, id cached in world setting `logJournalId` (self-heals: if missing, search by flag, else create).
- One `JournalEntryPage` (type `text`) per session, `name = sessionKey`, `flags[MODULE_ID] = { v: 1, key, meta: { label, excluded, notes }, records: [...] }`. The page's `text.content` gets a small rendered summary table (M3.5) so the raw journal is readable and exportable by core.
- Writes go through a serial queue (`util/queue.js`) with a 250 ms debounce, so bursts (initiative for eight tokens, "Roll NPC Saves") become one `updateEmbeddedDocuments` call; each call rewrites one page's `records` array (arrays are replaced whole on update). Backfill writes in chunks of at most 20 pages or ~2 MB per call.
- In-memory mirror: `Map<sessionKey, RollRecord[]>` plus a `Set<id>` per session, loaded lazily from pages; the UI reads the mirror.
- Player clients: whether ownership-NONE journals are delivered to non-GM clients is **[U]** (spike S3). If yes, players read pages directly and re-render on `updateJournalEntryPage`. If no, `store.js` falls back to request/response over `game.socket` (`module.pf2e-d20-session-tracker`), served by the active GM with the player-safe filter already applied. The facade hides which path is in use.
- Privacy note for the README: exactly like blind chat messages, stored naturals are readable through the browser console by anyone with a client; the player-facing filter is a UI guarantee, not a cryptographic one (SCOPE Must-4 is about the stats UI).

### 4.6 Stats layer contract (pure)
```
summarizeSession(records, opts) → SessionSummary
  opts: { countMode: "all"|"kept", groupBy: "user"|"actor", includeBlind, includeRaw, includeGM,
          labels: { users: { id: name }, actors: { id: name } }, mc: { iterations: 10000, seed } }
SessionSummary: { key, n, party: GroupSummary, groups: GroupSummary[] (sorted by z desc, then n), awards: Award[], coverage }
GroupSummary: { id, label, n, hist[20], sum, mean, median, mode, min, max, sd, delta, z, percentile,
  zGuard: "ok"|"thin"|"none",
  nat20: { count, expected, pTail }, nat1: { count, expected, pTail },
  streaks: { hot, cold, sameFace, without20 }   // each { length, startTs, endTs, mcPercentile }
  byType: { [type]: { n, mean, hist } }, byStat: { [slug]: { n, mean } },
  dos: { cs, s, f, cf, n }, moments: { clutch, heartbreaker, wasted20 },
  rerolls: { count, netGain, best, list }, fortune: { count, discardedBetter },
  chisq: { stat, df, p, bins: 20|4|null },
  mc: { pips, longestCold, longestHot, modeCount, firstNat20Index } }   // each { observed, percentile }
summarizeCampaign(sessions: { key, records }[], opts) → { perGroup: { zBySession[], cumulativeDelta[], allTimeZ, nat20Rate, best, worst }, rank }
```
Numerics: z and Φ(z) via an erf approximation (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7); binomial tails by direct pmf summation; chi-square p via the regularized lower incomplete gamma (series plus continued fraction), bins chosen from n (20 bins if n ≥ 100, else 4 bins if n ≥ 20, else none); Monte Carlo with a seeded mulberry32 in `rng.js` (seed = hash of the session key so a "1 in N nights" label is stable between renders), K default 10 000, computed lazily on tab open and memoized by a hash of (record ids, opts). Guards from SCOPE §4.5 are data (`zGuard`) rendered by the UI, not prose.

### 4.7 UI
- `TrackerApp` (ApplicationV2 + HandlebarsApplicationMixin), singleton, resizable. `PARTS`: `header` (session picker, group-by, count-mode, include-GM toggles, GM-only pause/backfill buttons), `tabs`, `tonight`, `fun`, `history`, `sessions`. Tab state via `static TABS` / `_prepareTabs` if present in 13.351 **[U]** (spike S7), else a small hand-rolled tab group.
- **Tonight:** party headline (party mean, z, percentile, dice rolled); one row per group: n · mean · Δ · z · percentile · Nat20 (vs expected) · Nat1 (vs expected) · longest hot/cold; expand → 1–20 CSS-bar histogram and per-type table. z greyed at n < 15, hidden at n < 5.
- **Fun:** result tables (player and party), totals, faces never rolled, streaks with timestamps and "1 in N nights", DoS split, hero-point ROI, fortune stats, moments, awards.
- **History:** per-player z by session (CSS sparkline bars), cumulative Δ, all-time rank, best and worst evening; per-session z table.
- **Sessions (GM):** list with n, label, excluded toggle, rename, export CSV/JSON, catch-up (tonight), rebuild index, post summary card, pause capture, reset all data (double confirm; in v1 this is destructive for past evenings since history backfill is post-1.0 — the confirm dialog says so).
- Live refresh: the GM client re-renders the open app after each store append (`render({ parts: ["tonight"] })`); player clients on `updateJournalEntryPage` or on socket push.
- Entry points: scene-control tool in the `tokens` group (`button: true`, `onChange`) [V] SCOPE §6; a keybinding (unbound by default); `game.modules.get(MODULE_ID).api.open()`. Visible to players only when `playerAccess !== "none"`.
- Player-safe view: non-GM users see records filtered by `blindPolicy` (blind or whispered records hidden for the current session by default; always or never as options) and by `playerAccess` (`own` = only their own rows). The filter lives in `view-model.js` and is unit-tested.

### 4.8 Settings and API
World (GM): `timezone` ("America/Chicago"), `boundaryHour` (6), `captureEnabled` (true — the pause toggle), `captureRawRolls` (true), `minRollsToList` (30), `playerAccess` (`all`|`own`|`none`, default per I8), `blindPolicy` (`hideCurrent`|`hideAlways`|`show`), `mcIterations` (10000); hidden: `logJournalId`, `sessionIndex`, `schemaVersion`.
Client: `groupBy` (`user`), `countMode` (`all`), `includeGM` (true), `defaultTab`.
API: `{ open(), close(), catchUp(), getSession(key), listSessions(), summarize(key, opts), exportCsv(key), normalize: messageToRollRecords, sessionKeyFor, stats }` — used by M0's macro and the optional e2e harness.

---

## 5. Milestones

### Step 0 — Repo bootstrap (½ session; needs no inputs) — done 2026-09-15
- [x] `git init`; `.gitignore` (`node_modules/`, `*.zip`, `license_key.txt`, `dev/*.env`, `backups/`, `test/fixtures/raw/`, `dist/`). Nothing committed yet — first commit is David's call.
- [x] Scope doc moved to `docs/SCOPE.md`; root `deploy.ps1` moved to `dev/reference/honey-deploy.ps1`; `CLAUDE.md`, `README.md`, `LICENSE` (MIT), `CHANGELOG.md` created.
- [x] `package.json` (`"type": "module"`; scripts `test`, `lint`, `build:macro`), ESLint flat config with the purity rules (§3.2), `jsconfig.json`. Local Node is 18.16 (works; `engines` set to `>=18`).
- [x] `module.json` per SCOPE §7.1 with owner `Fallt0Earth` (I4 pending confirmation); `scripts/main.js` stub logs on `init`/`ready`; `scripts/constants.js`; `test/smoke.test.js`.
- Acceptance met: `npm test` → 2 pass; `npm run lint` clean; module tree visible inside the container (enable-in-world check pending a world, Step 0b).

### Step 0b — Dev instance on the NAS (½ session; follows `docs/nas-quickstart.MD` §7) — infrastructure done 2026-09-15
- [x] Smoke test passed; 30000 free; folders `app/ env/ data/ backups/` created under `/mnt/user/appdata/foundry-dev/`.
- [x] `env/foundry-dev.env` built on the NAS from the key file David supplied (key never printed; local key file removed on the NAS) with a generated `FOUNDRY_ADMIN_KEY`, mode 600. David reads it with `cat /mnt/user/appdata/foundry-dev/env/foundry-dev.env`. **David: delete `license_key.txt` from the workspace** (git-ignored, but it should not sit on disk).
- [x] The Linux release zip shipped to `data/container_cache/foundryvtt-13.351.zip` (felddy installs from the cache, no foundryvtt.com login). `data/` owned `99:100`; the container runs as that user (the image never chowns).
- [x] `dev/docker-compose.yml` (project `foundry-dev`, image pinned by digest, stable hostname, cache, hot reload, telemetry off, json-file logs), `dev/deploy.ps1` (honey-tasting pattern; sync only by default, `-Init`/`-Compose`/`-Restart`), `dev/backup.ps1`, `dev/nas-README.md` (copied to the NAS as `README.md`).
- [x] First start via `.\dev\deploy.ps1 -Init`: image pulled, container healthy, `/api/status` → `{"active":false,"version":"13.351"}`; `Config/license.json` written from the env key; Foundry logs "Software license requires signature" = EULA still to be clicked.
- [x] Pre-installed on disk: PF2e 7.12.2 (`pf2e-7.12.2` release tag, `system.zip`), `pf2-flat-check` V3.2.0, `pf2e-toolbelt` 3.41.1, `xdy-pf2e-workbench` 6.35.7. Dice Tray and Dice Stats have different asset names on GitHub — install through the Setup UI if wanted (not needed for capture tests: any `/r 1d20` is a raw roll).
- [x] **David, in the browser:** EULA accepted, world created, module + Flat Check + Workbench enabled, players created (2026-09-15). Users have **no passwords** by David's decision: the Forge handles auth for the real game, and this instance is reachable only on the LAN and over Tailscale. Toolbelt would not enable: it requires `lib-wrapper` (its manifest `relationships.requires`). libWrapper 1.13.5.1 (same as the Forge world) is now installed on disk and the container was recreated with `FOUNDRY_WORLD=devworld`, so the world auto-launches after every restart.
- [x] libWrapper 1.13.5.1 installed from its **release** zip; all five modules enabled by David (2026-09-15).
- [x] Acceptance: the instance survived `.\dev\deploy.ps1 -Restart` with the world intact and auto-launched. Still to observe: a module redeploy showing a new version after reload, and css hot reload (R18) — both checked during M1.
- [x] Headless-browser harness (`dev/e2e/foundry.mjs`, Playwright + Chromium, dev-only): joins http://your-docker-host:30000 as any user (no passwords on the dev instance), runs JS in the game, captures the console. Used from here on to verify module load, generate fixture rolls and run the M0.5 spikes without manual clicking.

### M0 — Pure layer, fixtures, validation macro (½–1 session) — done 2026-09-15
Re-scoped 2026-09-15: the macro is a **validation tool** for the normalizer against real messages, not a history feature. It looks at the last 14 days of `game.messages` by default. Acceptance met: 32 tests green, `macros/analyze.js` executed inside the dev game via the harness and reported 67 messages / 79 dice with zero unrecognised d20-bearing messages.
- [x] `scripts/types.js`, `constants.js` (2026-09-15).
- [x] `sessions/bucket.js` + 8 tests (boundary, midnight crossing, both DST nights, boundary 0, another timezone, labels).
- [x] `capture/dice-walk.js` (+6 tests), `extractors/pf2e-check.js` (incl. §4.2 reroll enrichment and HTML fallback), `raw-d20.js`, `toolbelt-saves.js` and `flat-check.js` (permissive first versions pending S5/S6 fixtures), `reroll-html.js`, `normalize.js` (`messageToRollRecords`, `classifyMessage`). `test/normalize.test.js` runs against the dev-world corpus and skips when it is absent.
- [x] `stats/normal.js`, `binomial.js`, `basic.js`, `luck.js` + tests against known values (Φ(1.96) ≈ 0.975; P(≥3 of 22 at 1/20) ≈ 0.0948; z of 1..20 = 0; guards).
- [x] Fixture generation is automated instead of manual: `dev/e2e/make-fixtures.mjs` creates two test characters on the dev world, rolls every message kind (skill, skill+DC, save, perception, blind, gmroll, fortune, misfortune, strike ×2, damage, raw d20 ×3, raw 2d6, initiative, flat check, hero-point rerolls keep new/higher/lower as GM and as PlayerA) with a per-step timeout, records the `pf2e.reroll` hook as ground truth, and dumps `test/fixtures/devworld/{messages,meta}.json`.
- [ ] `scripts/analyze-entry.js`: reads `game.messages` from the last N days (default 14), normalizes, buckets, prints per evening a `console.table` (user, n, mean, Δ, z, Nat20 vs expected, Nat1 vs expected) plus a **coverage report**: counts by kind (PF2e checks per type, raw d20, damage, reroll messages, Toolbelt-save messages, `pf2-flat-check` messages and how many had a readable value, substituted). Its job is to prove every message shape on this world is recognised before live capture is built. Read-only; optional whisper of the latest evening's table to the GM.
- [x] `dev/build-macro.mjs` (esbuild IIFE) → `macros/analyze.js` (26 KB); `macros/dump-fixtures.js` (up to 25 examples per kind from the last 30 days, `saveDataToFile`); `dev/anonymize-fixtures.mjs` (stable pseudonyms; strips `content` except flat-check cards and reroll blocks; keeps `flags`). `dev/e2e/foundry.mjs run macros/analyze.js` executes the bundle inside the dev game.
- [x] Fixture corpus generated on the dev world (67 messages: 36 skill, 6 save, 4 perception, 5 attack incl. MAP and blind, 2 damage, 2 initiative, 2 PF2e flat checks, 8 raw rolls, 4 hero-point rerolls with hook ground truth). `test/normalize.test.js` passes on it, including the discarded-die HTML fallback matching the hook for every keep mode.
- [ ] Optional: David runs `macros/dump-fixtures.js` on the Forge for real-campaign shapes (Toolbelt saves, `pf2-flat-check` cards with the live settings). Not blocking: spikes S5/S6 will produce those on the dev world.
- Acceptance: `npm test` green (32 tests), coverage report shows zero unrecognised d20-bearing messages on the dev corpus, the bundled macro runs inside the dev game (see §1.8), the analyzer writes nothing but the optional whisper.

### M0.5 — Spikes on Docker (1 session) — run 2026-09-15 via `dev/e2e/spikes.mjs`, raw dumps in `test/fixtures/devworld/spikes/`
- [x] S1 **[V]** — A player's blind roll and gmroll both reach the GM client's `createChatMessage` with `rolls` populated (natural readable) and `whisper` = [GM]; `message.isContentVisible` is true on the GM, false on the player. GM-only capture sees everything.
- [x] S2 **[V]** — 50 000 records in one page: 28.8 MB of JSON, `createEmbeddedDocuments` 54 s, one `update` of the array 48 s, read-back instant, join time 3.9 s → 5.5 s with the page present. Per-evening pages (≈300–600 records ≈ 0.2–0.35 MB) extrapolate to ~0.3–0.6 s per write, so the design holds, but M2 stores a **compact format**: records as arrays under a field-name header, `domains` replaced by a derived `stat` slug (target ≈ 150 B/record, 3–4× smaller, sub-200 ms writes).
- [x] S3 **[V]** — An ownership-NONE journal **is** delivered to player clients: `game.journal.get(id)` and its pages exist, flags are readable, `visible` is false, and a page update arrives live. Players read the log directly (the direct path in §4.5); no socket layer.
- [x] S4 **[V]** — On the rolling client the order is `pf2e.reroll` → `preDeleteChatMessage`(original) → `preCreateChatMessage`(isReroll). `doc.updateSource({ "flags.<id>.reroll": … })` in preCreate persists: the GM client sees the flag with `oldMessageId`, both naturals and totals, and `keep`; the original message is gone. The 4th hook argument in 7.12.2 is the keep string. The §4.2 design is confirmed as written.
- [x] S5 **[V]** — Toolbelt Target Helper 3.41.1 (`pf2e-toolbelt.targetHelper.enabled`, **off by default**; on the dev world it is now on). With a targeted Fireball the damage message gets `flags["pf2e-toolbelt"].targetHelper = { type, targets: ["Scene.<id>.Token.<id>"], saveVariants: { [variant]: { dc, basic, statistic, saves: { [tokenId]: { die, value, success, unadjustedOutcome, private, statistic, roll: "<CheckRoll JSON>" } } } }, author, item, private, … }`. PlayerB's click on the card's `[data-action="roll-save"]` produced no chat message and an `updateChatMessage` with `die: 14, value: 14, success: "failure"`; the roll JSON carries `options.rollerId` = PlayerB, so attribution is exact even on catch-up. Extractor rewritten from the dump; `test/toolbelt.test.js` covers it, including save re-rolls via sequence numbers. Input I7 decides whether this path is live on the Forge world; the extractor is dormant otherwise. `User#updateTokenTargets` is gone in v13: use `canvas.tokens.get(id).setTarget(true, { releaseOthers: true })`.
- [x] S6 **[V]** — `pf2-flat-check` V3.2.0 card: `flags["pf2-flat-check"]` is an **empty object** (not `true`), no `rolls`, author = GM, speaker = attacker token/actor, `blind: false` for Concealed; content `Flat Check DC is <b>5</b>` + `<div class="dice-result flat-check-success"><h4 class="dice-total flat-check">7</h4>`; with `hideRollValue` the h4 reads "Success"/"Failure" but the `flat-check-success|failure` class remains. Extractor and `test/flat-check.test.js` updated from the captured cards.
- [x] S7 **[V]** — `ApplicationV2.TABS` and `_prepareTabs` exist in 13.351; `ui.notifications.info(msg, { progress: true })` returns a Notification with `update`; `foundry.utils.saveDataToFile` exists; `ui.controls.controls` is a record with a `tokens` group; `foundry.dice.MersenneTwister` exists; `game.users.activeGM` works.
- [ ] S8 (optional) — `message.timestamp` origin: not run.
- Acceptance: §4.5 read path decided (direct), §4.3 storage format decided (compact, M2). S5/S6 outstanding.

### M1 — Read-only module with the Tonight window (1–2 sessions) — built 2026-09-15, release pending I4
- [x] `settings.js` (all settings in §4.8, keybinding), `main.js` wiring, `api.js`.
- [x] `ui/tracker-app.js` (ApplicationV2 + Handlebars mixin, `TABS`, actions), header + Tonight + Sessions tabs; the M1 in-memory preview source was superseded by the journal store the same day and removed (the analyzer macro covers the read-only use case).
- [x] `ui/view-model.js` (visibility, count mode, grouping, guards) + 6 tests; templates; CSS-bar histogram; `en.json`.
- [x] `ui/entry.js` scene-control tool. PopOut tolerance not yet checked.
- [x] Rendered and screenshotted on the dev instance as GM and as PlayerA through the harness: rows, bands, party card, and the player filter (secret rolls hidden for tonight) behave as designed.
- [ ] `module.json` owner confirmed (I4); `.github/workflows/release.yml` written; tag `v0.1.0`.
- [ ] **Forge gate 1:** Bazaar "Install from Manifest", open the window on the live world.
- Acceptance: §9 items 1, 2, 6, 7 pass (fixtures and unit tests); 4 and 9 pending; Forge gate 1 pending.

### M2 — Persistence, live capture, tonight's catch-up, rerolls (2–3 sessions)
- [x] `storage/codec.js` (compact rows, S2-driven; tests show < 300 B/record and < 60 % of plain JSON), `storage/journal.js` (hidden log, one page per evening), `storage/store.js` (in-memory mirror, upsert by id, debounced serial `WriteQueue`, meta, delete). The world-setting session index was dropped: the store reads every page at ready, which is cheap with per-evening pages, and the pages are the single source of truth.
- [x] `capture/live.js` (activeGM guard by id, pause, create/update hooks, clock-skew warning, token resolver for Toolbelt saves); `capture/roller-enrich.js` (§4.2, S4-verified); `extractors/toolbelt-saves.js` (S5 layout, sequence numbers for card re-rolls); `extractors/flat-check.js` (S6 markup); `stat` slug derived on PF2e records.
- [x] `backfill/catchup.js`: runs on the writer's `ready` and from the Sessions tab; same normalizer with `event: "backfill"`.
- [x] Sessions tab: catch-up, pause, exclude, rename (DialogV2 prompt), delete evening, reset all (double confirm). Export lands in M3.5.
- [x] Every client mirrors the journal through the page hooks (S3); the window re-renders on store changes.
- [x] Tests: 47 green (normalizer corpus incl. the reroll matrix via HTML fallback, Toolbelt save and save-reroll, flat-check visible/hidden, codec round trip, view-model, stats, bucketing).
- [x] Runbook `docs/TESTING.md`; `dev/e2e/verify-m2.mjs` automates §9 items 3, 5, 8, 10 plus Toolbelt, pause, GM reload and the player filter. Run 2026-09-15: 17/18 after two real fixes it caught (the write queue's `flush` did not execute pending work; creating the log journal reloaded and wiped the in-memory store). The last miss was `api.summarize` ignoring the world's access settings — fixed by a shared `ui/view-options.js` and re-checked as PlayerA (14 secret dice hidden). One evening of 108 records = 30 KB on the page. Tag `v0.2.0` pending I4.
- Acceptance status: chat-flush (item 8) PASS; two GMs (item 10) PASS; GM reload PASS; every automated §9 item logged in `docs/TESTING.md`. Outstanding for M2: Forge gate 2 (needs a release, hence I4), Assurance (item 4) and the user-rename check (item 9) by hand, PopOut tolerance.
- [ ] **Forge gate 2:** install; verify item 11 (writes persist across a Forge idle/wake cycle); run one real evening with capture on; afterwards compare the stored session against the M0 macro run over the same evening.
- Acceptance: the chat-flush test (item 8) passes on Docker; two GMs online → single writer (item 10); a GM reload mid-evening loses no rolls (catch-up); every §9 item logged in `docs/TESTING.md`.

### M3 — Fun aggregates and honest statistics (2 sessions) — built 2026-09-15
- [x] `stats/rng.js` (mulberry32, string seeds), `streaks.js`, `dos.js` (split + clutch/heartbreaker/wasted 20), `rerolls.js` (hero-point pairs from enrichment or HTML, fortune pairs), `chisq.js` (incomplete gamma, auto bins), `montecarlo.js` (one loop computes eight statistics per simulated evening; sorted samples; two-tailed placement; "1 in N" floors at 1/(K+1)), `awards.js`, `summarize.js` (`groupSummary`, `campaignTrend`) + `test/stats-fun.test.js` (known values, determinism, corner cases).
- [x] `ui/fun-model.js` (pure; same visibility/grouping rules as Tonight) + test; `ui/fun-decorate.js` (i18n lines, rarity tails, moments); Fun tab with awards box, party card and per-player cards (histogram, DoS bar, streaks with times and rarity, moments, rerolls, fortune, per-stat chips); memoized per session/options; computed only when the tab is shown.
- [x] ~~`ui/summary-card.js` chat card~~ — replaced 2026-09-19 by the report popup (§1.8 D7): `ui/report-app.js` + `templates/tracker/report.hbs`, optional one-line chat link in `ui/report-link.js`. Verified on the dev instance: opening the report creates 0 chat messages; the link is 48 characters with an Open button and yields no records.
- Acceptance: 110-dice evening at K = 10 000 computed in 57 ms on the dev GM client (the 600-dice budget of 1 s has 15× headroom); 60 tests green. Lesson: Handlebars partials referenced by path must be pre-registered with `foundry.applications.handlebars.loadTemplates` (the mixin only loads PARTS). Tag `v0.3.0` pending I4.

### M3.5 — Polish, export, history, player view (1–2 sessions) — built 2026-09-15
- [x] `storage/csv.js` (pure, tested) + `ui/export.js` (CSV/JSON per evening and all, viewer-filtered, `saveDataToFile`); page `text.content` summary table on every write (`storage/page-text.js`), page title follows a rename.
- [x] History tab: `ui/history-model.js` (pure, tested) — all-time rank with best/worst evening and Nat 20 rate, z sparkline per player, evening × player grid; excluded evenings left out.
- [x] `playerAccess` / `blindPolicy` enforced in one place (`ui/view-options.js`) for window, API, exports and the summary card; tests in `test/view-model.test.js`.
- [x] README, CHANGELOG.
- [x] Tag `v1.0.0` pushed 2026-09-19; release assets verified.
- [ ] **Forge gates (David, manual):** Bazaar → Install from Manifest with the URL above; confirm the module loads on the live world; play one evening with capture on; check persistence across a Forge idle/wake (SCOPE §9 item 11); player account walkthrough (blind roll absent from the player view, own-rows mode). Record results in `docs/TESTING.md`.
- Acceptance: SCOPE Must 1–5 and Should 7–11 met on the dev instance; Should 6 (history backfill) deferred post-1.0 by David; v1 code complete pending the Forge gates.

### M4 — Foundry v14 / PF2e 8.x pass (1 session, when David upgrades the Forge game)
- [ ] Bump `compatibility`; confirm the `pf2e.reroll` options-object form (already handled); re-run SCOPE §9 on 14.36x + PF2e 8.5 and `pf2-flat-check` 4.0.0; Forge gate.

### M5 — Configurable session definition (goal set by David 2026-09-19; target 1.1.0)

**Goal.** A table that plays an unusual slot must get correct sessions without fighting the module: overnight games, games that start before and end after the day boundary, two games in one day, a group in another timezone, a marathon. Crossing a calendar date (or the boundary hour) must never split one game in two, and the GM must be able to change the definition later and have stored history follow.

**What v1.0 already does, and where it breaks.** One rule: `sessionKey = local date of (timestamp − boundaryHour)` in the world timezone. It handles "past midnight" when the boundary sits in the dead hours (default 06:00). It breaks when play straddles the boundary itself (a 03:00–09:00 game with the default; any slot if the boundary was set wrong), when two games happen in one "day", and it cannot describe a slot at all: the GM has to reason about an abstract boundary hour.

**Design — a `sessionMode` world setting with three definitions, one pure sessionizer.**
1. **`daily` (default, today's behaviour).** Timezone + boundary hour. UX fix: next to the setting, a live preview sentence built from the current values ("A roll at Sun 01:30 counts toward Saturday's session; the day turns over at 06:00 America/Chicago") and a one-click helper "we usually start at HH:MM" that places the boundary 12 hours opposite the usual start, the point least likely to be mid-game.
2. **`gap` — "a session is a run of play".** A new session starts when no counted roll has happened for `sessionGapHours` (default 5). No clock boundary exists, so any timeslot and any date crossing works, and two games in one day become two sessions. Key = local date of the session's **first** roll, with `~2`, `~3` suffixes for further sessions starting on the same date (`2026-09-19`, `2026-09-19~2`); lexical order stays chronological, and `sessionLabel` renders "2026-09-19 Sat (2)".
3. **`manual` — Start / End buttons** in the tracker header (GM). Rolls between Start and End belong to that session (key = local date of Start, same suffix rule); rolls outside any session go to an `unscheduled` bucket that is hidden from the leaderboard by default and can be assigned to a session or discarded from the Sessions tab. A forgotten End auto-closes after `sessionGapHours` of silence so a session can never swallow next week's game.

**Architecture.**
- `sessions/sessionizer.js` (pure, Foundry-free, unit-tested) replaces the stateless `sessionKeyFor(ts)` at the capture boundary: `assign(ts, state, config) → { key, state }` where `state = { lastTs, lastKey, openManual }` and `config = { mode, timezone, boundaryHour, gapHours }`. `daily` ignores state, so v1.0 behaviour is bit-for-bit unchanged. `bucket.js` stays as the calendar helper both modes use for local dates.
- The store owns the sessionizer state (seeded from the newest stored record on load), so live capture and catch-up go through one code path; catch-up walks messages chronologically from the start of the newest stored session instead of filtering by a precomputed key. The normalizer keeps taking `ctx.sessionKeyFor`, now backed by the store's stateful assigner — extractors do not change.
- **Re-bucket stored history.** Every record keeps its raw `ts` (decision D1 foresaw this). A GM action "Re-apply session definition" recomputes keys for all stored records in chronological order under the current config, moves records between pages, keeps page meta (label, excluded) where a key survives, and reports "N records moved, M sessions created, K removed" after a confirm dialog that shows the before/after session list. Mandatory `dev/backup.ps1`-style safety on the dev instance; on the Forge the journal can be exported first.
- "Current session" (used by the blind-roll policy and the default selection) becomes: `daily` → today's key; `gap` → the newest session if its last roll is within the gap, else none; `manual` → the open session, else none.
- UI wording switches from "Evening" to "Session" when the mode is not `daily`; the Sessions tab gains merge-with-previous and split-at-time for the rare case the gap rule guesses wrong.

**Acceptance (all as unit tests on the pure sessionizer, plus one e2e run).**
- A 22:00–07:30 game is one session in `gap` mode and, with a 12:00 boundary, in `daily` mode; with the default 06:00 boundary `daily` splits it (documented, and the preview sentence makes it visible).
- A 03:00–09:00 game across the default boundary is one session in `gap` and `manual`.
- Two games on one date (13:00–16:00, 20:00–23:30) give `…` and `…~2` in `gap` mode, one session in `daily`.
- Both DST nights, a non-Chicago timezone, and a gap exactly equal to the threshold behave deterministically.
- Live capture and catch-up assign identical keys for the same message stream (drift test); repeated catch-up is a no-op.
- Re-bucket is idempotent, preserves record ids and counts, and round-trips `daily → gap → daily` to the original pages.
- `manual`: rolls before Start land in `unscheduled`; a forgotten End auto-closes; assigning `unscheduled` rolls to a session moves them.
- v1.0 data opens unchanged under 1.1 with `sessionMode: daily`.

**Order of work.** (1) sessionizer + tests; (2) store integration and catch-up rewrite, drift test; (3) `gap` mode end to end with the e2e harness (simulated timestamps via `ChatMessage.create({ timestamp })`); (4) re-bucket action with its confirm/preview; (5) settings UX: preview sentence and the usual-start helper; (6) `manual` mode and the `unscheduled` bucket; (7) merge/split tools; release 1.1.0. Steps 1–5 are the core and can ship as 1.1.0 on their own if manual mode should wait.

### Post-1.0 backlog (deferred 2026-09-15)
- **Whole-history backfill** (SCOPE Should-6, D5): the normalizer already accepts `event: "backfill"`; deferred are the all-sessions UI with progress and date range, the `gmPresent` heuristic and auto-exclusion of junk evenings, attribution guesses for Toolbelt saves and flat checks in old messages, and HTML-only recovery of reroll discards. Needs a world export and `dev/backup.ps1` before the first run on the Forge.
- D3d `TypeDataModel` page subtype if S2 shows flags are too heavy; socket-served player view if S3 says pages are not delivered; Playwright harness; automatic summary card when the first roll of a new evening arrives; cross-session trend charts beyond the M3.5 tables.

---

## 6. Testing and verification strategy

- **Unit (`node --test`):** every file in `scripts/stats/**`, the normalizer and extractors, `bucket.js`, `view-model.js`, `export.js` formatting. Fixture corpus from real messages (anonymized). Drift test: `normalize(msg, { event: "create" })` and `normalize(msg, { event: "backfill" })` (the catch-up path) agree on every fixture except the fields that legitimately differ (`inCombat`, `userGuess`).
- **Docker runbook (`docs/TESTING.md`):** SCOPE §9 as a table (item, how to produce it, expected records, date, version, result), with PF2e API snippets to produce each roll kind from the console. Verified on 7.12.2 (2026-09-15, via `dev/e2e/make-fixtures.mjs`): `actor.skills.<slug>.roll({ skipDialog: true, dc: { value }, rollMode, rollTwice: "keep-higher"|"keep-lower" })`, `actor.saves.<slug>.roll(...)`, `actor.perception.roll(...)`, `game.pf2e.Check.roll(new game.pf2e.CheckModifier("flat-check", { modifiers: [] }), { type: "flat-check", actor, dc: { value }, skipDialog: true })`, `game.pf2e.Check.rerollFromMessage(message, { heroPoint: true, keep: "new"|"higher"|"lower" })`. Strikes (`strike.variants[i].roll({})`, `strike.damage({})`) **ignore `skipDialog`** and open PF2e's modifier dialogs unless the rolling user's flags `flags.pf2e.settings.showCheckDialogs` / `showDamageDialogs` are false (default true). Initiative (`actor.initiative.roll(...)`) needs an active `Combat` with the actor as a combatant ("There is no active encounter" otherwise) and yields `type: "initiative"` with `flags.core.initiativeRoll`.
- **Optional Playwright harness (`dev/e2e/`):** logs in as GM and as a player against the Docker URL, runs the snippets through `page.evaluate`, asserts record counts via the module API, screenshots the window. Build it during M2 if the reroll matrix becomes tedious by hand; it never blocks a milestone.
- **Forge gates** after M1, M2 and M3.5 (SCOPE §8): nothing is "done" until it has run on the Forge with the GM client only.
- **Definition of done for v1:** M3.5 acceptance, Forge gate 3, and `docs/TESTING.md` fully filled in for the shipped version.

---

## 7. Dev loop, release, deploy

### 7.1 Dev instance (Docker on the NAS; SCOPE §7.3, rules in `docs/nas-quickstart.MD`)
- **Layout on the NAS** (quickstart §4): `/mnt/user/appdata/foundry-dev/` with `app/` (deploy-managed, rsync `--delete` target: the compose file and `app/module/` = the shipped module tree), `env/foundry-dev.env` (mode 600, never in the repo), `data/` (the container's `/data`: Foundry config, worlds, systems, modules), `backups/`, `README.md`. `/mnt/user/...` paths only.
- **Compose** (`dev/docker-compose.yml`, run on the NAS over SSH): image `ghcr.io/felddy/foundryvtt:13.351.0@sha256:41d518782f2fabbec887413c56da8ef8175c22fb5a75fde45382661443a8ae6b` (§1.6; re-resolve if the Forge build changes); `env_file: ../env/foundry-dev.env`; `FOUNDRY_HOT_RELOAD=true`; volumes `../data:/data` and `./module:/data/Data/modules/pf2e-d20-session-tracker:ro` (nested bind mount over the data volume); `ports: "0.0.0.0:30000:30000"` — reachable on the LAN and over Tailscale, not from the internet, which with passwords on every user and the admin key satisfies the licence FAQ in SCOPE §7.3; `restart: unless-stopped`; healthcheck `curl -fsS http://localhost:30000/api/status` (curl presence in the image is [U]; fall back to `wget -qO-` or the image's own healthcheck); json-file logging with `max-size: 10m`.
- **Deploy** (`dev/deploy.ps1`, a copy of the honey-tasting script's structure — `Invoke-Ssh` with BatchMode, preflight, tar to `$env:TEMP`, scp to `/tmp/`, staging dir, `rsync -a --delete`, compose up, health poll, `logs --tail=50` on failure — minus the npm and migration blocks): the staging tree is `docker-compose.yml` plus the shipped module folders under `module/`; the rsync target is `app/`. Switches: default = sync files only (module changes need no container action); `-Compose` runs `docker compose up -d` after a compose change; `-Restart` restarts the container; `-Init` for the first run; `-SkipHealth`. Health = `Invoke-RestMethod http://your-docker-host:30000/api/status` returning a `version`. css/hbs/json hot-reload; JS needs a browser reload. Whether Foundry's hot-reload watcher receives inotify events through the `/mnt/user` FUSE layer is **[U]** (R18); if not, the reload key is F5 and nothing else changes.
- **World and packages:** PF2e releases live on GitHub under tags `pf2e-<version>` with assets `system.zip` and `system.json` [V] (`https://github.com/foundryvtt/pf2e/releases/download/pf2e-7.12.2/system.zip`); modules likewise from their release zips, extracted straight into `data/Data/systems/<id>` or `data/Data/modules/<id>` and chowned `99:100`. The world comes from a Forge export extracted into `data/Data/worlds/<world-id>/` or is created fresh in the UI. Users `GM` plus players, no passwords (David's call: the Forge handles auth for the real game; this instance is LAN/Tailscale only, never internet-facing). Toolbelt depends on `lib-wrapper`; Foundry refuses to enable a module whose `relationships.requires` are missing, so dependencies must be installed too. Always install from a package's **release** manifest (`releases/latest/download/module.json` → its `download`), never from a repository's master manifest: libWrapper's master manifest points at the raw source archive, and Foundry drops any package whose manifest references a missing file ("Metadata validation failed for module … does not exist" in the container log).
- **Backup** (`dev/backup.ps1`): tar+gzip the world folder on the NAS into `backups/`, scp pull, prune. Mandatory before any world re-import and before the M2 storage tests (quickstart rule 7).
- **What never happens from this side:** array/power actions, disk work, network or DNS changes, editing other containers' folders, storing or echoing credentials (quickstart §6).

### 7.2 Release (`.github/workflows/release.yml`)
On a `v*` tag: write `version` and `download` into `module.json`; zip `module.json, scripts/, templates/, styles/, languages/, macros/, README.md, LICENSE, CHANGELOG.md`; create the GitHub release with `module.json` and `module.zip` attached. Manifest URL: `https://github.com/<owner>/pf2e-d20-session-tracker/releases/latest/download/module.json`.

### 7.3 Deploy to the Forge (SCOPE §7.2)
Bazaar → Marketplace → Toolbox → "Install from Manifest" the first time (existence of the button is [U]; the Import Wizard is the fallback); update from the Bazaar afterwards; stop/start the game if the new version is not picked up. The module only ever creates its own hidden journal and settings, so no world export is needed for a v1 install; export anyway before the post-1.0 history backfill.

---

## 8. Risk and open-item register

| # | Item | Status | Impact if wrong | Plan |
|---|---|---|---|---|
| R1 | `createChatMessage` fires on the GM client for player blind rolls | [U] | GM-only capture misses blind rolls | Spike S1; fallback: roller-side enrichment already exists for rerolls and could carry naturals for blind rolls too |
| R2 | Page `flags` size ceiling / update cost | [U] | Slow joins or failed writes on long campaigns | Spike S2; fallback: columnar compaction or D3d (`TypeDataModel` page subtype) |
| R3 | Ownership-NONE journal delivered to player clients | [U] | Player view needs a socket path | Spike S3; facade already isolates it |
| R4 | Toolbelt `targetHelper` flag structure; user attribution for inline saves; save-reroll semantics | [U] structure, [V] that saves are inline | Missing most saving throws on this world | Spike S5; extractor + `seq` ids |
| R5 | ~~Flat Check module identity~~ closed (§1.4). Remaining: the extractor parses `pf2-flat-check` template HTML, which can change between module versions; with `hideRollValue` on there is no value to parse | [V] identity, [U] markup | Flat checks missing or unattributed | Spike S6 fixtures; version-guarded parser; `valueHidden` records |
| R6 | `updateSource` in `preCreateChatMessage` on the rolling client adds our flag | [U] | Reroll live path degrades to HTML parsing | Spike S4; HTML fallback exists regardless |
| R7 | `pf2e.reroll` ordering in 7.12.2 matches 7.8.0 | [V] at 7.8.0 and `main`, [U] at 7.12.2 | Enrichment misses the message | Spike S4 confirms |
| R8 | `message.timestamp` set by the creating client's clock | [U] | Misbucketed rolls from a skewed clock | Warning in `live.js`; raw ts stored so re-bucketing is always possible |
| R9 | Forge "Install from Manifest" button exists; restart needed after update | [U] | Slower deploys | Gate 1 observes; Import Wizard fallback |
| R10 | `static TABS` in ApplicationV2 13.351 | [U] | Hand-rolled tabs | Spike S7 |
| R11 | PF2e 8.x / v14: `pf2e.reroll` 4th arg becomes an options object | [V] SCOPE §5.3 | Reroll enrichment breaks after upgrade | Handled in §4.2 code; M4 retest |
| R12 | Big chat logs make whole-history backfill slow | post-1.0 | Frozen GM client | Catch-up only scans one evening in v1; chunked loop with yields when history backfill returns |
| R13 | Two GMs/assistants online | design | Duplicate writes | `game.user === game.users.activeGM` guard [V]; SCOPE §9 item 10 |
| R14 | Stored blind naturals readable from the console by players | known | Same exposure as core blind messages | README note; UI filter is the guarantee offered |
| R15 | Dice Stats module also active | known | Two stats buttons, no data conflict | Note in README; David decides whether to disable it |
| R16 | Workbench Keeley rule alters totals/outcomes of rerolls | [V] | DoS stats for rerolls slightly off | Footnote in the fun tab; naturals unaffected |
| R17 | Between-session test rolls (GM prepping with capture on) create junk evenings | known | Junk sessions | Pause toggle, `minRollsToList`, per-session exclude (SCOPE §5.8); `gmPresent` heuristic returns with history backfill post-1.0 |
| R18 | Foundry hot reload may not see file changes through the `/mnt/user` FUSE bind mount | [U] | Slower iteration only | Observe in Step 0b; F5 is the fallback |
| R19 | Forge world export may not include everything the dev world needs (assets, module data) | [U] | Cosmetic gaps on the dev instance | Only chat messages and actors matter for this module; ignore missing assets |

---

## 9. Effort

| Milestone | Claude Code sessions | David's part |
|---|---|---|
| Step 0 | ½ | none |
| Step 0b | ½ | write the env file on the NAS, export the world from the Forge, install PF2e and modules in the Setup UI |
| M0 | ½–1 | paste two macros on the Forge, send back the JSON |
| M0.5 | 1 | a second browser or device logged in as a player for S1/S3/S5 |
| M1 | 1–2 | I4, I5; Forge gate 1 |
| M2 | 2–3 | reroll, Toolbelt and flat-check tests with a second account; Forge gate 2 during a real evening |
| M3 | 2 | eyeball the fun tab on a real session |
| M3.5 | 1–2 | I8/I9 defaults; Forge gate 3 |
| M4 | 1 | after upgrading the Forge game |

A "session" is one focused Claude Code working block; the estimates assume the spikes come back roughly as expected. M2 is the risk concentration (storage, live capture, rerolls, Toolbelt) and should not be split across the Forge gate.

---

## 10. What to do first

1. Step 0 (no inputs needed), then M0 in full — both run entirely from this machine with `node --test`.
2. David, in parallel: confirm I4 (`Fallt0Earth` on GitHub, or the zip route), write the env file on the NAS, export the world from the Forge (I3a–b), and say go for Step 0b.
3. David runs `macros/analyze.js` and `macros/dump-fixtures.js` on the Forge; the fixture JSON drives the rest of M0's tests and settles R4 and the flat-check markup before M0.5 starts.

**Where to run things on the Forge game.** Console one-liners such as the I6 check: open the game as GM, press F12, choose the Console tab, paste, Enter. The M0 macros are Script macros: Macro Directory → Create Macro → Type "Script" → paste the file's contents → Execute. They also run from the console when wrapped as `(async () => { ... })()`, but the macro route keeps them reusable for later sessions.
