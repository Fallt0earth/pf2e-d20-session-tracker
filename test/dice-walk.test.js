import { test } from "node:test";
import assert from "node:assert/strict";
import { d20sOfMessage, d20sOfRoll, parseRoll, messageHasD20 } from "../scripts/capture/dice-walk.js";

const die = (faces, results, extra = {}) => ({ class: "Die", faces, number: results.length, modifiers: [], results, ...extra });
const roll = (terms, total, formula = "") => ({ class: "Roll", formula, total, terms });

test("single 1d20 with a modifier", () => {
  const r = roll([die(20, [{ result: 17, active: true }]), { class: "OperatorTerm", operator: "+" }, { class: "NumericTerm", number: 5 }], 22, "1d20 + 5");
  const out = d20sOfMessage([JSON.stringify(r)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].natural, 17);
  assert.equal(out[0].kept, true);
  assert.equal(out[0].formula, "1d20");
  assert.equal(out[0].total, 22);
  assert.equal(out[0].dieIndex, 0);
});

test("2d20kh keeps one, discards one; both are physical dice", () => {
  const r = roll([die(20, [{ result: 5, active: false, discarded: true }, { result: 17, active: true }], { modifiers: ["kh"] })], 17, "2d20kh");
  const out = d20sOfRoll(r);
  assert.deepEqual(out.map((d) => [d.natural, d.kept, d.formula]), [[5, false, "2d20kh"], [17, true, "2d20kh"]]);
});

test("non-d20 dice are ignored; damage-style rolls yield nothing", () => {
  const r = roll([die(6, [{ result: 3, active: true }, { result: 5, active: true }])], 8, "2d6");
  assert.deepEqual(d20sOfRoll(r), []);
  assert.equal(messageHasD20([JSON.stringify(r)]), false);
});

test("pool and parenthetical terms are walked; dieIndex runs across the message", () => {
  const pool = { class: "PoolTerm", rolls: [roll([die(20, [{ result: 3, active: true }])], 3), roll([die(20, [{ result: 19, active: true }])], 19)] };
  const paren = { class: "ParentheticalTerm", roll: roll([die(20, [{ result: 11, active: true }])], 11) };
  const out = d20sOfMessage([roll([pool], 22), roll([paren], 11)]);
  assert.deepEqual(out.map((d) => [d.rollIndex, d.natural, d.dieIndex]), [[0, 3, 0], [0, 19, 1], [1, 11, 2]]);
});

test("rerolled results (r modifier) count as physical dice but not kept", () => {
  const r = roll([die(20, [{ result: 1, active: false, rerolled: true }, { result: 14, active: true }], { modifiers: ["r1"] })], 14, "1d20r1");
  assert.deepEqual(d20sOfRoll(r).map((d) => [d.natural, d.kept]), [[1, false], [14, true]]);
});

test("malformed entries are skipped, objects are accepted as-is", () => {
  assert.equal(parseRoll("{not json"), null);
  const r = roll([die(20, [{ result: 20, active: true }])], 20);
  assert.equal(d20sOfMessage(["{oops", r, 42]).length, 1);
});
