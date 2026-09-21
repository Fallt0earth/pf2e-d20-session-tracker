// Everything in a chat message is written by a player's client. These tests pin down what the capture
// layer does with input of the wrong shape, size or origin: it bounds it, ignores it, or records it
// without letting it touch anybody else's record. Pure layer only, so they run under node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { messageToRollRecords } from "../scripts/capture/normalize.js";
import { d20sOfMessage, parseRoll } from "../scripts/capture/dice-walk.js";
import { sanitizeRecord, MAX_DICE_PER_MESSAGE, CLOCK_SKEW_MS } from "../scripts/capture/sanitize.js";
import { parseRerollDiscard } from "../scripts/capture/reroll-html.js";
import { parseFlatCheckContent } from "../scripts/capture/extractors/flat-check.js";
import { groupSummary } from "../scripts/stats/summarize.js";
import { buildSessionModel } from "../scripts/ui/view-model.js";
import { recordsToCsv } from "../scripts/storage/csv.js";
import { decode, encode, FIELDS } from "../scripts/storage/codec.js";
import { mergeRecord } from "../scripts/storage/merge.js";
import { isSessionKey } from "../scripts/sessions/bucket.js";

const MODULE = "pf2e-d20-session-tracker";
const T0 = 1_789_500_000_000;
const PLAYER_A = "playerAAAAAAAAAA", PLAYER_B = "playerBBBBBBBBBB", GM = "gmUserGGGGGGGGGG";
const MSG_NEW = "newMsg0000000001", MSG_OLD = "oldMsg0000000001";

const d20Roll = (results, extra = {}) => ({ class: "CheckRoll", formula: "1d20 + 5", total: results[0] + 5, terms: [{ class: "Die", number: results.length, faces: 20, modifiers: [], results: results.map((result) => ({ result, active: true })) }], ...extra });
const rawMsg = (rolls, extra = {}) => ({ _id: MSG_NEW, timestamp: T0, author: PLAYER_A, speaker: { actor: null, token: null, alias: "Alice" }, blind: false, whisper: [], rolls, flags: {}, content: "", ...extra });
const checkMsg = (natural, context = {}, extra = {}) => rawMsg([JSON.stringify(d20Roll([natural]))], { flags: { pf2e: { context: { type: "skill-check", domains: ["athletics", "skill-check"], ...context } } }, ...extra });
const ctx = (extra = {}) => ({ sessionKeyFor: () => "2026-09-15", event: "create", captureRawRolls: true, ...extra });

// ---- dice and sizes ---------------------------------------------------------------------------------

test("a d20 result outside 1–20 is not a die", () => {
  const roll = d20Roll([20]);
  roll.terms[0].results = [{ result: 500, active: true }, { result: 0, active: true }, { result: -3, active: true }, { result: 7.5, active: true }, { result: 12, active: true }];
  assert.deepEqual(d20sOfMessage([roll]).map((d) => d.natural), [12]);
});

test("dice per message are capped, however many the roll holds", () => {
  const many = d20Roll(Array.from({ length: 900 }, (_, i) => (i % 20) + 1));
  assert.equal(d20sOfMessage([many]).length, MAX_DICE_PER_MESSAGE);
  assert.equal(messageToRollRecords(rawMsg([many, many]), ctx()).length, MAX_DICE_PER_MESSAGE);
});

test("deeply nested terms and oversized roll JSON are bounded, not followed", () => {
  let nested = { class: "Die", faces: 20, results: [{ result: 9, active: true }] };
  for (let i = 0; i < 5000; i++) nested = { class: "ParentheticalTerm", roll: { terms: [nested] } };
  assert.deepEqual(d20sOfMessage([{ terms: [nested] }]), []);
  assert.equal(parseRoll(`{"terms":[],"pad":"${"x".repeat(300_000)}"}`), null);
  assert.equal(parseRoll("42"), null);
});

