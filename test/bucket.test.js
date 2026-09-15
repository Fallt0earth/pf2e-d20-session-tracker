import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionKeyFor, sessionLabel, wallClock, compareKeys } from "../scripts/sessions/bucket.js";

// Chicago is UTC-5 (CDT) in September, UTC-6 (CST) in winter.
const cdt = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi);
const cst = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h + 6, mi);

test("wall clock in the world timezone", () => {
  assert.deepEqual(wallClock(cdt(2026, 9, 13, 23, 30)), { year: 2026, month: 9, day: 13, hour: 23, minute: 30 });
  assert.deepEqual(wallClock(cdt(2026, 9, 14, 0, 5)), { year: 2026, month: 9, day: 14, hour: 0, minute: 5 });
});

test("boundary hour: 05:59 belongs to the previous evening, 06:00 starts a new one", () => {
  assert.equal(sessionKeyFor(cdt(2026, 9, 13, 5, 59)), "2026-09-12");
  assert.equal(sessionKeyFor(cdt(2026, 9, 13, 6, 0)), "2026-09-13");
});

test("a game crossing local midnight stays in one session", () => {
  assert.equal(sessionKeyFor(cdt(2026, 9, 13, 19, 0)), "2026-09-13");
  assert.equal(sessionKeyFor(cdt(2026, 9, 13, 23, 59)), "2026-09-13");
  assert.equal(sessionKeyFor(cdt(2026, 9, 14, 1, 15)), "2026-09-13");
});

test("spring-forward night (2026-03-08, Chicago) buckets consistently", () => {
  // 01:30 CST is before the jump; 03:30 CDT is after it. Both are before 06:00 → previous evening.
  assert.equal(sessionKeyFor(cst(2026, 3, 8, 1, 30)), "2026-03-07");
  assert.equal(sessionKeyFor(cdt(2026, 3, 8, 3, 30)), "2026-03-07");
  assert.equal(sessionKeyFor(cdt(2026, 3, 8, 6, 0)), "2026-03-08");
});

test("fall-back night (2026-11-01, Chicago): the repeated 01:30 hour is one evening", () => {
  assert.equal(sessionKeyFor(cdt(2026, 11, 1, 1, 30)), "2026-10-31"); // first 01:30 (CDT)
  assert.equal(sessionKeyFor(cst(2026, 11, 1, 1, 30)), "2026-10-31"); // second 01:30 (CST)
  assert.equal(sessionKeyFor(cst(2026, 11, 1, 6, 0)), "2026-11-01");
});

test("boundary hour 0 = plain calendar day", () => {
  assert.equal(sessionKeyFor(cdt(2026, 9, 14, 0, 30), { boundaryHour: 0 }), "2026-09-14");
});

test("other timezone", () => {
  // 05:00 BST on 14 Sep = 04:00Z → before the boundary → 13 Sep.
  assert.equal(sessionKeyFor(Date.UTC(2026, 8, 14, 4, 0), { timezone: "Europe/London" }), "2026-09-13");
  assert.equal(sessionKeyFor(Date.UTC(2026, 8, 14, 5, 0), { timezone: "Europe/London" }), "2026-09-14");
});

test("labels and ordering", () => {
  assert.equal(sessionLabel("2026-09-15"), "2026-09-15 Tue");
  assert.equal(sessionLabel("2026-09-13"), "2026-09-13 Sun");
  assert.deepEqual(["2026-09-13", "2026-08-30", "2026-09-01"].sort(compareKeys), ["2026-08-30", "2026-09-01", "2026-09-13"]);
});
