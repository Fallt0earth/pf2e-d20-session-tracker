import { test } from "node:test";
import assert from "node:assert/strict";
import { D20, MODULE_ID, PF2E_CHECK_TYPES } from "../scripts/constants.js";

test("fair d20 constants", () => {
  assert.equal(D20.mean, 10.5);
  assert.equal(D20.variance, 33.25);
  assert.ok(Math.abs(D20.sd - 5.766) < 0.001);
});

test("module id and PF2e check types", () => {
  assert.equal(MODULE_ID, "pf2e-d20-session-tracker");
  assert.ok(PF2E_CHECK_TYPES.includes("saving-throw"));
  assert.ok(!PF2E_CHECK_TYPES.includes("damage-roll"));
});
