// Normalizer tests against real messages dumped from the dev world (dev/e2e/make-fixtures.mjs).
// Skips when the fixture files are absent so a fresh clone still runs the pure tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { messageToRollRecords, classifyMessage } from "../scripts/capture/normalize.js";
import { sessionKeyFor } from "../scripts/sessions/bucket.js";
import { parseRerollDiscard } from "../scripts/capture/reroll-html.js";
import { keptNewRoll } from "../scripts/capture/extractors/pf2e-check.js";

const DIR = new URL("./fixtures/devworld/", import.meta.url);
const have = existsSync(new URL("messages.json", DIR)) && existsSync(new URL("meta.json", DIR));
const messages = have ? JSON.parse(readFileSync(new URL("messages.json", DIR), "utf8")) : [];
const meta = have ? JSON.parse(readFileSync(new URL("meta.json", DIR), "utf8")) : {};
const ctx = { sessionKeyFor: (ts) => sessionKeyFor(ts), event: "backfill", captureRawRolls: true };
const byId = new Map(messages.map((m) => [m._id, m]));
const recordsOf = (m) => messageToRollRecords(m, ctx);
const ctxType = (m) => m.flags?.pf2e?.context?.type;

test("fixture corpus present", { skip: !have && "no devworld fixtures (run node dev/e2e/make-fixtures.mjs)" }, () => {
  assert.ok(messages.length > 10, `only ${messages.length} messages`);
});

test("every PF2e check with a d20 yields records with sane fields", { skip: !have }, () => {
  const checks = messages.filter((m) => typeof ctxType(m) === "string" && ctxType(m) !== "damage-roll" && !m.flags.pf2e.context.isReroll);
  assert.ok(checks.length >= 8, `only ${checks.length} check messages`);
  for (const m of checks) {
    const recs = recordsOf(m);
    assert.ok(recs.length >= 1, `no records for ${ctxType(m)} ${m._id}`);
    for (const r of recs) {
      assert.equal(r.msgId, m._id);
      assert.equal(r.type, ctxType(m));
      assert.equal(r.source, "pf2e-check");
      assert.ok(Number.isInteger(r.natural) && r.natural >= 1 && r.natural <= 20, `natural ${r.natural}`);
      assert.equal(typeof r.userId, "string");
      assert.equal(r.actorId, m.speaker?.actor ?? null);
      assert.match(r.sessionKey, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Array.isArray(r.domains));
      assert.equal(r.blind, m.blind === true);
      assert.equal(r.whispered, (m.whisper ?? []).length > 0);
      assert.match(r.id, /^[A-Za-z0-9]+:r\d+:t\d+:d\d+$/);
    }
  }
});

test("saving throw with a DC records dc and outcome", { skip: !have }, () => {
  const m = messages.find((x) => ctxType(x) === "saving-throw" && x.flags.pf2e.context.dc?.value);
  assert.ok(m, "no saving throw with DC in fixtures");
  const [r] = recordsOf(m);
  assert.equal(r.dc, m.flags.pf2e.context.dc.value);
  assert.ok(["criticalSuccess", "success", "failure", "criticalFailure"].includes(r.outcome), `outcome ${r.outcome}`);
  assert.ok(r.domains.includes("saving-throw"));
});

test("fortune and misfortune: two physical dice, exactly one kept, formula tagged", { skip: !have }, () => {
  const twice = messages.filter((m) => ["keep-higher", "keep-lower"].includes(m.flags?.pf2e?.context?.rollTwice));
  assert.ok(twice.length >= 2, `only ${twice.length} rollTwice messages`);
  for (const m of twice) {
    const recs = recordsOf(m);
    assert.equal(recs.length, 2, `expected 2 dice for ${m.flags.pf2e.context.rollTwice}`);
    assert.equal(recs.filter((r) => r.kept).length, 1);
    const kh = m.flags.pf2e.context.rollTwice === "keep-higher";
    assert.equal(recs[0].formula, kh ? "2d20kh" : "2d20kl");
    const kept = recs.find((r) => r.kept), dropped = recs.find((r) => !r.kept);
    assert.ok(kh ? kept.natural >= dropped.natural : kept.natural <= dropped.natural, "kept die must respect kh/kl");
    assert.equal(recs[0].rollTwice, m.flags.pf2e.context.rollTwice);
  }
});

test("damage rolls yield nothing; raw d20 rolls are typed raw; non-d20 raw rolls yield nothing", { skip: !have }, () => {
  const damage = messages.filter((m) => ctxType(m) === "damage-roll");
  assert.ok(damage.length >= 1, "no damage message in fixtures");
  for (const m of damage) assert.deepEqual(recordsOf(m), []);
  const raws = messages.filter((m) => !ctxType(m) && !m.flags?.["pf2-flat-check"] && (m.rolls ?? []).length);
  const rawRecs = raws.flatMap(recordsOf);
  assert.ok(rawRecs.length >= 2, `only ${rawRecs.length} raw d20 records`);
  for (const r of rawRecs) { assert.equal(r.source, "raw"); assert.ok(["raw", "initiative"].includes(r.type)); }
  const noD20 = raws.filter((m) => recordsOf(m).length === 0);
  assert.ok(noD20.length >= 1, "expected the 2d6 raw roll to yield nothing");
  // captureRawRolls=false drops them
  assert.deepEqual(raws.flatMap((m) => messageToRollRecords(m, { ...ctx, captureRawRolls: false })), []);
});

