import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { encode, decode, encodedSize, flagsUpdate, metaUpdate, rowCount, CODEC_VERSION, FIELDS } from "../scripts/storage/codec.js";
import { messageToRollRecords } from "../scripts/capture/normalize.js";
import { sessionKeyFor } from "../scripts/sessions/bucket.js";

const DIR = new URL("./fixtures/devworld/", import.meta.url);
const have = existsSync(new URL("messages.json", DIR));
const messages = have ? JSON.parse(readFileSync(new URL("messages.json", DIR), "utf8")) : [];
const ctx = { sessionKeyFor: (ts) => sessionKeyFor(ts), event: "backfill", captureRawRolls: true };
const SCOPE = "pf2e-d20-session-tracker";
const rec = (i, extra = {}) => ({ id: `msg${String(i).padStart(13, "0")}:r0:t0:d0`, msgId: `msg${String(i).padStart(13, "0")}`, dieIndex: 0, ts: 1_789_500_000_000 + i * 60_000, sessionKey: "2026-09-15", userId: "u1", actorId: null, tokenId: null, alias: "A", natural: (i % 20) + 1, kept: true, formula: "1d20", total: (i % 20) + 4, type: "skill-check", source: "pf2e-check", domains: [], stat: "athletics", ident: null, action: null, dc: null, dcVisible: null, outcome: null, unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: false, whispered: false, inCombat: null, ...extra });

test("round trip preserves every stored field and restores derived ones", { skip: !have }, () => {
  const records = messages.flatMap((m) => messageToRollRecords(m, ctx));
  assert.ok(records.length > 50);
  const packed = encode(records);
  assert.equal(packed.v, CODEC_VERSION);
  assert.equal(rowCount(packed), records.length);
  assert.equal(Object.values(packed.rows)[0].length, FIELDS.length);
  const back = new Map(decode(JSON.parse(JSON.stringify(packed)), records[0].sessionKey).map((r) => [r.id, r]));
  assert.equal(back.size, records.length);
  for (const a of records) {
    const b = back.get(a.id);
    for (const f of FIELDS) assert.deepEqual(b[f] === undefined ? null : b[f], a[f] === undefined ? null : a[f], `field ${f} of record ${a.id}`);
    assert.equal(b.sessionKey, a.sessionKey);
    assert.equal(b.msgId, a.msgId);
    assert.ok(Array.isArray(b.domains));
  }
});

test("compact format is materially smaller than plain objects", { skip: !have }, () => {
  const records = messages.flatMap((m) => messageToRollRecords(m, ctx));
  const plain = JSON.stringify(records).length;
  const packed = encodedSize(records);
  assert.ok(packed < plain * 0.6, `packed ${packed} vs plain ${plain}`);
  assert.ok(packed / records.length < 320, `bytes per record ${(packed / records.length).toFixed(0)}`);
});

test("decode tolerates empty, missing and short rows, in both layouts", () => {
  assert.deepEqual(decode(null, "2026-09-15"), []);
  assert.deepEqual(decode({ v: 1, rows: [] }, "2026-09-15"), []);
  assert.deepEqual(decode({ v: 2, rows: {} }, "2026-09-15"), []);
  for (const packed of [{ v: 1, fields: ["id", "natural"], rows: [["m1:r0:t0:d0", 20]] }, { v: 2, fields: ["id", "natural"], rows: { "m1:r0:t0:d0": ["m1:r0:t0:d0", 20] } }]) {
    const [r] = decode(packed, "2026-09-15");
    assert.equal(r.natural, 20);
    assert.equal(r.kept, true);
    assert.equal(r.msgId, "m1");
    assert.equal(r.sessionKey, "2026-09-15");
  }
});

test("decode returns roll order whatever the write order was", () => {
  const records = [rec(5), rec(1), rec(3, { dieIndex: 1 }), rec(3, { id: "msg0000000000003:r0:t0:d1", dieIndex: 2 })];
  const back = decode(JSON.parse(JSON.stringify(encode(records))), "2026-09-15");
  assert.deepEqual(back.map((r) => [r.ts - 1_789_500_000_000, r.dieIndex]), [[60_000, 0], [180_000, 1], [180_000, 2], [300_000, 0]]);
});

test("one new roll is one key on the wire; a changed roll is one key; a removed roll is a deletion", () => {
  const page = { v: 1, key: "2026-09-15", meta: {}, data: encode([rec(1), rec(2)]) };
  const next = (records, meta = {}) => ({ v: 1, key: "2026-09-15", meta, data: encode(records) });
  assert.deepEqual(flagsUpdate(SCOPE, page, next([rec(1), rec(2)])), {}, "nothing changed: nothing sent");
  const added = flagsUpdate(SCOPE, page, next([rec(1), rec(2), rec(3)]));
  assert.deepEqual(Object.keys(added), [`flags.${SCOPE}.data.rows.${rec(3).id}`]);
  assert.ok(JSON.stringify(added).length < 400, `one roll should be a few hundred bytes, got ${JSON.stringify(added).length}`);
  const changed = flagsUpdate(SCOPE, page, next([rec(1), rec(2, { kept: false, rerolledBy: "msgNEW" })]));
  assert.deepEqual(Object.keys(changed), [`flags.${SCOPE}.data.rows.${rec(2).id}`]);
  const removed = flagsUpdate(SCOPE, page, next([rec(2)]));
  assert.deepEqual(removed, { [`flags.${SCOPE}.data.rows.-=${rec(1).id}`]: null });
  const relabelled = flagsUpdate(SCOPE, page, next([rec(1), rec(2)], { label: "Night one", excluded: true }));
  assert.deepEqual(relabelled, { [`flags.${SCOPE}.meta.label`]: "Night one", [`flags.${SCOPE}.meta.excluded`]: true });
});

test("a v1 page (rows as an array) is rewritten once, in full, on its next write", () => {
  const records = [rec(1), rec(2)];
  const v1 = { v: 1, key: "2026-09-15", meta: {}, data: { v: 1, fields: FIELDS, rows: records.map((r) => FIELDS.map((f) => r[f] ?? null)) } };
  const update = flagsUpdate(SCOPE, v1, { v: 1, key: "2026-09-15", meta: {}, data: encode([...records, rec(3)]) });
  const keys = Object.keys(update);
  assert.deepEqual(keys.filter((k) => k.includes(".rows.")).sort(), records.concat(rec(3)).map((r) => `flags.${SCOPE}.data.rows.${r.id}`).sort(), "every row travels once");
  assert.equal(update[`flags.${SCOPE}.data.v`], CODEC_VERSION);
  assert.ok(!keys.some((k) => k.includes("-=")), "an array holds no keys to delete");
  assert.deepEqual(flagsUpdate(SCOPE, undefined, { v: 1, key: "2026-09-15", meta: {}, data: encode(records) })[`flags.${SCOPE}.key`], "2026-09-15", "a page without our flags gets them all");
});

test("meta keys that went away are deleted by name (pages merge meta key by key)", () => {
  const cur = { label: "x", manual: { startedTs: 1, endedTs: null } };
  assert.deepEqual(metaUpdate(SCOPE, cur, { label: "x", manual: undefined }), { [`flags.${SCOPE}.meta.-=manual`]: null });
  assert.deepEqual(metaUpdate(SCOPE, cur, { label: "x", manual: { startedTs: 1, endedTs: 9 } }), { [`flags.${SCOPE}.meta.manual`]: { startedTs: 1, endedTs: 9 } });
  assert.deepEqual(metaUpdate(SCOPE, undefined, {}), {});
});
