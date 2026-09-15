// Toolbelt Target Helper saves, against the flags captured in spike S5 (3.41.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { messageToRollRecords, classifyMessage } from "../scripts/capture/normalize.js";

const DIR = new URL("./fixtures/devworld/spikes/", import.meta.url);
const have = existsSync(new URL("s5-after.json", DIR));
const flags = have ? JSON.parse(readFileSync(new URL("s5-after.json", DIR), "utf8")) : null;
const msg = (extra = {}) => ({ _id: "dmgMSG0000000001", timestamp: 1_789_510_000_000, author: "casterUser", speaker: { actor: "casterActor", token: null, alias: "Test Fighter" }, blind: false, whisper: [], rolls: [], flags: { pf2e: { context: { type: "damage-roll" } }, "pf2e-toolbelt": flags }, ...extra });
const ctx = (extra = {}) => ({ sessionKeyFor: () => "2026-09-15", event: "update", updaterUserId: "updaterUser", captureRawRolls: true, resolveToken: (scene, token) => (token === "wziVXf0HEBZFqNCA" ? { actorId: "rogueActor", alias: "Test Rogue" } : null), ...extra });

test("S5 fixture: one saving-throw record per target save, attributed to the roller", { skip: !have && "no s5-after fixture" }, () => {
  const m = msg();
  assert.equal(classifyMessage(m), "toolbelt-saves");
  const recs = messageToRollRecords(m, ctx());
  assert.equal(recs.length, 1);
  const [r] = recs;
  assert.equal(r.type, "saving-throw");
  assert.equal(r.source, "toolbelt");
  assert.equal(r.natural, 14);
  assert.equal(r.total, 14);
  assert.equal(r.outcome, "failure");
  assert.equal(r.stat, "reflex");
  assert.equal(r.dc, 17);
  assert.equal(r.action, "basic-save");
  assert.equal(r.userId, "buEre60zo7McQgrE", "rollerId from the roll JSON, not the message author");
  assert.equal(r.userGuess, undefined);
  assert.equal(r.tokenId, "wziVXf0HEBZFqNCA");
  assert.equal(r.actorId, "rogueActor");
  assert.equal(r.alias, "Test Rogue");
  assert.equal(r.blind, false);
  assert.equal(r.id, "dmgMSG0000000001:tb:null:wziVXf0HEBZFqNCA:0");
  assert.ok(r.domains.includes("reflex"));
});

test("re-rolled save from the card gets a new sequence number; identical re-read keeps the id", { skip: !have }, () => {
  const m = msg();
  const [first] = messageToRollRecords(m, ctx());
  const [same] = messageToRollRecords(m, ctx({ existing: () => first }));
  assert.equal(same.id, first.id);
  assert.equal(same.isReroll, false);
  const [after] = messageToRollRecords(m, ctx({ existing: () => ({ ...first, natural: 3, total: 3 }) }));
  assert.equal(after.id, "dmgMSG0000000001:tb:null:wziVXf0HEBZFqNCA:1");
  assert.equal(after.isReroll, true);
  assert.equal(after.rerollOf, first.id);
});

test("damage message without Toolbelt saves yields nothing", () => {
  const m = msg({ flags: { pf2e: { context: { type: "damage-roll" } }, "pf2e-toolbelt": { targetHelper: { type: "damage", targets: [], saveVariants: {} } } } });
  assert.deepEqual(messageToRollRecords(m, ctx()), []);
  assert.equal(classifyMessage(m), "damage");
});
