// @ts-check
// Extractor 1: PF2e checks (flags.pf2e.context.type in CheckType). One record per physical d20 in the
// message's rolls. Handles fortune/misfortune (both dice, kept flag from active/discarded) and reroll
// messages (docs/PLAN.md §4.2): with the rolling client's enrichment flag the two physical dice are
// attributed exactly; without it the discarded die is recovered from the content HTML.

import { MODULE_ID, PF2E_CHECK_TYPES } from "../../constants.js";
import { d20sOfMessage } from "../dice-walk.js";
import { parseRerollDiscard } from "../reroll-html.js";

export const id = "pf2e-check";
export const on = ["create", "backfill"];

/** @param {import("../../types.js").MessageData} msg */
export function matches(msg) {
  const type = msg.flags?.pf2e?.context?.type;
  // A substituted roll (Assurance) has no Die term: the normalizer's classifier then reports it as such.
  return typeof type === "string" && PF2E_CHECK_TYPES.includes(type) && d20sOfMessage(msg.rolls).length > 0;
}

/**
 * @param {import("../../types.js").MessageData} msg
 * @param {import("../../types.js").NormalizeContext} ctx
 * @param {(overrides: object) => import("../../types.js").RollRecord} base
 * @returns {import("../../types.js").RollRecord[]}
 */
export function extract(msg, ctx, base) {
  const context = msg.flags?.pf2e?.context ?? {};
  const dice = d20sOfMessage(msg.rolls);
  if (!dice.length) return []; // substituted roll (Assurance): no d20 term
  const domains = Array.isArray(context.domains) ? [...context.domains] : [];
  const common = {
    type: context.type,
    source: "pf2e-check",
    domains,
    stat: deriveStat(context.type, context.identifier ?? null, domains),
    ident: context.identifier ?? null,
    action: context.action ?? null,
    dc: numberOrNull(context.dc?.value),
    dcVisible: typeof context.dc?.visible === "boolean" ? context.dc.visible : null,
    outcome: context.outcome ?? null,
    unadjustedOutcome: context.unadjustedOutcome ?? null,
    isReroll: context.isReroll === true,
    rollTwice: typeof context.rollTwice === "string" ? context.rollTwice : null,
    mode: context.messageMode ?? context.rollMode ?? null,
  };

  const records = dice.map((d) => base({
    ...common,
    id: `${msg._id}:r${d.rollIndex}:t${d.termIndex}:d${d.resultIndex}`,
    dieIndex: d.dieIndex,
    natural: d.natural,
    kept: d.kept,
    formula: d.formula,
    total: d.total,
  }));

  if (common.isReroll) return withRerollDice(msg, records, common, base);
  return records;
}

/**
 * A reroll message carries the kept roll in `rolls`. Add the other physical die:
 *  - enriched (flags[MODULE_ID].reroll from the rolling client): emit/refresh the ORIGINAL message's die
 *    record under the original id and make the message's own record the NEW die, exactly attributed;
 *  - otherwise: recover the discarded natural from the `.reroll-discard` HTML as an extra record.
 */
