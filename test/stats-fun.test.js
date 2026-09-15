import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, hashSeed, d20 } from "../scripts/stats/rng.js";
import { longestRun, longestSameFace, streakSummary } from "../scripts/stats/streaks.js";
import { dosSplit, moments } from "../scripts/stats/dos.js";
import { heroPointStats, fortuneStats } from "../scripts/stats/rerolls.js";
import { regularizedGammaP, chiSquareP, chiSquareUniform } from "../scripts/stats/chisq.js";
import { observedStats, simulate, locate, oneIn, mcSummary } from "../scripts/stats/montecarlo.js";
import { awards } from "../scripts/stats/awards.js";
import { groupSummary, campaignTrend } from "../scripts/stats/summarize.js";
import { histogram } from "../scripts/stats/basic.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);
let seq = 0;
const rec = (o) => ({ id: `m${++seq}:r0:t0:d0`, msgId: `m${seq}`, dieIndex: 0, ts: 1_700_000_000_000 + seq * 1000, sessionKey: "2026-09-15", userId: "u1", actorId: "a1", tokenId: null, alias: "A", natural: 10, kept: true, formula: "1d20", total: 15, type: "skill-check", source: "pf2e-check", domains: [], stat: "athletics", ident: null, action: null, dc: null, dcVisible: null, outcome: null, unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: false, whispered: false, inCombat: null, ...o });

test("rng: deterministic, uniform-ish, seedable by string", () => {
  const a = mulberry32("2026-09-15"), b = mulberry32("2026-09-15");
  assert.equal(a(), b());
  assert.notEqual(mulberry32("x")(), mulberry32("y")());
  assert.equal(hashSeed("abc"), hashSeed("abc"));
  const rng = mulberry32(42);
  const counts = new Array(20).fill(0);
  for (let i = 0; i < 20000; i++) counts[d20(rng) - 1]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, `face count ${c}`);
});

test("streaks: runs, same face, first/last nat20", () => {
  const v = [3, 4, 5, 12, 16, 17, 18, 19, 2, 20, 20, 7];
  assert.deepEqual(longestRun(v, (x) => x <= 5), { length: 3, start: 0, end: 2 });
  assert.deepEqual(longestRun(v, (x) => x >= 16), { length: 4, start: 4, end: 7 });
  assert.deepEqual(longestSameFace(v), { length: 2, start: 9, end: 10, face: 20 });
  const s = streakSummary(v, v.map((_, i) => 1000 + i));
  assert.equal(s.hot.length, 4);
  assert.equal(s.hot.startTs, 1004);
  assert.equal(s.cold.length, 3);
  assert.equal(s.without20.length, 9);
  assert.equal(s.nat20.first, 9);
  assert.equal(s.nat1.first, -1);
  assert.equal(longestRun([], () => true).length, 0);
});

test("degree of success and moments", () => {
  const rs = [
    rec({ natural: 18, total: 25, dc: 20, dcVisible: true, outcome: "success" }),
    rec({ natural: 19, total: 26, dc: 20, dcVisible: true, outcome: "success" }),      // clutch (highest natural on a success)
    rec({ natural: 1, total: 8, dc: 9, outcome: "failure" }),                          // heartbreaker: 2 would have made 9
    rec({ natural: 20, total: 27, dc: null, outcome: null }),                          // wasted 20
    rec({ natural: 20, total: 20, dc: 5, type: "flat-check", outcome: "success" }),
    rec({ natural: 4, total: 11, dc: 20, outcome: "criticalFailure" }),
    rec({ natural: 4, kept: false, formula: "2d20kh", outcome: "success" }),           // discarded fortune die: not counted
  ];
  assert.deepEqual(dosSplit(rs), { criticalSuccess: 0, success: 3, failure: 1, criticalFailure: 1, n: 5 });
  const m = moments(rs);
  assert.equal(m.clutch.natural, 19);
  assert.equal(m.heartbreaker.natural, 1);
  assert.equal(m.wasted20.dc, null);
  assert.equal(m.wasted20.type, "skill-check");
});

test("hero-point rerolls: enriched pairs and HTML-recovered pairs", () => {
  const original = rec({ id: "A:r0:t0:d0", msgId: "A", natural: 4, kept: false, rerolledBy: "B", rerollOutcome: "discarded" });
  const fresh = rec({ id: "B:r0:t0:d0", msgId: "B", natural: 15, kept: true, isReroll: true, rerollOf: "A", source: "reroll-enrich" });
  const keptOld = rec({ id: "C:r0:t0:d0", msgId: "C", natural: 17, kept: true, rerolledBy: "D", rerollOutcome: "kept" });
  const worse = rec({ id: "D:r0:t0:d0", msgId: "D", natural: 5, kept: false, isReroll: true, rerollOf: "C", source: "reroll-enrich" });
  const htmlKept = rec({ id: "E:r0:t0:d0", msgId: "E", natural: 12, kept: true, isReroll: true });
  const htmlDrop = rec({ id: "E:html:0", msgId: "E", natural: 9, kept: false, isReroll: true, source: "reroll-html" });
  const h = heroPointStats([original, fresh, keptOld, worse, htmlKept, htmlDrop, rec({ natural: 10 })]);
  assert.equal(h.count, 3);
  assert.equal(h.netGain, 11 + 0 + 3);
  assert.equal(h.best.gain, 11);
  assert.equal(h.list.find((x) => x.msgId === "D").gain, 0);
  assert.equal(h.list.find((x) => x.msgId === "E").exact, false);
});

