import { test } from "node:test";
import assert from "node:assert/strict";
import { recordsToCsv, recordsToJson, CSV_COLUMNS } from "../scripts/storage/csv.js";

const rec = (o) => ({ id: "m1:r0:t0:d0", msgId: "m1", dieIndex: 0, ts: Date.UTC(2026, 8, 15, 20, 0, 0), sessionKey: "2026-09-15", userId: "u1", actorId: "a1", tokenId: null, alias: 'Rogue "the Knife", esq.', natural: 17, kept: true, formula: "1d20", total: 24, type: "skill-check", source: "pf2e-check", domains: [], stat: "stealth", ident: null, action: null, dc: 20, dcVisible: true, outcome: "success", unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: true, whispered: false, inCombat: null, ...o });

test("csv: header, escaping, booleans, name resolution, chronological order", () => {
  const csv = recordsToCsv([rec({ ts: Date.UTC(2026, 8, 15, 21, 0, 0), id: "m2:r0:t0:d0", msgId: "m2", natural: 3 }), rec()], { users: { u1: "Alice" }, actors: { a1: "Rogue" } });
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], CSV_COLUMNS.join(","));
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-09-15,2026-09-15T20:00:00\.000Z,Alice,Rogue,"Rogue ""the Knife"", esq\.",17,1,1d20,24,skill-check,stealth,20,success,0,1,0,pf2e-check,m1,m1:r0:t0:d0$/);
  assert.match(lines[2], /,3,1,1d20,/);
});

test("json: names and ISO time added, order chronological", () => {
  const out = JSON.parse(recordsToJson([rec({ ts: 2_000_000_000_000 }), rec({ ts: 1_000_000_000_000, id: "x:r0:t0:d0" })], { users: { u1: "Alice" } }));
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "x:r0:t0:d0");
  assert.equal(out[0].userName, "Alice");
  assert.equal(out[0].actorName, null);
  assert.match(out[1].time, /^2033-/);
});