test("blind and GM rolls carry the visibility flags", { skip: !have }, () => {
  const blind = messages.filter((m) => m.blind === true && ctxType(m));
  assert.ok(blind.length >= 1, "no blind check in fixtures");
  for (const r of blind.flatMap(recordsOf)) assert.equal(r.blind, true);
  const gmroll = messages.filter((m) => !m.blind && (m.whisper ?? []).length && ctxType(m));
  assert.ok(gmroll.length >= 1, "no gmroll check in fixtures");
  for (const r of gmroll.flatMap(recordsOf)) assert.equal(r.whispered, true);
});

test("hero-point rerolls without enrichment: kept die from rolls, discarded die from HTML, ground truth from the hook", { skip: !have }, () => {
  const rerolls = messages.filter((m) => m.flags?.pf2e?.context?.isReroll);
  assert.ok(rerolls.length >= 3, `only ${rerolls.length} reroll messages`);
  const truth = [...(meta.gm?.hook ?? []), ...(meta.player?.hook ?? [])];
  const plans = [...(meta.gm?.rerolls ?? []), ...(meta.player?.rerolls ?? [])];
  for (const m of rerolls) {
    const recs = recordsOf(m);
    assert.equal(recs.length, 2, `reroll ${m._id} should yield 2 physical dice, got ${recs.length}`);
    const kept = recs.filter((r) => r.kept), discarded = recs.filter((r) => !r.kept);
    assert.equal(kept.length, 1);
    assert.equal(discarded.length, 1);
    assert.equal(discarded[0].source, "reroll-html");
    assert.ok(recs.every((r) => r.isReroll));
    const parsed = parseRerollDiscard(m.content);
    assert.ok(parsed.found, "reroll-discard block not found in content");
    assert.ok(Number.isInteger(discarded[0].natural), "discarded natural not parsed from HTML");
    // Cross-check with what the rolling client saw in the pf2e.reroll hook.
    const plan = plans.find((p) => p.newMessageId === m._id);
    if (plan) {
      const t = truth.find((h) => h.keep === plan.keep && (h.old[0] === plan.originalNatural));
      assert.ok(t, `no hook record for ${m._id}`);
      const keptNew = keptNewRoll(t.keep, t.oldTotal, t.newTotal);
      const expectedKept = keptNew ? t.new[0] : t.old[0];
      const expectedDiscard = keptNew ? t.old[0] : t.new[0];
      assert.equal(kept[0].natural, expectedKept, `kept natural for keep=${t.keep}`);
      assert.equal(discarded[0].natural, expectedDiscard, `discarded natural for keep=${t.keep}`);
      assert.ok(!byId.has(plan.originalId), "original message must have been deleted by PF2e");
    }
  }
});

test("attack rolls, initiative and PF2e flat checks are typed from the context", { skip: !have }, () => {
  const attacks = messages.filter((m) => ctxType(m) === "attack-roll");
  assert.ok(attacks.length >= 2, `only ${attacks.length} attack rolls`);
  for (const r of attacks.flatMap(recordsOf)) {
    assert.equal(r.type, "attack-roll");
    assert.ok(r.domains.includes("attack-roll") || r.domains.includes("strike-attack-roll"), `domains ${r.domains}`);
  }
  const init = messages.filter((m) => ctxType(m) === "initiative");
  assert.ok(init.length >= 1, "no initiative roll");
  for (const r of init.flatMap(recordsOf)) assert.equal(r.type, "initiative");
  const flat = messages.filter((m) => ctxType(m) === "flat-check");
  assert.ok(flat.length >= 1, "no PF2e flat check");
  for (const r of flat.flatMap(recordsOf)) { assert.equal(r.type, "flat-check"); assert.equal(r.dc, 5); }
});

test("corpus totals: one record per physical die, sources and types as expected", { skip: !have }, () => {
  const all = messages.flatMap(recordsOf);
  const bySource = {}, byType = {};
  for (const r of all) { bySource[r.source] = (bySource[r.source] ?? 0) + 1; byType[r.type] = (byType[r.type] ?? 0) + 1; }
  assert.ok(bySource["pf2e-check"] >= 40, JSON.stringify(bySource));
  assert.ok(bySource["reroll-html"] >= 4, JSON.stringify(bySource));
  assert.ok(bySource.raw >= 3, JSON.stringify(bySource));
  assert.equal(byType["damage-roll"], undefined);
  for (const k of ["skill-check", "saving-throw", "perception-check", "attack-roll", "initiative", "flat-check", "raw"]) assert.ok(byType[k] >= 1, `missing type ${k}`);
});

test("classifyMessage covers every d20-bearing message in the corpus", { skip: !have }, () => {
  const unknown = messages.filter((m) => classifyMessage(m) === null && (m.rolls ?? []).some((r) => /d20/.test(typeof r === "string" ? r : r.formula ?? "")));
  assert.deepEqual(unknown.map((m) => m._id), []);
});

test("normalizer is deterministic and idempotent on the corpus", { skip: !have }, () => {
  const a = messages.flatMap(recordsOf);
  const b = messages.flatMap(recordsOf);
  assert.deepEqual(a, b);
  const ids = a.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "record ids must be unique");
});