test("fortune and misfortune pairs", () => {
  const f = fortuneStats([
    rec({ msgId: "F", id: "F:r0:t0:d0", natural: 5, kept: false, formula: "2d20kh" }), rec({ msgId: "F", id: "F:r0:t0:d1", natural: 17, kept: true, formula: "2d20kh" }),
    rec({ msgId: "G", id: "G:r0:t0:d0", natural: 3, kept: true, formula: "2d20kl" }), rec({ msgId: "G", id: "G:r0:t0:d1", natural: 14, kept: false, formula: "2d20kl" }),
  ]);
  assert.equal(f.fortune.count, 1);
  assert.equal(f.fortune.avgGain, 12);
  assert.equal(f.misfortune.count, 1);
  assert.equal(f.misfortune.avgLoss, 11);
});

test("chi-square: gamma function, p-values, bin selection", () => {
  close(regularizedGammaP(1, 2), 1 - Math.exp(-2), 1e-9);
  close(chiSquareP(7.815, 3), 0.05, 2e-3);
  close(chiSquareP(30.14, 19), 0.05, 2e-3);
  const uniform = histogram(Array.from({ length: 200 }, (_, i) => (i % 20) + 1));
  const u = chiSquareUniform(uniform);
  assert.equal(u.bins, 20);
  close(u.p, 1, 1e-9);
  const skewed = chiSquareUniform(histogram(Array.from({ length: 120 }, () => 20)));
  assert.equal(skewed.bins, 20);
  assert.ok(skewed.p < 1e-6);
  const coarse = chiSquareUniform(histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 1, 2, 3, 4, 5]));
  assert.equal(coarse.bins, 4);
  assert.equal(chiSquareUniform(histogram([1, 2, 3])).bins, null);
});

test("monte carlo: observed stats, deterministic simulation, placement, one-in labels", () => {
  const s = observedStats([1, 2, 3, 20, 16, 17, 4, 4, 4]);
  assert.equal(s.pips, 71);
  assert.equal(s.longestCold, 3);
  assert.equal(s.longestHot, 3);
  assert.equal(s.maxFaceCount, 3);
  assert.equal(s.firstNat20, 3);
  assert.equal(s.nat20s, 1);
  assert.equal(s.distinctFaces, 7);
  const a = simulate(40, { iterations: 500, seed: "k" }), b = simulate(40, { iterations: 500, seed: "k" });
  assert.deepEqual([...a.pips], [...b.pips]);
  const loc = locate(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 5);
  close(loc.percentile, 0.45, 1e-9);
  close(loc.pAtLeast, 0.6, 1e-9);
  close(loc.pAtMost, 0.5, 1e-9);
  assert.equal(oneIn(0.5), null);
  assert.equal(oneIn(0.01), 100);
  const mc = mcSummary(Array.from({ length: 40 }, (_, i) => (i % 20) + 1), { iterations: 2000, seed: "s" });
  assert.equal(mc.n, 40);
  assert.ok(mc.stats.pips.percentile > 0.3 && mc.stats.pips.percentile < 0.7, `average dice should sit mid-distribution, got ${mc.stats.pips.percentile}`);
  const cursed = mcSummary(Array.from({ length: 40 }, () => 2), { iterations: 2000, seed: "s" });
  assert.equal(cursed.stats.pips.pAtMost, 1 / 2000 * 0 + cursed.stats.pips.pAtMost); // defined
  assert.ok(cursed.stats.pips.pAtMost < 0.01);
  assert.ok(cursed.stats.longestCold.oneInHigh > 100);
});

test("group summary and awards on a synthetic evening", () => {
  const hot = Array.from({ length: 20 }, (_, i) => rec({ userId: "u1", natural: 14 + (i % 6), dc: 15, total: 20 + (i % 6), outcome: "success" }));
  const cold = Array.from({ length: 20 }, (_, i) => rec({ userId: "u2", natural: 1 + (i % 6) }));
  const g1 = groupSummary(hot, { mc: { iterations: 500, seed: "t" } });
  const g2 = groupSummary(cold, { mc: false });
  assert.equal(g1.n, 20);
  assert.equal(g1.band, "blessed");
  assert.equal(g2.band, "cursed");
  assert.equal(g1.dos.success, 20);
  assert.ok(g1.mc.stats.pips.pAtLeast < 0.05);
  assert.equal(g2.mc, null);
  assert.ok(g2.missingFaces.includes(20));
  const party = groupSummary([...hot, ...cold], { mc: false });
  const list = awards([{ id: "u1", label: "Alice", ...g1 }, { id: "u2", label: "Bob", ...g2 }], party);
  const byKey = Object.fromEntries(list.map((a) => [a.key, a]));
  assert.equal(byKey.blessed.label, "Alice");
  assert.equal(byKey.cursed.label, "Bob");
  assert.equal(byKey.snakeEyes.label, "Bob");
  assert.equal(byKey.golden?.label, undefined, "nobody rolled a 20 → no golden award");
  assert.equal(byKey.partyMood.groupId, "party");
  const trend = campaignTrend([{ key: "2026-09-01", naturals: cold.map((r) => r.natural) }, { key: "2026-09-08", naturals: hot.map((r) => r.natural) }]);
  assert.equal(trend.best.key, "2026-09-08");
  assert.equal(trend.worst.key, "2026-09-01");
  assert.equal(trend.points.length, 2);
});
