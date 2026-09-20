import { test } from "node:test";
import assert from "node:assert/strict";
import { Sessionizer, rebucket, rebucketDiff, nextFreeKey, boundaryForUsualStart, dailyExample, normalizeConfig, chronological, UNSCHEDULED } from "../scripts/sessions/sessionizer.js";
import { sessionLabel, compareKeys, parseKey } from "../scripts/sessions/bucket.js";

// Chicago: CDT = UTC-5 (Sep), CST = UTC-6 (winter).
const cdt = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi);
const cst = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h + 6, mi);
const H = 3_600_000;
const run = (config, stamps, seed = []) => { const s = new Sessionizer(config, seed); return stamps.map((ts) => s.assign(ts)); };

test("daily mode is the v1.0 rule, bit for bit", () => {
  const keys = run({ mode: "daily" }, [cdt(2026, 9, 19, 22), cdt(2026, 9, 20, 1, 30), cdt(2026, 9, 20, 5, 59), cdt(2026, 9, 20, 6, 0)]);
  assert.deepEqual(keys, ["2026-09-19", "2026-09-19", "2026-09-19", "2026-09-20"]);
});

test("an overnight 22:00–07:30 game: split by the default daily boundary, one session in gap mode, one with a noon boundary", () => {
  const night = [cdt(2026, 9, 19, 22), cdt(2026, 9, 19, 23, 40), cdt(2026, 9, 20, 2), cdt(2026, 9, 20, 5, 30), cdt(2026, 9, 20, 7, 30)];
  assert.deepEqual([...new Set(run({ mode: "daily" }, night))], ["2026-09-19", "2026-09-20"], "documented: the 06:00 boundary cuts it");
  assert.deepEqual([...new Set(run({ mode: "daily", boundaryHour: 12 }, night))], ["2026-09-19"]);
  assert.deepEqual([...new Set(run({ mode: "gap", gapHours: 5 }, night))], ["2026-09-19"]);
});

test("a 03:00–09:00 game straddling the default boundary is one session in gap mode", () => {
  const early = [cdt(2026, 9, 20, 3), cdt(2026, 9, 20, 5, 45), cdt(2026, 9, 20, 6, 15), cdt(2026, 9, 20, 9)];
  assert.deepEqual([...new Set(run({ mode: "gap" }, early))], ["2026-09-20"]);
  assert.equal(new Set(run({ mode: "daily" }, early)).size, 2);
});

test("two games on one date get ~2; key is the local date of the first roll", () => {
  const stamps = [cdt(2026, 9, 19, 13), cdt(2026, 9, 19, 16), cdt(2026, 9, 19, 22), cdt(2026, 9, 20, 0, 30)];
  assert.deepEqual(run({ mode: "gap", gapHours: 5 }, stamps), ["2026-09-19", "2026-09-19", "2026-09-19~2", "2026-09-19~2"]);
  assert.equal(new Set(run({ mode: "daily" }, stamps)).size, 1);
  assert.equal(nextFreeKey("2026-09-19", new Set(["2026-09-19", "2026-09-19~2"])), "2026-09-19~3");
});

test("gap threshold is inclusive; assignment is order-independent", () => {
  const t0 = cdt(2026, 9, 19, 18);
  assert.deepEqual(run({ mode: "gap", gapHours: 5 }, [t0, t0 + 5 * H]), ["2026-09-19", "2026-09-19"]);
  assert.deepEqual(run({ mode: "gap", gapHours: 5 }, [t0, t0 + 5 * H + 1]), ["2026-09-19", "2026-09-19~2"]);
  // a late-arriving earlier roll joins the session it sits next to
  const s = new Sessionizer({ mode: "gap", gapHours: 5 });
  s.assign(t0 + 2 * H);
  assert.equal(s.assign(t0), "2026-09-19");
  assert.equal(s.sessions.get("2026-09-19").firstTs, t0);
});