test("an extractor that throws loses its own message only", () => {
  const warnings = [];
  const tb = { targetHelper: { targets: [], saveVariants: { null: { dc: 17, saves: { [TOKEN]: { die: 11, value: 15 } } } } } };
  const m = rawMsg([JSON.stringify(d20Roll([11]))], { flags: { "pf2e-toolbelt": tb } });
  const recs = messageToRollRecords(m, ctx({ existing: () => { throw new Error("boom"); }, warn: (t) => warnings.push(t) }));
  assert.deepEqual(recs.map((r) => r.source), ["raw"], "the raw die is still recorded");
  assert.equal(warnings.length, 1);
});

test("records are coerced to the stored shape", () => {
  const long = "A".repeat(5000);
  const [r] = messageToRollRecords(checkMsg(13, { identifier: "__proto__", outcome: "<b>win</b>", rollMode: long, action: long, dc: { value: "1e9" } }, { speaker: { alias: long } }), ctx());
  assert.equal(r.alias.length, 80);
  assert.equal(r.ident, null);
  assert.equal(r.outcome, null);
  assert.equal(r.mode, null);
  assert.equal(r.action, null);
  assert.equal(r.dc, null);
  assert.equal(r.stat, "athletics");
  assert.equal(sanitizeRecord({ ...r, natural: 21 }), null);
  assert.equal(sanitizeRecord({ ...r, id: "someoneElse00001:r0:t0:d0" }), null, "an id must start with its own message id");
  const [save] = messageToRollRecords(checkMsg(13, { type: "saving-throw", domains: [], identifier: "Not A Slug" }), ctx());
  assert.equal(save.stat, null);
});

// ---- time -------------------------------------------------------------------------------------------

test("a player's live roll with a far-off timestamp is filed under the writer's clock; a GM's is kept", () => {
  const now = T0 + 40 * 24 * 3_600_000;
  const env = { now: () => now, isGM: (id) => id === GM };
  const [live] = messageToRollRecords(checkMsg(9), ctx(env));
  assert.equal(live.ts, now);
  const [near] = messageToRollRecords(checkMsg(9, {}, { timestamp: now - CLOCK_SKEW_MS + 1000 }), ctx(env));
  assert.equal(near.ts, now - CLOCK_SKEW_MS + 1000);
  const [gm] = messageToRollRecords(checkMsg(9, {}, { author: GM }), ctx(env));
  assert.equal(gm.ts, T0);
  const [old] = messageToRollRecords(checkMsg(9), ctx({ ...env, event: "backfill" }));
  assert.equal(old.ts, T0, "catch-up keeps past timestamps");
});

test("nothing is ever filed in the future", () => {
  const now = T0;
  for (const event of ["create", "backfill"]) {
    for (const author of [PLAYER_A, GM]) {
      const [r] = messageToRollRecords(checkMsg(9, {}, { author, timestamp: now + 5 * 365 * 86_400_000 }), ctx({ event, now: () => now, isGM: (id) => id === GM }));
      assert.equal(r.ts, now, `${event} by ${author}`);
    }
  }
  assert.deepEqual(messageToRollRecords(checkMsg(9, {}, { timestamp: "soon" }), ctx()), []);
});

// ---- reroll annotations -----------------------------------------------------------------------------

const rerollMsg = (shownNatural, annotation, extra = {}) => checkMsg(shownNatural, { isReroll: true }, {
  flags: { pf2e: { context: { type: "skill-check", domains: ["athletics", "skill-check"], isReroll: true } }, [MODULE]: { reroll: annotation } },
  content: `<div class="reroll-discard"><ul><li class="roll die d20">4</li></ul><h4 class="dice-total">9</h4></div><div class="reroll-second">…</div>`,
  ...extra,
});
const annotation = (extra = {}) => ({ oldMessageId: MSG_OLD, oldNaturals: [4], newNaturals: [17], oldTotal: 9, newTotal: 22, keep: "new", resource: "heroPoint", ...extra });
const storedOriginal = (userId, extra = {}) => ({ id: `${MSG_OLD}:r0:t0:d0`, msgId: MSG_OLD, sessionKey: "2026-09-15", dieIndex: 0, ts: T0 - 60_000, userId, actorId: null, tokenId: null, alias: "Bob", natural: 4, kept: true, formula: "1d20", total: 9, type: "skill-check", source: "pf2e-check", domains: [], stat: "athletics", ident: null, action: null, dc: null, dcVisible: null, outcome: "failure", unadjustedOutcome: null, isReroll: false, rollTwice: null, mode: null, blind: false, whispered: false, inCombat: false, ...extra });

