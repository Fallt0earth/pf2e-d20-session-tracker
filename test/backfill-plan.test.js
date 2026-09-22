// The whole-history backfill planner: what a chat log would add per evening, under each session
// definition, with the SCOPE junk-evening mitigations and a store that already holds some of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBackfill } from "../scripts/backfill/plan.js";
import { localMidnight, localDateKey, wallClock } from "../scripts/sessions/bucket.js";

const GM = "gmUserGGGGGGGGGG", A = "playerAAAAAAAAAA", B = "playerBBBBBBBBBB";
// Chicago in January is CST = UTC−6: cst(day, hour) is that wall-clock time on 2026-01-<day>.
const cst = (d, h, mi = 0) => Date.UTC(2026, 0, d, h + 6, mi);
let seq = 0;
const roll = (ts, author, natural = 11) => ({ _id: `m${String(++seq).padStart(15, "0")}`, timestamp: ts, author, speaker: { alias: author.slice(0, 7) }, blind: false, whisper: [], rolls: [JSON.stringify({ class: "Roll", formula: "1d20", total: natural, terms: [{ class: "Die", number: 1, faces: 20, modifiers: [], results: [{ result: natural, active: true }] }] })], flags: {}, content: "" });
const chat = (ts, author) => ({ _id: `c${String(++seq).padStart(15, "0")}`, timestamp: ts, author, speaker: {}, blind: false, whisper: [], rolls: [], flags: {}, content: "<p>hello</p>" });
const ctx = { event: "backfill", captureRawRolls: true, sessionKeyFor: () => "unused" };
const daily = { mode: "daily", timezone: "America/Chicago", boundaryHour: 6, gapHours: 5 };

/** Three real evenings, a sheet-testing day, and an evening without the GM. */
function corpus() {
  seq = 0;
  const out = [];
  for (const day of [3, 10, 17]) {                                  // Saturdays 19:00–23:30, GM + two players, 40 rolls
    out.push(chat(cst(day, 19), GM));
    for (let i = 0; i < 40; i++) out.push(roll(cst(day, 19, 5 + i * 6), [GM, A, B][i % 3], (i * 7) % 20 + 1));
  }
  for (let i = 0; i < 4; i++) out.push(roll(cst(6, 15, i * 10), A));   // Tuesday: PlayerA testing a sheet, 4 rolls, no GM
  for (let i = 0; i < 35; i++) out.push(roll(cst(24, 19, i * 6), [A, B][i % 2]));  // Saturday the 24th: players only
  out.push(roll(cst(24, 21), A, 20));
  return out.sort(() => 0.5 - Math.random()); // any order in
}

test("daily: evenings come back in order with counts, players, GM presence and default ticks", () => {
  const plan = planBackfill(corpus(), { ctx, config: daily, gmUserIds: [GM], minRolls: 30 });
  assert.equal(plan.scanned, 3 * 41 + 4 + 36);
  assert.deepEqual(plan.sessions.map((s) => s.key), ["2026-01-03", "2026-01-06", "2026-01-10", "2026-01-17", "2026-01-24"]);
  const [sat3, tue6, , , sat24] = plan.sessions;
  assert.deepEqual([sat3.n, sat3.players, sat3.gmPresent, sat3.selected, sat3.existing], [40, 3, true, true, 0]);
  assert.deepEqual([tue6.n, tue6.players, tue6.gmPresent, tue6.selected], [4, 1, false, false], "sheet testing: below the threshold and no GM");
  assert.deepEqual([sat24.n, sat24.gmPresent, sat24.selected], [36, false, false], "a full evening without a GM message is unticked, not dropped");
  assert.equal(plan.total, 40 * 3 + 4 + 36);
  assert.ok(sat3.firstTs < sat3.lastTs && sat3.records.every((r) => r.sessionKey === "2026-01-03"));
  assert.ok(wallClock(sat3.firstTs, "America/Chicago").hour === 19);
});

test("the two mitigations are knobs: no GM requirement, a lower threshold, both", () => {
  const msgs = corpus();
  assert.deepEqual(planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], minRolls: 30, requireGM: false }).sessions.map((s) => s.selected), [true, false, true, true, true]);
  assert.deepEqual(planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], minRolls: 0 }).sessions.map((s) => s.selected), [true, false, true, true, false]);
  assert.deepEqual(planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], minRolls: 0, requireGM: false }).sessions.map((s) => s.selected), [true, true, true, true, true]);
  assert.deepEqual(planBackfill(msgs, { ctx, config: daily, minRolls: 0, requireGM: false }).sessions.map((s) => s.gmPresent), [false, false, false, false, false], "without GM ids nothing counts as GM presence");
});

