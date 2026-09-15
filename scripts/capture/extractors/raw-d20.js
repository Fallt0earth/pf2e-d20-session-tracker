// @ts-check
// Extractor 2: any other message whose rolls contain a d20 (chat `/r 1d20`, Dice Tray, macros, core
// initiative without PF2e context). Damage rolls are excluded even if a d20 sneaks into their formula.
// Gated by ctx.captureRawRolls (world setting) at capture time; M0's coverage report always counts them.

import { d20sOfMessage } from "../dice-walk.js";

export const id = "raw-d20";
export const on = ["create", "backfill"];

/** @param {import("../../types.js").MessageData} msg */
export function matches(msg) {
  const type = msg.flags?.pf2e?.context?.type;
  if (typeof type === "string") return false; // any PF2e-typed message belongs to another extractor or is damage
  return d20sOfMessage(msg.rolls).length > 0;
}

/**
 * @param {import("../../types.js").MessageData} msg
 * @param {import("../../types.js").NormalizeContext} ctx
 * @param {(overrides: object) => import("../../types.js").RollRecord} base
 */
export function extract(msg, ctx, base) {
  if (ctx.captureRawRolls === false) return [];
  const type = msg.flags?.core?.initiativeRoll ? "initiative" : "raw";
  return d20sOfMessage(msg.rolls).map((d) => base({
    id: `${msg._id}:r${d.rollIndex}:t${d.termIndex}:d${d.resultIndex}`,
    dieIndex: d.dieIndex,
    natural: d.natural,
    kept: d.kept,
    formula: d.formula,
    total: d.total,
    type,
    source: "raw",
  }));
}
