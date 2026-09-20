import { test } from "node:test";
import assert from "node:assert/strict";
import { erf, normalCdf, twoSidedP } from "../scripts/stats/normal.js";
import { binomialPmf, binomialAtLeast, binomialAtMost, logChoose } from "../scripts/stats/binomial.js";
import { histogram, describe, missingFaces, extremeFaces } from "../scripts/stats/basic.js";
import { luckSummary, zBand } from "../scripts/stats/luck.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);

test("normal: erf and Φ at textbook points", () => {
  assert.equal(erf(0), 0);
  close(erf(1), 0.8427, 1e-4);
  assert.equal(normalCdf(0), 0.5);
  close(normalCdf(1.96), 0.975, 5e-4);
  close(normalCdf(-1.96), 0.025, 5e-4);
  close(twoSidedP(1.96), 0.05, 1e-3);
  assert.equal(normalCdf(Infinity), 1);
});

test("binomial: pmf sums to one, C(n,k) exact, tails match hand calculation", () => {
  close(Math.exp(logChoose(22, 2)), 231, 1e-6);
  let total = 0;
  for (let k = 0; k <= 22; k++) total += binomialPmf(22, k, 0.05);
  close(total, 1, 1e-9);
  // 3 Nat 20s in 22 rolls: P(X ≥ 3) = 1 − [0.95^22 + 22·0.05·0.95^21 + 231·0.0025·0.95^20] ≈ 0.0948
  close(binomialAtLeast(22, 3, 0.05), 0.0948, 5e-4);
  close(binomialAtMost(22, 0, 0.05), 0.95 ** 22, 1e-9);
  assert.equal(binomialAtLeast(10, 0, 0.05), 1);
  assert.equal(binomialAtLeast(10, 11, 0.05), 0);
});

test("basic: histogram, describe, faces", () => {
  const h = histogram([1, 1, 20, 20, 20, 7, 0, 21, 3.5]);
  assert.equal(h[0], 2);
  assert.equal(h[19], 3);
  assert.equal(h[6], 1);
  assert.equal(h.reduce((s, v) => s + v, 0), 6);
  assert.equal(missingFaces(h).length, 17);
  assert.deepEqual(extremeFaces(h).most, [20]);
  const d = describe([1, 2, 3, 4]);
  assert.equal(d.mean, 2.5);
  assert.equal(d.median, 2.5);
  assert.deepEqual(describe([3, 3, 5]).modes, [3]);
  const all = describe(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(all.mean, 10.5);
  close(all.sd, 5.916, 1e-3); // sample sd of 1..20
  assert.equal(describe([]).mean, null);
});

test("luck: a perfectly average set has z 0; a hot set scores high", () => {
  const avg = luckSummary(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(avg.n, 20);
  close(avg.z, 0, 1e-12);
  close(avg.percentile, 0.5, 1e-8);
  assert.equal(avg.zGuard, "ok");
  assert.equal(avg.nat20.count, 1);
  assert.equal(avg.nat20.expected, 1);

  const hot = luckSummary([16, 17, 18, 19, 20, 16, 17, 18, 19, 20, 16, 17, 18, 19, 20, 16, 17, 18, 19, 20]);
  close(hot.mean, 18, 1e-12);
  close(hot.delta, 7.5, 1e-12);
  close(hot.z, 7.5 / (Math.sqrt(33.25) / Math.sqrt(20)), 1e-9);
  assert.equal(zBand(hot.z), "blessed");
  assert.equal(hot.nat20.count, 4);
  assert.ok(hot.nat20.pAtLeast < 0.05);
});

test("luck: human-readable layer — high-roll share and face rates", () => {
  const s = luckSummary([1, 5, 10, 11, 15, 20, 20, 3, 12, 19]);
  assert.equal(s.high.count, 6);
  close(s.high.share, 0.6, 1e-12);
  assert.equal(s.high.expected, 0.5);
  close(s.nat20.rate, 0.2, 1e-12);
  close(s.nat1.rate, 0.1, 1e-12);
  const empty = luckSummary([]);
  assert.equal(empty.high.share, null);
  assert.equal(empty.nat20.rate, null);
});

test("luck: sample-size guards", () => {
  assert.equal(luckSummary([]).zGuard, "none");
  assert.equal(luckSummary([1, 2, 3]).zGuard, "none");
  assert.equal(luckSummary([1, 2, 3, 4, 5, 6, 7, 8]).zGuard, "thin");
  assert.equal(zBand(null), "none");
  assert.equal(zBand(0.5), "noise");
  assert.equal(zBand(-1.5), "cold");
});
