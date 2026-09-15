import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFunModel } from "../scripts/ui/fun-model.js";

let seq = 0;
const rec = (o) => ({ id: `m${++seq}:r0:t0:d0`, msgId: `m${seq}`, dieIndex: 0, ts: 1_700_000_000_000 + seq * 1000, sessionKey: "2026-09-15", userId: "u1", actorId: "a1", tokenId: null, alias: "Fighter", natural: 10, kept: true, formula: "1d20", total: 15, type: "skill-check", source: "pf2e-check", domains: [], stat: "athletics", ident: null, action: null, dc: null, dcVisible: null, outcome: null, unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: false, whispered: false, inCombat: null, ...o });
const gm = { isGM: true, userId: "gm" };
const labels = { users: { u1: "Alice", u2: "Bob" }, actors: { a1: "Fighter", a2: "Rogue" }, gmUserIds: ["gm"] };

test("fun model: groups, party, awards, deterministic Monte Carlo", () => {
  const records = [
    ...Array.from({ length: 20 }, (_, i) => rec({ userId: "u1", natural: 15 + (i % 6) })),
    ...Array.from({ length: 20 }, (_, i) => rec({ userId: "u2", actorId: "a2", alias: "Rogue", natural: 1 + (i % 6) })),
    rec({ userId: "u2", actorId: "a2", natural: 1, blind: true }),
  ];
  const m = buildFunModel(records, { viewer: gm, labels }, { iterations: 300, seed: "t" });
  assert.equal(m.counted, 41);
  assert.equal(m.groups[0].label, "Alice");
  assert.equal(m.groups[1].label, "Bob");
  assert.equal(m.party.n, 41);
  assert.ok(m.groups[0].mc.stats.pips.pAtLeast < 0.05);
  assert.ok(m.awards.some((a) => a.key === "blessed" && a.label === "Alice"));
  assert.ok(m.awards.some((a) => a.key === "snakeEyes" && a.label === "Bob"));
  const again = buildFunModel(records, { viewer: gm, labels }, { iterations: 300, seed: "t" });
  assert.deepEqual(m.groups[0].mc.stats.pips, again.groups[0].mc.stats.pips);
  const player = buildFunModel(records, { viewer: { isGM: false, userId: "u1" }, labels, currentSessionKey: "2026-09-15" }, { mc: false });
  assert.equal(player.counted, 40, "secret roll hidden for the current evening");
  assert.equal(player.groups[0].mc, null);
  assert.equal(buildFunModel([], { viewer: gm }, { mc: false }).empty, true);
});