test("a well-formed annotation yields the new die and the original die, exactly attributed", () => {
  const recs = messageToRollRecords(rerollMsg(17, annotation()), ctx());
  assert.deepEqual(recs.map((r) => [r.id, r.natural, r.kept, r.source]), [
    [`${MSG_NEW}:r0:t0:d0`, 17, true, "reroll-enrich"],
    [`${MSG_OLD}:r0:t0:d0`, 4, false, "reroll-enrich"],
  ]);
  assert.equal(recs[1].userId, PLAYER_A);
  assert.equal(recs[1].rerolledBy, MSG_NEW);
});

test("an annotation never reaches another user's stored roll", () => {
  const stored = storedOriginal(PLAYER_B);
  const recs = messageToRollRecords(rerollMsg(17, annotation({ oldNaturals: [1] })), ctx({ find: (id) => (id === stored.id ? stored : null), isGM: () => false }));
  assert.deepEqual(recs.map((r) => r.id), [`${MSG_NEW}:r0:t0:d0`], "only the roller's own new die is recorded");
});

test("a message by someone else that still exists under the old id is left alone", () => {
  const recs = messageToRollRecords(rerollMsg(17, annotation()), ctx({ find: () => null, isGM: () => false, messageAuthor: (id) => (id === MSG_OLD ? PLAYER_B : null) }));
  assert.deepEqual(recs.map((r) => r.id), [`${MSG_NEW}:r0:t0:d0`]);
});

test("the roller's own stored original only gets its reroll link; die, roller and time stay", () => {
  const stored = storedOriginal(PLAYER_A);
  const recs = messageToRollRecords(rerollMsg(17, annotation({ oldNaturals: [1], oldTotal: 6 })), ctx({ find: (id) => (id === stored.id ? stored : null), isGM: () => false }));
  const original = recs.find((r) => r.id === stored.id);
  assert.ok(original);
  assert.equal(original.natural, 4, "the stored die wins over the annotation");
  assert.equal(original.ts, stored.ts);
  assert.equal(original.userId, PLAYER_A);
  assert.equal(original.total, 9);
  assert.equal(original.kept, false);
  assert.equal(original.rerolledBy, MSG_NEW);
  assert.equal(original.rerollOutcome, "discarded");
});

test("a GM may reroll a player's check: the player's record gets the link and keeps its roller", () => {
  const stored = storedOriginal(PLAYER_B);
  const recs = messageToRollRecords(rerollMsg(17, annotation(), { author: GM }), ctx({ find: (id) => (id === stored.id ? stored : null), isGM: (id) => id === GM }));
  const original = recs.find((r) => r.id === stored.id);
  assert.equal(original.userId, PLAYER_B);
  assert.equal(original.kept, false);
});

test("an annotation that is malformed or contradicts its message is ignored: the HTML fallback runs", () => {
  const bad = [
    annotation({ oldMessageId: "../../etc" }),
    annotation({ oldMessageId: MSG_NEW }),
    annotation({ oldMessageId: `${MSG_OLD}:r0` }),
    annotation({ newNaturals: [3] }),            // the message shows 17
    annotation({ oldNaturals: [400] }),
    annotation({ oldNaturals: "4" }),
    "not an object",
  ];
  for (const a of bad) {
    const recs = messageToRollRecords(rerollMsg(17, a), ctx());
    assert.deepEqual(recs.map((r) => [r.id, r.natural, r.source]), [
      [`${MSG_NEW}:r0:t0:d0`, 17, "pf2e-check"],
      [`${MSG_NEW}:html:0`, 4, "reroll-html"],
    ], JSON.stringify(a));
  }
});

// ---- Toolbelt saves ---------------------------------------------------------------------------------

