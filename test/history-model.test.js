import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistoryModel } from "../scripts/ui/history-model.js";

let seq = 0;
const rec = (o) => ({ id: `m${++seq}:r0:t0:d0`, msgId: `m${seq}`, dieIndex: 0, ts: 1_700_000_000_000 + seq * 1000, sessionKey: "2026-09-01", userId: "u1", actorId: "a1", tokenId: null, alias: "F", natural: 10, kept: true, formula: "1d20", total: 15, type: "skill-check", source: "pf2e-check", domains: [], stat: null, ident: null, action: null, dc: null, dcVisible: null, outcome: null, unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: false, whispered: false, inCombat: null, ...o });
const gm = { isGM: true, userId: "gm" };
const labels = { users: { u1: "Alice", u2: "Bob" }, actors: {}, gmUserIds: ["gm"] };
const evening = (key, aliceNat, bobNat) => ({ key, label: key, records: [
  ...Array.from({ length: 20 }, (_, i) => rec({ sessionKey: key, userId: "u1", natural: aliceNat + (i % 3) })),
  ...Array.from({ length: 20 }, (_, i) => rec({ sessionKey: key, userId: "u2", natural: bobNat + (i % 3) })),
] });

test("history: per-evening cells, all-time rank, best and worst evening, cumulative delta", () => {
  const m = buildHistoryModel([evening("2026-09-01", 4, 14), evening("2026-09-08", 16, 8), evening("2026-09-15", 10, 10)], { viewer: gm, labels });
  assert.equal(m.sessions.length, 3);
  assert.equal(m.sessions[0].cells.u1.band, "cursed");
  assert.equal(m.sessions[1].cells.u1.band, "blessed");
  assert.equal(m.groups.length, 2);
  const alice = m.groups.find((g) => g.label === "Alice"), bob = m.groups.find((g) => g.label === "Bob");
  assert.equal(alice.best.key, "2026-09-08");
  assert.equal(alice.worst.key, "2026-09-01");
  assert.equal(alice.points.length, 3);
  assert.ok(alice.points[2].cumulativeDelta > alice.points[0].cumulativeDelta);
  assert.equal(bob.evenings, 3);
  assert.equal(m.groups[0].label, bob.allTime.z > alice.allTime.z ? "Bob" : "Alice");
  assert.equal(m.party.points.length, 3);
  assert.equal(m.empty, false);
  assert.equal(buildHistoryModel([], { viewer: gm }).empty, true);
});