test("gap mode across both DST nights and in another timezone", () => {
  assert.deepEqual([...new Set(run({ mode: "gap" }, [cst(2026, 3, 7, 22), cst(2026, 3, 8, 1, 30), cdt(2026, 3, 8, 4)]))], ["2026-03-07"]);
  assert.deepEqual([...new Set(run({ mode: "gap" }, [cdt(2026, 10, 31, 23), cdt(2026, 11, 1, 1, 30), cst(2026, 11, 1, 1, 45)]))], ["2026-10-31"]);
  // 23:30Z on the 19th is 00:30 on the 20th in London (BST): the key follows the world timezone
  assert.deepEqual(run({ mode: "gap", timezone: "Europe/London" }, [Date.UTC(2026, 8, 19, 23, 30)]), ["2026-09-20"]);
});

test("existing sessions seed the assigner (live capture and catch-up agree)", () => {
  const seed = [{ key: "2026-09-19", firstTs: cdt(2026, 9, 19, 19), lastTs: cdt(2026, 9, 19, 23) }];
  const s = new Sessionizer({ mode: "gap" }, seed);
  assert.equal(s.peek(cdt(2026, 9, 20, 1)), "2026-09-19");
  assert.equal(s.peek(cdt(2026, 9, 20, 9)), "2026-09-20");
  assert.equal(s.sessions.size, 1, "peek records nothing");
});

test("current session: daily always, gap only while the last roll is within the gap, manual only while open", () => {
  const t = cdt(2026, 9, 19, 21);
  assert.equal(new Sessionizer({ mode: "daily" }).current(t), "2026-09-19");
  const g = new Sessionizer({ mode: "gap" }, [{ key: "2026-09-19", firstTs: t - 2 * H, lastTs: t }]);
  assert.equal(g.current(t + 1 * H), "2026-09-19");
  assert.equal(g.current(t + 6 * H), null);
  const m = new Sessionizer({ mode: "manual", manualOpen: { key: "2026-09-19", startedTs: t } });
  assert.equal(m.current(t + H), "2026-09-19");
  assert.equal(new Sessionizer({ mode: "manual" }).current(t), null);
});

test("manual mode: inside Start–End, before Start, after End, and a forgotten End", () => {
  const start = cdt(2026, 9, 19, 19), end = cdt(2026, 9, 19, 23);
  const closed = [{ key: "2026-09-19", firstTs: start, lastTs: end, manual: { startedTs: start, endedTs: end } }];
  const s = new Sessionizer({ mode: "manual" }, closed);
  assert.equal(s.assign(start + H), "2026-09-19");
  assert.equal(s.assign(start - H), UNSCHEDULED);
  assert.equal(s.assign(end + 1), UNSCHEDULED);
  const open = new Sessionizer({ mode: "manual", gapHours: 5, manualOpen: { key: "2026-09-26", startedTs: start + 7 * 24 * H } });
  const t = start + 7 * 24 * H;
  assert.equal(open.assign(t + H), "2026-09-26");
  assert.equal(open.assign(t + 3 * H), "2026-09-26");
  assert.equal(open.assign(t + 3 * H + 5 * H + 1), UNSCHEDULED, "forgotten End: silence longer than the gap closes it");
  assert.equal(open.manualExpired(t + 9 * H), true);
});

test("re-bucket: ids and counts preserved, idempotent, daily → gap → daily round-trips", () => {
  let n = 0;
  const rec = (ts, msg) => ({ id: `${msg}:r0:t0:d${n++}`, msgId: msg, ts, sessionKey: "?" });
  const records = [
    rec(cdt(2026, 9, 19, 22), "a"), rec(cdt(2026, 9, 20, 2), "b"), rec(cdt(2026, 9, 20, 7), "c"),   // overnight game
    rec(cdt(2026, 9, 26, 19), "d"), rec(cdt(2026, 9, 26, 19), "d"), rec(cdt(2026, 9, 26, 23), "e"),  // next week, fortune pair in msg d
  ];
  const daily = rebucket(records, { mode: "daily" });
  assert.deepEqual([...daily.keys()], ["2026-09-19", "2026-09-20", "2026-09-26"]);
  const gap = rebucket([...daily.values()].flat(), { mode: "gap", gapHours: 5 });
  assert.deepEqual([...gap.keys()], ["2026-09-19", "2026-09-26"]);
  assert.equal(gap.get("2026-09-19").length, 3);
  assert.equal([...gap.values()].flat().length, records.length);
  assert.deepEqual(new Set([...gap.values()].flat().map((r) => r.id)), new Set(records.map((r) => r.id)));
  const again = rebucket([...gap.values()].flat(), { mode: "gap", gapHours: 5 });
  assert.deepEqual([...again.entries()].map(([k, v]) => [k, v.map((r) => r.id)]), [...gap.entries()].map(([k, v]) => [k, v.map((r) => r.id)]));
  const back = rebucket([...gap.values()].flat(), { mode: "daily" });
  assert.deepEqual([...back.entries()].map(([k, v]) => [k, v.map((r) => r.id).sort()]), [...daily.entries()].map(([k, v]) => [k, v.map((r) => r.id).sort()]));
  const diff = rebucketDiff(daily, gap);
  assert.equal(diff.moved, 1);
  assert.deepEqual(diff.removed, ["2026-09-20"]);
  assert.deepEqual(diff.created, []);
  assert.ok([...gap.get("2026-09-26")].every((r) => r.sessionKey === "2026-09-26"));
});