const TOKEN = "tokenAAAAAAAAAAA";
const cardMsg = (saves, extra = {}) => rawMsg([], { _id: "dmgMSG0000000001", flags: { pf2e: { context: { type: "damage-roll" } }, "pf2e-toolbelt": { targetHelper: { type: "damage", targets: [`Scene.sceneAAAAAAAAAAA.Token.${TOKEN}`], saveVariants: { null: { dc: 17, statistic: "reflex", saves } } } } }, ...extra });
const saveBy = (rollerId, die = 12) => ({ die, value: die + 3, success: "failure", statistic: "reflex", roll: JSON.stringify(d20Roll([die], { options: { rollerId } })) });
const tbCtx = (extra = {}) => ctx({ event: "update", updaterUserId: PLAYER_A, resolveToken: () => ({ actorId: "actorBBBBBBBBBBB", alias: "Bob's Rogue", rollers: [PLAYER_B, GM] }), ...extra });

test("a save is credited to rollerId only when that user could have rolled for the token", () => {
  const [own] = messageToRollRecords(cardMsg({ [TOKEN]: saveBy(PLAYER_B) }), tbCtx());
  assert.equal(own.userId, PLAYER_B);
  assert.equal(own.userGuess, undefined);
  const [other] = messageToRollRecords(cardMsg({ [TOKEN]: saveBy("playerCCCCCCCCCC") }), tbCtx());
  assert.equal(other.userId, PLAYER_A, "falls back to whoever made the update");
  assert.equal(other.userGuess, true);
  const [junk] = messageToRollRecords(cardMsg({ [TOKEN]: saveBy("constructor") }), tbCtx());
  assert.equal(junk.userId, PLAYER_A);
});

test("save keys that are not token ids, impossible dice and endless re-rolls are not recorded", () => {
  assert.deepEqual(messageToRollRecords(cardMsg({ "__proto__": saveBy(PLAYER_B), "a:b:c": saveBy(PLAYER_B), constructor: saveBy(PLAYER_B) }), tbCtx()), []);
  assert.deepEqual(messageToRollRecords(cardMsg({ [TOKEN]: saveBy(PLAYER_B, 77) }), tbCtx()), []);
  const prev = (seq) => ({ id: `dmgMSG0000000001:tb:null:${TOKEN}:${seq}`, natural: 2, total: 5 });
  assert.equal(messageToRollRecords(cardMsg({ [TOKEN]: saveBy(PLAYER_B) }), tbCtx({ existing: () => prev(1) }))[0].id.endsWith(":2"), true);
  assert.deepEqual(messageToRollRecords(cardMsg({ [TOKEN]: saveBy(PLAYER_B) }), tbCtx({ existing: () => prev(4) })), []);
  const crowd = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`tok${String(i).padStart(13, "0")}`, saveBy(PLAYER_B)]));
  assert.ok(messageToRollRecords(cardMsg(crowd), tbCtx()).length <= MAX_DICE_PER_MESSAGE);
});

// ---- HTML parsing stays cheap -----------------------------------------------------------------------

test("card parsers stay fast on large, unclosed or repetitive content", () => {
  const samples = [
    `<div class="reroll-discard">` + `<li class="roll die d20 `.repeat(60_000),
    `<div class="reroll-discard">` + `<div `.repeat(80_000),
    `<h4 class="` + `dice-total `.repeat(60_000),
    `DC` + " ".repeat(200_000) + "5",
    `Flat Check DC is ` + `<b>`.repeat(50_000),
  ];
  for (const s of samples) {
    const t = performance.now();
    parseRerollDiscard(s);
    parseFlatCheckContent(s);
    assert.ok(performance.now() - t < 500, `${s.slice(0, 30)}… took ${Math.round(performance.now() - t)} ms`);
  }
  assert.deepEqual(parseFlatCheckContent(`<div>Flat Check DC is <b>5</b>.</div><div class="dice-roll"><div class="dice-result flat-check-success"><h4 class="dice-total flat-check">7</h4></div></div>`), { natural: 7, dc: 5, outcome: "success" });
});

// ---- aggregation and export -------------------------------------------------------------------------

