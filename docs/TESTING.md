# Testing runbook

SCOPE §9 as a checklist, with how each item is produced and its latest result. Automated runs live in `dev/e2e/`:
`make-fixtures.mjs` (fixture corpus), `spikes.mjs` (M0.5 spikes), `verify-m2.mjs` (M2 acceptance), `verify-m5.mjs` (1.1), `verify-hardening.mjs` (1.1.1). All target the dev
instance at http://your-docker-host:30000 through the headless harness (`foundry.mjs`); Forge gates are manual.

## Environment
| | Dev instance | Forge |
|---|---|---|
| Foundry | 13.351 | 13.351 |
| PF2e | 7.12.2 | 7.12.2 |
| Modules | lib-wrapper 1.13.5.1, pf2-flat-check V3.2.0, pf2e-toolbelt 3.41.1 (targetHelper on), xdy-pf2e-workbench 6.35.7 | 66 active (docs/PLAN.md §1.4) |
| Users | Gamemaster, PlayerA (owns Test Fighter), PlayerB (owns Test Rogue), Assistant — no passwords | Forge-managed |

## SCOPE §9 checklist
| # | Item | How it is produced | Expected | Dev result (date, version) | Forge result |
|---|---|---|---|---|---|
| 1 | Skill, save, attack (with MAP), flat check, initiative, `/r 1d20`, damage | `make-fixtures.mjs` (PF2e API, dialogs off, active combat for initiative) | one record per d20; damage → none; types from context | PASS 2026-09-15 (0.0.1): 67-message corpus, `npm test` | — |
| 2 | Fortune `2d20kh` and misfortune | `rollTwice` on a skill roll | two records, one `kept:false`, formula tagged | PASS 2026-09-15 (fixtures + `verify-m2`) | — |
| 3 | Hero-point reroll keeping old / new | `Check.rerollFromMessage` keep new / higher / lower, GM and player | exactly two physical dice, one kept; original record refreshed, not duplicated | PASS 2026-09-15 (`verify-m2`: enrichment flag; fixtures: HTML fallback for all keep modes) | — |
| 4 | Assurance (substituted roll) | unit test with a substituted CheckRoll (no Die term), shape per PF2e check.ts | no d20 record; classified "substituted" | PASS 2026-09-15 (`test/substituted.test.js`); live roll with the feat still worth a manual check | — |
| 5 | Player blind roll | PlayerA `rollMode: "blindroll"` | recorded on the GM; absent from the player's view for the current evening | PASS 2026-09-15 (spike S1 + `verify-m2`) | — |
| 6 | GM secret NPC save | GM rolls the Rogue's save as `gmroll` | attributed to the GM user, NPC actor | PASS 2026-09-15 (fixtures: author = GM, speaker = actor) | — |
| 7 | Game crossing local midnight | unit test (`test/bucket.test.js`) incl. both DST nights | one evening | PASS 2026-09-15 | n/a |
| 8 | Flush chat log | `ChatMessage.deleteDocuments` of every message | records unchanged; catch-up is a no-op | PASS 2026-09-15 (`verify-m2`: 108 records kept, catch-up added 0) | — |
| 9 | Rename a user | keyed by id everywhere | history intact | by construction (ids only); manual check pending | — |
| 10 | Second GM / Assistant online | Assistant user joins while the Gamemaster is online | single writer, no duplicate records | PASS 2026-09-15 (`verify-m2`: Assistant "gm (not writer)", one record per roll) | — |
| 11 | Forge: install from manifest, restart, persist across idle/wake | manual on the Forge | module loads; journal and settings persist | — | pending gate 2 |
| + | Toolbelt Target Helper save from the damage card | PlayerB clicks `[data-action="roll-save"]` | one saving-throw record attributed to PlayerB, actor = Rogue | PASS 2026-09-15 (`verify-m2`: natural 6, criticalFailure vs DC 17, userId = PlayerB, actor = Test Rogue) | — |
| + | pf2-flat-check card (visible / hidden value) | strike vs a Concealed target, `hideRollValue` off / on | flat-check record; `valueHidden` when hidden | PASS 2026-09-15 (spike S6 + `test/flat-check.test.js`) | — |
| + | Pause capture | `captureEnabled` off, player rolls, on again, catch-up | nothing recorded while paused; catch-up recovers it | PASS 2026-09-15 (`verify-m2`) | — |
| + | GM reload mid-evening | close and reopen the GM session | records persist; catch-up adds nothing | PASS 2026-09-15 (`verify-m2`: 108 = 108) | — |
| + | Journal write size | 108 records of one evening | compact page | 30 046 bytes ≈ 278 B/record (`verify-m2`) | — |
| + | Fun tab compute time | open the Fun tab on a 110-dice evening, K = 10 000 | under 1 s | 57 ms (2026-09-15, GM client) | — |
| + | Report popup (replaces the chat card) | scroll button / `api.openReport()` | own window on the clicker's client; **0 chat messages** from opening; plain-language party sentence, leaderboard, awards, highlights | PASS 2026-09-19 (screenshot; message count unchanged) | — |
| + | Optional report link | GM presses "Post a link in chat" in the popup | one line with an Open button; clicking opens the popup; no records extracted | PASS 2026-09-19 (48 chars, button wired, normalizer yields 0 records) | — |
| + | Human-readable first layer | Tonight tab, one row expanded | rolls, average (±), high-roll %, Nat 20/1 count · rate, luck % with meter and band; z-score and tails only in the expanded details | PASS 2026-09-19 (screenshot) | — |
| + | History tab | open on one recorded evening | all-time card, rank rows, evening grid, sparkline | PASS 2026-09-15 (screenshot) | — |
| + | CSV export | `exportRecords(store, key, "csv")` | header + one row per visible die, download triggered | PASS 2026-09-15 (112 rows, `d20-2026-09-15.csv`) | — |
| + | Journal page text | any write | readable per-player table in the hidden page | PASS 2026-09-15 (532 chars) | — |
| + | Player view hides tonight's secret rolls | PlayerA `api.summarize` / window | secret count 0 for the current evening | PASS 2026-09-15 (window screenshot; API after the view-options fix: 111 stored, 14 secret, 97 visible, own row secret 0) | — |

