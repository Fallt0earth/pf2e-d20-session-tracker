import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSessionModel, visibleRecords, countedRecords } from "../scripts/ui/view-model.js";

let seq = 0;
const rec = (o) => ({
  id: `m${++seq}:r0:t0:d0`, msgId: `m${seq}`, dieIndex: 0, ts: 1_700_000_000_000 + seq, sessionKey: "2026-09-15",
  userId: "u1", actorId: "a1", tokenId: null, alias: "Fighter", natural: 10, kept: true, formula: "1d20", total: 15,
  type: "skill-check", source: "pf2e-check", domains: [], ident: null, action: null, dc: null, dcVisible: null,
  outcome: null, unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: false, whispered: false, inCombat: null,
  ...o,
});
const gm = { isGM: true, userId: "gm" };
const player1 = { isGM: false, userId: "u1" };
const labels = { users: { u1: "Alice", u2: "Bob", gm: "GM" }, actors: { a1: "Fighter", a2: "Rogue" }, gmUserIds: ["gm"] };

const corpus = [
  ...Array.from({ length: 16 }, (_, i) => rec({ userId: "u1", actorId: "a1", natural: 16 + (i % 5) })),   // hot Alice
  ...Array.from({ length: 16 }, (_, i) => rec({ userId: "u2", actorId: "a2", alias: "Rogue", natural: 1 + (i % 5) })), // cold Bob
  rec({ userId: "u2", actorId: "a2", natural: 20, blind: true }),                       // Bob's secret nat 20 tonight
  rec({ userId: "gm", actorId: "npc", alias: "Goblin", natural: 12 }),                   // GM roll
  rec({ userId: "u1", actorId: "a1", natural: 3, type: "raw", source: "raw" }),          // raw roll
  rec({ userId: "u1", actorId: "a1", natural: 2, kept: false, formula: "2d20kh" }),      // discarded fortune die
];

test("GM sees everything; player visibility follows playerAccess and blindPolicy", () => {
  assert.equal(visibleRecords(corpus, { viewer: gm }).length, corpus.length);
  const tonight = { viewer: player1, currentSessionKey: "2026-09-15" };
  assert.equal(visibleRecords(corpus, tonight).length, corpus.length - 1, "blind record hidden for the current evening");
  assert.equal(visibleRecords(corpus, { ...tonight, currentSessionKey: "2026-09-14" }).length, corpus.length, "past evenings show blind records");
  assert.equal(visibleRecords(corpus, { ...tonight, blindPolicy: "hideAlways", currentSessionKey: "2026-09-14" }).length, corpus.length - 1);
  assert.equal(visibleRecords(corpus, { ...tonight, blindPolicy: "show" }).length, corpus.length);
  assert.equal(visibleRecords(corpus, { ...tonight, playerAccess: "none" }).length, 0);
  const own = visibleRecords(corpus, { ...tonight, playerAccess: "own" });
  assert.ok(own.length > 0 && own.every((r) => r.userId === "u1"));
});

test("count mode, raw and GM toggles", () => {
  const all = countedRecords(corpus, { viewer: gm, labels });
  assert.equal(all.length, corpus.length);
  assert.equal(countedRecords(corpus, { viewer: gm, labels, countMode: "kept" }).length, corpus.length - 1);
  assert.equal(countedRecords(corpus, { viewer: gm, labels, includeRaw: false }).length, corpus.length - 1);
  assert.equal(countedRecords(corpus, { viewer: gm, labels, includeGM: false }).length, corpus.length - 1);
});

test("session model: rows sorted hottest first with labels, guards and histograms", () => {
  const m = buildSessionModel(corpus, { viewer: gm, labels });
  assert.equal(m.rows[0].label, "Alice");
  assert.equal(m.rows.at(-1).label, "Bob");
  assert.equal(m.rows[0].band, "blessed");
  assert.equal(m.rows.at(-1).band, "cursed");
  const gmRow = m.rows.find((r) => r.label === "GM");
  assert.equal(gmRow.luck.zGuard, "none");
  assert.equal(gmRow.band, "none");
  assert.equal(m.party.luck.n, corpus.length);
  assert.equal(m.rows[0].hist.reduce((s, v) => s + v, 0), m.rows[0].luck.n);
  assert.equal(m.rows[0].subtitle, "Fighter");
  assert.equal(m.rows[0].rerolls, 0);
  assert.equal(m.empty, false);
});

test("group by actor uses actor labels and aliases", () => {
  const m = buildSessionModel(corpus, { viewer: gm, labels, groupBy: "actor" });
  const names = m.rows.map((r) => r.label);
  assert.ok(names.includes("Fighter") && names.includes("Rogue") && names.includes("Goblin"), names.join(","));
});

test("player view tonight excludes the secret roll from Bob's numbers", () => {
  const forPlayer = buildSessionModel(corpus, { viewer: player1, labels, currentSessionKey: "2026-09-15" });
  const bob = forPlayer.rows.find((r) => r.label === "Bob");
  assert.equal(bob.luck.nat20.count, 0);
  assert.equal(bob.secret, 0);
  const forGM = buildSessionModel(corpus, { viewer: gm, labels });
  assert.equal(forGM.rows.find((r) => r.label === "Bob").luck.nat20.count, 1);
});

test("empty input", () => {
  const m = buildSessionModel([], { viewer: gm });
  assert.equal(m.empty, true);
  assert.deepEqual(m.rows, []);
  assert.equal(m.party.luck.n, 0);
});
