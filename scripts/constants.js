// @ts-check
// Shared constants. Pure: no Foundry globals (used by node tests and the analyzer macro).

export const MODULE_ID = "pf2e-d20-session-tracker";
export const MODULE_TITLE = "PF2e d20 Session Tracker";

/** Version of the persisted record/page schema (docs/PLAN.md §4.3). */
export const SCHEMA_VERSION = 1;

/** Fair d20 reference values (docs/SCOPE.md §4.3): mean 10.5, variance (20² − 1) / 12. */
export const D20 = Object.freeze({
  faces: 20,
  mean: 10.5,
  variance: 33.25,
  sd: Math.sqrt(33.25),
});

/** PF2e check types that carry a d20 (src/module/system/check/types.ts, verified in SCOPE §5). */
export const PF2E_CHECK_TYPES = Object.freeze([
  "attack-roll",
  "check",
  "counteract-check",
  "flat-check",
  "initiative",
  "perception-check",
  "saving-throw",
  "skill-check",
]);