function withRerollDice(msg, records, common, base) {
  const e = msg.flags?.[MODULE_ID]?.reroll;
  const shown = records[0];
  if (e && Array.isArray(e.newNaturals) && Array.isArray(e.oldNaturals) && e.oldMessageId) {
    const keptNew = keptNewRoll(e.keep, e.oldTotal, e.newTotal);
    const out = [];
    // The new physical die lives under this message's id.
    out.push(base({
      ...common, ...pick(shown, ["formula", "dieIndex"]),
      id: `${msg._id}:r0:t0:d0`, natural: e.newNaturals[0] ?? shown?.natural ?? null, kept: keptNew,
      total: keptNew ? shown?.total ?? null : numberOrNull(e.newTotal),
      isReroll: true, rerollOf: e.oldMessageId, resource: e.resource ?? undefined, source: "reroll-enrich",
    }));
    // The original die keeps its own message id so an earlier live record is refreshed, not duplicated.
    out.push(base({
      ...common, ...pick(shown, ["formula"]),
      id: `${e.oldMessageId}:r0:t0:d0`, msgId: e.oldMessageId, dieIndex: 0,
      natural: e.oldNaturals[0] ?? null, kept: !keptNew,
      total: keptNew ? numberOrNull(e.oldTotal) : shown?.total ?? null,
      ts: msg.timestamp - 1, isReroll: false, rerolledBy: msg._id, rerollOutcome: keptNew ? "discarded" : "kept",
      resource: e.resource ?? undefined, source: "reroll-enrich",
    }));
    // Fortune rerolls carry two dice per roll; append any extra naturals the same way.
    for (let i = 1; i < e.newNaturals.length; i++) {
      out.push(base({ ...common, formula: shown?.formula ?? "2d20", id: `${msg._id}:r0:t0:d${i}`, dieIndex: i, natural: e.newNaturals[i], kept: false, total: null, isReroll: true, rerollOf: e.oldMessageId, source: "reroll-enrich" }));
    }
    for (let i = 1; i < e.oldNaturals.length; i++) {
      out.push(base({ ...common, formula: shown?.formula ?? "2d20", id: `${e.oldMessageId}:r0:t0:d${i}`, msgId: e.oldMessageId, dieIndex: i, natural: e.oldNaturals[i], kept: false, total: null, ts: msg.timestamp - 1, isReroll: false, rerolledBy: msg._id, source: "reroll-enrich" }));
    }
    return out;
  }
  const parsed = parseRerollDiscard(msg.content);
  const discards = parsed.naturals.length ? parsed.naturals : [null];
  const extra = discards.map((natural, i) => base({
    ...common, formula: shown?.formula ?? "1d20",
    id: `${msg._id}:html:${i}`, dieIndex: records.length + i, natural, kept: false, total: parsed.total,
    isReroll: true, source: "reroll-html", ...(natural === null ? { discardUnknown: true } : {}),
  }));
  return [...records, ...extra];
}

const SAVES = ["fortitude", "reflex", "will"];
const SKILLS = ["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery"];

/**
 * One slug naming the statistic behind a check, for the per-stat breakdowns (Reflex, Stealth, …).
 * Cheap and stored instead of the whole domains array.
 * @param {string} type
 * @param {string|null} identifier
 * @param {string[]} domains
 */
export function deriveStat(type, identifier, domains) {
  const has = (s) => domains.includes(s);
  if (type === "saving-throw") return SAVES.find(has) ?? identifier ?? "save";
  if (type === "perception-check") return "perception";
  if (type === "flat-check") return "flat-check";
  if (type === "counteract-check") return "counteract";
  if (type === "skill-check" || type === "initiative" || type === "check") {
    const skill = SKILLS.find(has) ?? domains.find((d) => /-lore$/.test(d)) ?? null;
    if (skill) return skill;
    if (has("perception")) return "perception";
    if (identifier && /^[a-z][a-z-]*$/.test(identifier)) return identifier;
    return type === "initiative" ? "initiative" : null;
  }
  if (type === "attack-roll") {
    if (has("spell-attack-roll")) return "spell-attack";
    if (has("ranged-attack-roll")) return "ranged-strike";
    if (has("melee-attack-roll")) return "melee-strike";
    return "strike";
  }
  return identifier ?? null;
}

/** PF2e's rule, verified at tag 7.8.0: keep the old roll only when "higher"/"lower" says so. */
export function keptNewRoll(keep, oldTotal, newTotal) {
  if (keep === "higher" && Number(oldTotal) > Number(newTotal)) return false;
  if (keep === "lower" && Number(oldTotal) < Number(newTotal)) return false;
  return true;
}

function numberOrNull(v) {
  const n = Number(v);
  return v === null || v === undefined || Number.isNaN(n) ? null : n;
}

function pick(obj, keys) {
  const out = {};
  if (!obj) return out;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