## 1.1 — session definition and access control (`dev/e2e/verify-m5.mjs`, 2026-09-19: 16/16)
| Item | How it is produced | Expected | Result |
|---|---|---|---|
| Overnight game, by pause | raw d20 messages with simulated timestamps Sat 22:00 → Sun 07:30 (crosses midnight and the 06:00 turnover) | one session `2026-01-10` with 5 rolls | PASS |
| Two games on one date | 13:00–15:00 and 21:00–23:00 | `2026-01-17` and `2026-01-17~2` | PASS |
| One journal page per session | read the log journal | four pages keyed by session | PASS |
| Re-apply: by pause → by day | `planRebucket` + `applyRebucket` with turnover 06:00 | overnight game splits 4 + 3, `~2` disappears, real sessions untouched | PASS |
| Re-apply: back to by pause; again | same | original layout restored; second run moves 0 | PASS |
| Split, then merge with previous | split at the Sun 05:30 pause, merge back | new key `2026-01-11~2`; merge folds into `2026-01-10` (previous by time, not by key) | PASS after fix |
| Manual Start / End | roll, Start, roll ×2, End, roll | 2 in the session, 2 unscheduled, running key while open, none after End | PASS |
| Move unscheduled into a session | `moveRecords("unscheduled", key)` | rolls counted in the session | PASS |
| Players see: nothing → whole table | GM changes the header control while PlayerA is connected with the window open | window closes and button disappears, then both return, no reload | PASS |
| Round trip | by day → by pause → manual → by day, cleanup | stored sessions identical to the start (`2026-09-15`: 112) | PASS |

## 1.1.1 — hardening (`test/hardening.test.js`, `dev/e2e/verify-hardening.mjs`, 2026-09-21)
Unit (21 tests, pure layer): dice outside 1–20 and beyond 24 per message are not recorded; nesting and roll JSON are bounded; a throwing extractor loses only its own message; records are coerced to the stored shape; a player's far-off live timestamp is filed under the writer's clock, a GM's is kept, nothing lands in the future; a reroll annotation yields exact dice when well-formed, never reaches another user's stored roll or live message, only refreshes the link of the roller's own original, lets a GM reroll a player's check, and falls back to the HTML parser when malformed or contradictory; Toolbelt saves are credited to `rollerId` only for an owner or GM, odd keys / impossible dice / endless re-rolls are dropped; card parsers stay under 500 ms on large unclosed input; `constructor`, `__proto__` and friends stay plain data; CSV formula guard; codec header; merge rule; session-key shape.