test("re-bucket in manual mode keeps manual intervals authoritative", () => {
  const start = cdt(2026, 9, 19, 19), end = cdt(2026, 9, 19, 23);
  const recs = [{ id: "a:0", msgId: "a", ts: start - H, sessionKey: "x" }, { id: "b:0", msgId: "b", ts: start + H, sessionKey: "x" }];
  const out = rebucket(recs, { mode: "manual" }, { manualSessions: [{ key: "2026-09-19", firstTs: null, lastTs: null, manual: { startedTs: start, endedTs: end } }] });
  assert.deepEqual([...out.keys()], [UNSCHEDULED, "2026-09-19"]);
});

test("chronological order follows the first roll, not the key", () => {
  // A part split off Sunday 05:30 got the key 2026-01-11~2 although it was played BEFORE Sunday evening (2026-01-11).
  const sat = { key: "2026-01-10", firstTs: cst(2026, 1, 10, 22) };
  const sunEvening = { key: "2026-01-11", firstTs: cst(2026, 1, 11, 20) };
  const sunDawn = { key: "2026-01-11~2", firstTs: cst(2026, 1, 11, 5, 30) };
  const emptyManual = { key: "2026-01-12", firstTs: null, manual: { startedTs: cst(2026, 1, 12, 19), endedTs: null } };
  const loose = { key: UNSCHEDULED, firstTs: cst(2026, 1, 1, 0) };
  const order = chronological([sunEvening, emptyManual, loose, sunDawn, sat]).map((s) => s.key);
  assert.deepEqual(order, [UNSCHEDULED, "2026-01-10", "2026-01-11~2", "2026-01-11", "2026-01-12"]);
  const keys = order.filter((k) => k !== UNSCHEDULED);
  assert.equal(keys[keys.indexOf("2026-01-11~2") - 1], "2026-01-10", "the session before the dawn part is Saturday night");
});

test("labels, ordering and helpers", () => {
  assert.equal(sessionLabel("2026-09-19~2"), "2026-09-19 Sat (2)");
  assert.equal(sessionLabel("2026-09-19"), "2026-09-19 Sat");
  assert.equal(sessionLabel(UNSCHEDULED), "Unscheduled");
  assert.deepEqual(parseKey("2026-09-19~12"), { base: "2026-09-19", seq: 12 });
  assert.deepEqual(["2026-09-19~10", "2026-09-20", UNSCHEDULED, "2026-09-19~2", "2026-09-19"].sort(compareKeys), [UNSCHEDULED, "2026-09-19", "2026-09-19~2", "2026-09-19~10", "2026-09-20"]);
  assert.equal(boundaryForUsualStart(19), 7);
  assert.equal(boundaryForUsualStart(3), 15);
  assert.deepEqual(dailyExample(6), { boundary: "06:00", exampleTime: "03:00" });
  assert.equal(dailyExample(0), null);
  assert.equal(normalizeConfig({ mode: "weird", gapHours: -1 }).mode, "daily");
  assert.equal(normalizeConfig({ gapHours: -1 }).gapHours, 5);
});
