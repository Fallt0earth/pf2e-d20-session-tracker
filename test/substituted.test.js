// SCOPE §9 item 4: a substituted check (Assurance) replaces the d20 with a constant — the CheckRoll has
// no Die term (verified in PF2e check.ts: the formula becomes the substitution value). No record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { messageToRollRecords, classifyMessage } from "../scripts/capture/normalize.js";

const ctx = { sessionKeyFor: () => "2026-09-15", event: "create", captureRawRolls: true };

test("Assurance-style substituted check yields no record and is classified as substituted", () => {
  const roll = { class: "CheckRoll", formula: "10 + 7", total: 17, options: { type: "skill-check", domains: ["athletics", "skill-check"], substitutions: [{ slug: "assurance", label: "Assurance", value: 10, selected: true }] }, terms: [{ class: "NumericTerm", number: 10 }, { class: "OperatorTerm", operator: "+" }, { class: "NumericTerm", number: 7 }] };
  const msg = { _id: "assur0000000001", timestamp: 1_789_500_000_000, author: "u1", speaker: { actor: "a1", alias: "Fighter" }, blind: false, whisper: [], rolls: [JSON.stringify(roll)], flags: { pf2e: { context: { type: "skill-check", domains: ["athletics", "skill-check"], substitutions: [{ slug: "assurance", selected: true }] } } }, content: "" };
  assert.deepEqual(messageToRollRecords(msg, ctx), []);
  assert.equal(classifyMessage(msg), "substituted-or-no-d20");
});
