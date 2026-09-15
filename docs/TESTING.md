# Testing runbook

SCOPE §9 as a checklist, with how each item is produced and its latest result. Automated runs live in `dev/e2e/`:
`make-fixtures.mjs` (fixture corpus), `spikes.mjs` (M0.5 spikes), `verify-m2.mjs` (M2 acceptance). All target the dev
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
| 4 | Assurance (substituted roll) | needs a feat on a test actor | no d20 record | not yet run | — |
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
| + | Summary chat card | header button → Everyone | card with mood, leaderboard, awards; no records extracted from it | PASS 2026-09-15 (screenshot; normalizer yields 0 records) | — |
| + | History tab | open on one recorded evening | all-time card, rank rows, evening grid, sparkline | PASS 2026-09-15 (screenshot) | — |
| + | CSV export | `exportRecords(store, key, "csv")` | header + one row per visible die, download triggered | PASS 2026-09-15 (112 rows, `d20-2026-09-15.csv`) | — |
| + | Journal page text | any write | readable per-player table in the hidden page | PASS 2026-09-15 (532 chars) | — |
| + | Player view hides tonight's secret rolls | PlayerA `api.summarize` / window | secret count 0 for the current evening | PASS 2026-09-15 (window screenshot; API after the view-options fix: 111 stored, 14 secret, 97 visible, own row secret 0) | — |

## How to re-run
```
node dev/e2e/foundry.mjs smoke                # module loads, versions, users
node dev/e2e/make-fixtures.mjs                # regenerate the corpus (adds messages to the dev world)
node dev/e2e/spikes.mjs s1|s2|s3|s4|s5|s6|s7  # individual spikes
node dev/e2e/verify-m2.mjs                    # M2 acceptance; deletes all chat messages on the dev world
npm test && npm run lint
```
