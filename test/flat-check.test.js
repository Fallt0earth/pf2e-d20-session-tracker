// pf2-flat-check extractor against the cards captured in spike S6 (visible and hidden value).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { messageToRollRecords, classifyMessage } from "../scripts/capture/normalize.js";
import { parseFlatCheckContent, matches } from "../scripts/capture/extractors/flat-check.js";

const DIR = new URL("./fixtures/devworld/spikes/", import.meta.url);
const have = existsSync(new URL("s6.json", DIR));
const s6 = have ? JSON.parse(readFileSync(new URL("s6.json", DIR), "utf8")) : null;
const hidden = existsSync(new URL("s6-hidden.json", DIR)) ? JSON.parse(readFileSync(new URL("s6-hidden.json", DIR), "utf8")) : [];
const ctx = { sessionKeyFor: () => "2026-09-15", event: "backfill", captureRawRolls: true };

test("flat-check parser on the literal V3.2.0 card markup", () => {
  const html = '<div>\n    \n    <b>Test Rogue</b> is <b>Concealed</b> to attacker.<br />\n    Flat Check DC is <b>5</b>.\n</div>\n<div class="dice-roll">\n<div class="dice-result flat-check-success">\n    <h4 class="dice-total flat-check">7</h4>\n</div>\n</div>';
  assert.deepEqual(parseFlatCheckContent(html), { natural: 7, dc: 5, outcome: "success" });
  const hiddenHtml = html.replace(">7<", ">Success<");
  assert.deepEqual(parseFlatCheckContent(hiddenHtml), { natural: null, dc: 5, outcome: "success" });
  assert.equal(matches({ flags: { "pf2-flat-check": {} } }), true);
  assert.equal(matches({ flags: { "pf2-flat-check": true } }), true);
  assert.equal(matches({ flags: { pf2e: {} } }), false);
});

test("S6 fixture: GM-authored card with the attacker as speaker yields one flat-check record", { skip: !have && "no s6 fixture" }, () => {
  const msgs = s6.flatMessages;
  assert.ok(msgs.length >= 1);
  for (const m of msgs) {
    assert.equal(classifyMessage(m), "flat-check");
    assert.equal(m.rolls?.length ?? 0, 0, "no rolls array on these messages");
    const [r] = messageToRollRecords(m, ctx);
    assert.equal(r.type, "flat-check");
    assert.equal(r.source, "pf2-flat-check");
    assert.ok(r.natural >= 1 && r.natural <= 20);
    assert.equal(r.dc, 5);
    assert.ok(["success", "failure"].includes(r.outcome));
    assert.equal(r.actorId, m.speaker.actor);
    assert.equal(r.userGuess, true);
  }
});

test("S6 hidden-value fixture: natural null, valueHidden, outcome kept", { skip: !hidden.length && "no s6-hidden fixture" }, () => {
  for (const m of hidden) {
    const [r] = messageToRollRecords(m, ctx);
    assert.equal(r.natural, null);
    assert.equal(r.valueHidden, true);
    assert.ok(["success", "failure"].includes(r.outcome));
  }
});
