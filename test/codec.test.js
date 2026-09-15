import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { encode, decode, encodedSize, FIELDS } from "../scripts/storage/codec.js";
import { messageToRollRecords } from "../scripts/capture/normalize.js";
import { sessionKeyFor } from "../scripts/sessions/bucket.js";

const DIR = new URL("./fixtures/devworld/", import.meta.url);
const have = existsSync(new URL("messages.json", DIR));
const messages = have ? JSON.parse(readFileSync(new URL("messages.json", DIR), "utf8")) : [];
const ctx = { sessionKeyFor: (ts) => sessionKeyFor(ts), event: "backfill", captureRawRolls: true };

test("round trip preserves every stored field and restores derived ones", { skip: !have }, () => {
  const records = messages.flatMap((m) => messageToRollRecords(m, ctx));
  assert.ok(records.length > 50);
  const packed = encode(records);
  assert.equal(packed.rows.length, records.length);
  assert.equal(packed.rows[0].length, FIELDS.length);
  const back = decode(JSON.parse(JSON.stringify(packed)), records[0].sessionKey);
  for (let i = 0; i < records.length; i++) {
    const a = records[i], b = back[i];
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
  assert.ok(packed / records.length < 300, `bytes per record ${(packed / records.length).toFixed(0)}`);
});

test("decode tolerates empty, missing and short rows", () => {
  assert.deepEqual(decode(null, "2026-09-15"), []);
  assert.deepEqual(decode({ v: 1, rows: [] }, "2026-09-15"), []);
  const [r] = decode({ v: 1, fields: ["id", "natural"], rows: [["m1:r0:t0:d0", 20]] }, "2026-09-15");
  assert.equal(r.natural, 20);
  assert.equal(r.kept, true);
  assert.equal(r.msgId, "m1");
  assert.equal(r.sessionKey, "2026-09-15");
});