test("what the store already holds is skipped and reported; a second run plans nothing", () => {
  const msgs = corpus();
  const first = planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM] });
  const stored = new Set(first.sessions[0].records.map((r) => r.id));               // the 3rd is captured already
  const again = planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], has: (id) => stored.has(id) });
  assert.deepEqual(again.sessions.map((s) => s.key), ["2026-01-06", "2026-01-10", "2026-01-17", "2026-01-24"], "an evening with nothing new is not listed");
  assert.equal(again.skipped, 40);
  const all = new Set(first.sessions.flatMap((s) => s.records.map((r) => r.id)));
  const third = planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], has: (id) => all.has(id) });
  assert.deepEqual([third.sessions.length, third.total, third.skipped], [0, 0, all.size]);
  // half an evening stored: the rest is planned, the stored half counted
  const half = new Set(first.sessions[2].records.slice(0, 15).map((r) => r.id));
  const partial = planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], has: (id) => half.has(id) }).sessions.find((s) => s.key === "2026-01-10");
  assert.deepEqual([partial.n, partial.existing], [25, 15]);
});

test("a date range bounds the scan; the bounds come from the world timezone", () => {
  const msgs = corpus();
  const from = localMidnight("2026-01-10", "America/Chicago"), to = localMidnight("2026-01-18", "America/Chicago");
  const plan = planBackfill(msgs, { ctx, config: daily, gmUserIds: [GM], from, to });
  assert.deepEqual(plan.sessions.map((s) => s.key), ["2026-01-10", "2026-01-17"]);
  assert.equal(plan.scanned, 82);
  assert.equal(localDateKey(from, "America/Chicago"), "2026-01-10");
  assert.equal(wallClock(from, "America/Chicago").hour, 0);
  assert.equal(localMidnight("2026-07-04", "America/Chicago") - Date.UTC(2026, 6, 4), 5 * 3_600_000, "CDT is UTC−5");
  assert.equal(localMidnight("2026-01-04", "Pacific/Kiritimati") - Date.UTC(2026, 0, 4), -14 * 3_600_000);
  assert.equal(localMidnight("nope"), null);
});

test("by pause: an overnight game is one session, two games on one date are two, and stored sessions are respected", () => {
  seq = 0;
  const msgs = [];
  for (let i = 0; i < 40; i++) msgs.push(roll(cst(10, 22, i * 12), [GM, A][i % 2]));    // Sat 22:00 → Sun 05:48
  for (let i = 0; i < 32; i++) msgs.push(roll(cst(17, 13, i * 3), [GM, A][i % 2]));    // Sat 13:00–14:33
  for (let i = 0; i < 32; i++) msgs.push(roll(cst(17, 21, i * 3), [GM, B][i % 2]));    // Sat 21:00–22:33
  const gap = { mode: "gap", timezone: "America/Chicago", boundaryHour: 6, gapHours: 5 };
  const plan = planBackfill(msgs, { ctx, config: gap, gmUserIds: [GM], minRolls: 30 });
  assert.deepEqual(plan.sessions.map((s) => [s.key, s.n, s.selected]), [["2026-01-10", 40, true], ["2026-01-17", 32, true], ["2026-01-17~2", 32, true]]);
  // A stored session on the 17th at 13:00 already exists under its own key: the afternoon rolls join it, the evening gets ~2 as before.
  const stored = [{ key: "2026-01-17", firstTs: cst(17, 13), lastTs: cst(17, 14, 30), manual: null }];
  const withStored = planBackfill(msgs, { ctx, config: gap, gmUserIds: [GM], minRolls: 30, intervals: stored });
  assert.deepEqual(withStored.sessions.map((s) => s.key), ["2026-01-10", "2026-01-17", "2026-01-17~2"]);
});

test("input that is not a message list does not throw", () => {
  const plan = planBackfill([null, {}, { timestamp: "x" }, roll(cst(3, 20), A)], { ctx, config: daily, minRolls: 0, requireGM: false });
  assert.deepEqual([plan.scanned, plan.sessions.length, plan.total], [1, 1, 1]);
});