Regression on the dev instance with the hardened build (after `dev/backup.ps1`): `verify-m2` **18/18**, `verify-m5` **16/16**.

| Item (`verify-hardening.mjs`, 11/11) | Expected | Result |
|---|---|---|
| Module version | 1.1.1 loaded, writer role | PASS |
| `openReport` with a malformed key, a well-formed key that is not stored, a key with trailing text | no window | PASS |
| `openReport` with a stored key | one window, with content | PASS |
| Tonight / Fun / History / Sessions | all four render | PASS |
| "Post a link in chat" | exactly one chat message carrying the key | PASS |
| PlayerA clicks the GM's link | report window opens on the player's client | PASS |
| The same markup and flag in PlayerA's own message, clicked by the GM | nothing opens | PASS |
| PlayerA posts d20 rolls dated 2020 and 400 days ahead | both filed under today by the GM's clock; no 2020 or future session appears | PASS |
| CSV of the newest session | 19 columns, one row per stored die | PASS |
| Cleanup | stored sessions identical to the start | PASS |
| Consoles | no module errors on the GM or the player client | PASS |

## Supply chain (`test/supply-chain.test.js`, `test/macro-bundle.test.js`, 2026-09-21)
| Item | Expected | Result |
|---|---|---|
| `package.json` | private; dev dependencies are exactly `playwright-core` and `typescript`, exact versions; no runtime, optional or peer dependencies; no install-time scripts | PASS |
| `package-lock.json` | only those two packages; npm registry over TLS; sha512 integrity; no install scripts; no dependencies of their own | PASS |
| `.npmrc` | `ignore-scripts=true`, `save-exact=true`, public registry, no credentials | PASS |
| Shipped files | every import is relative; no URL, `fetch`, `<script>`, CSS `@import`, `eval` or `new Function`; `module.json` requires no other module | PASS |
| Workflows | only `actions/checkout`, pinned to a 40-hex commit; no package manager; no `${{ }}` inside a run script; default token permission none | PASS |
| Planted violations (13: a range, a runtime dependency, a postinstall, a foreign tarball with an install script, scripts re-enabled, a tag-pinned action, a third-party action, `npm ci` in CI, `${{ }}` in a script, `write-all`, a package import, a remote fetch, a remote stylesheet) | every one fails the policy tests; files restored | PASS |
| `macros/analyze.js` | identical to a fresh build; holds only `scripts/` modules; same results as the ES modules over the fixture corpus; runs in the live dev world (`verify-hardening`) | PASS |
| esbuild bundle vs TypeScript bundle (one-off, before the switch) | identical results, console output and whisper HTML for three option sets | PASS |
| `dev/lint.mjs` probes | undefined names, `document` / `window` / `navigator` / `process` / `require` / `fetch` / `game` in a pure file, a pure file importing a Foundry-facing one, missing relative imports and missing exports all reported; `node:` built-ins are not | PASS |
| `npm ci` on a removed `node_modules` | 2 packages, no scripts run, `npm audit` 0, lint, build and 107 tests green | PASS |
| Node 24.21.0 (verified temporary copy; the PC still has 18.16 until the MSI is approved) | `npm ci` with npm 11.19 leaves `package.json` and the lockfile byte-identical; `npm audit signatures`: 2 verified registry signatures, 1 verified attestation; lint 0/0; 107 tests; macro bundle byte-identical to the Node 18 build; e2e smoke loads 1.1.1 | PASS |
| `npm test` script | `node --test test/` runs nothing on Node 22+ (found on 24.21); `node --test` runs the same 107 tests on 18.16 and 24.21 | fixed |

## How to re-run
```
node dev/e2e/foundry.mjs smoke                # module loads, versions, users
node dev/e2e/make-fixtures.mjs                # regenerate the corpus (adds messages to the dev world)
node dev/e2e/spikes.mjs s1|s2|s3|s4|s5|s6|s7  # individual spikes
node dev/e2e/verify-m2.mjs                    # M2 acceptance; deletes all chat messages on the dev world
node dev/e2e/verify-m5.mjs                    # 1.1 session definition + access control; run dev/backup.ps1 first (it re-buckets stored data)
node dev/e2e/verify-hardening.mjs             # 1.1.1 report links, tabs, message time, export; cleans up after itself
npm ci                                        # two packages, install scripts off (.npmrc)
npm test && npm run lint && npm run build:macro
```