test("names that collide with Object members stay plain data in the summaries", () => {
  const base = storedOriginal(PLAYER_A);
  const recs = ["constructor", "__proto__", "toString", "hasOwnProperty"].map((name, i) => ({ ...base, id: `m${i}:r0:t0:d0`, msgId: `m${i}`, natural: 10 + i, stat: name, type: name, userId: name, actorId: name }));
  const g = groupSummary(recs, { mc: false });
  assert.deepEqual(Object.keys(g.byStat).sort(), ["__proto__", "constructor", "hasOwnProperty", "toString"]);
  assert.equal(g.byStat.constructor.n, 1);
  const model = buildSessionModel(recs, { viewer: { isGM: true, userId: GM }, labels: { users: {}, actors: {} } });
  assert.equal(model.rows.length, 4);
  assert.deepEqual(model.rows.map((r) => r.label).sort(), ["__proto__", "constructor", "hasOwnProperty", "toString"]);
  assert.equal(model.party.byType.constructor, 1);
  assert.equal(/** @type {any} */ ({}).n, undefined);
  assert.equal(/** @type {any} */ (Object).n, undefined);
  assert.equal(typeof {}.toString, "function");
});

test("CSV text cells that a spreadsheet would run as a formula open as text; numbers are untouched", () => {
  const base = storedOriginal(PLAYER_A);
  const csv = recordsToCsv([{ ...base, alias: "=HYPERLINK(\"x\")", total: -3 }, { ...base, id: `${MSG_NEW}:r0:t0:d0`, msgId: MSG_NEW, alias: "@cmd", userId: "constructor" }], { users: { [PLAYER_A]: "+Alice" }, actors: {} });
  const lines = csv.trim().split("\r\n");
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`), lines[1]);
  assert.ok(lines[1].includes(",'+Alice,"), lines[1]);
  assert.ok(lines[1].includes(",-3,"), lines[1]);
  assert.ok(lines[2].includes(",'@cmd,"), lines[2]);
  assert.ok(lines[2].includes(",constructor,"), "an id is never looked up on the prototype");
});

test("a stored page header only names stored fields", () => {
  const packed = encode([storedOriginal(PLAYER_A)]);
  const tampered = { ...packed, fields: [...FIELDS, "__proto__", "sessionKey"], rows: packed.rows.map((row) => [...row, { polluted: true }, "1999-01-01"]) };
  const [r] = decode(tampered, "2026-09-15");
  assert.equal(r.sessionKey, "2026-09-15");
  assert.equal(/** @type {any} */ (r).polluted, undefined);
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.deepEqual(decode({ rows: ["not a row", null] }, "2026-09-15").length, 2);
});

test("a stored record's die, time and certain roller are settled; a guess may become certain", () => {
  const stored = storedOriginal(PLAYER_B);
  const merged = mergeRecord(stored, { ...stored, natural: 1, userId: PLAYER_A, ts: 1, sessionKey: "1999-01-01", kept: false, rerolledBy: MSG_NEW });
  assert.deepEqual([merged.natural, merged.userId, merged.ts, merged.sessionKey], [4, PLAYER_B, stored.ts, "2026-09-15"]);
  assert.deepEqual([merged.kept, merged.rerolledBy], [false, MSG_NEW]);
  const guessed = mergeRecord({ ...stored, userGuess: true }, { ...stored, userId: PLAYER_A, userGuess: undefined });
  assert.equal(guessed.userId, PLAYER_A);
  const hidden = mergeRecord({ ...stored, natural: null }, { ...stored, natural: 11 });
  assert.equal(hidden.natural, 11, "a die that was unknown may be filled in");
});

test("session keys have one shape", () => {
  for (const ok of ["2026-09-15", "2026-09-19~2", "unscheduled"]) assert.equal(isSessionKey(ok), true, ok);
  for (const bad of ["", null, undefined, 20260915, "2026-09-15~", "2026-09-15~1234", "2026-9-5", "x\" onclick=\"y", "<img>", "__proto__", " 2026-09-15"]) assert.equal(isSessionKey(bad), false, String(bad));
});
