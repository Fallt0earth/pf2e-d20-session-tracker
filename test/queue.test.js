import { test } from "node:test";
import assert from "node:assert/strict";
import { WriteQueue } from "../scripts/util/queue.js";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("debounce coalesces repeated schedules of one key into one write", async () => {
  const q = new WriteQueue({ debounceMs: 30 });
  const runs = [];
  q.schedule("a", async (k) => { runs.push(k); });
  q.schedule("a", async (k) => { runs.push(k); });
  const done = q.schedule("a", async (k) => { runs.push(k); });
  assert.deepEqual(runs, []);
  await done;
  assert.deepEqual(runs, ["a"]);
  assert.equal(q.idle, true);
});

test("flush runs pending work immediately and resolves waiters", async () => {
  const q = new WriteQueue({ debounceMs: 10_000 });
  const runs = [];
  const p1 = q.schedule("a", async (k) => { await tick(5); runs.push(k); });
  const p2 = q.schedule("b", async (k) => { runs.push(k); });
  await q.flush();
  assert.deepEqual(runs.sort(), ["a", "b"]);
  await Promise.all([p1, p2]);
  assert.equal(q.idle, true);
});

test("writes are serial: the second waits for the first", async () => {
  const q = new WriteQueue({ debounceMs: 1 });
  const order = [];
  q.schedule("a", async () => { order.push("a-start"); await tick(30); order.push("a-end"); });
  await tick(5);
  const p = q.schedule("b", async () => { order.push("b-start"); order.push("b-end"); });
  await p;
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});

test("a failing write reports and does not block later writes", async () => {
  const errors = [];
  const q = new WriteQueue({ debounceMs: 1, onError: (e, k) => errors.push(`${k}:${e.message}`) });
  await q.schedule("a", async () => { throw new Error("boom"); });
  let ran = false;
  await q.schedule("b", async () => { ran = true; });
  assert.deepEqual(errors, ["a:boom"]);
  assert.equal(ran, true);
});
