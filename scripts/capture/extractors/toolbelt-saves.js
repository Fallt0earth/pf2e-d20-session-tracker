// @ts-check
// Extractor 3: saving throws rolled from PF2e Toolbelt's Target Helper (verified on 3.41.1, spike S5).
// The save never becomes a chat message; it lives in the damage message's flags and arrives as an
// `updateChatMessage`. Layout:
//   flags["pf2e-toolbelt"].targetHelper = {
//     type: "damage", targets: ["Scene.<sceneId>.Token.<tokenId>", ...], author, item, private, ...
//     saveVariants: { [variantKey]: { dc, basic, statistic, saves: { [tokenId]: {
//         die, value, success, unadjustedOutcome, private, statistic, roll: "<CheckRoll JSON>", ... } } } }
//   }
// `roll.options.rollerId` names the user who rolled, so attribution survives catch-up. The flag is
// written by the card's author (or relayed by a GM), so it is believed only when plausible: see
// trustedRoller(). Flag keys and sizes are bounded, because any player can author such a card.

import { parseRoll } from "../dice-walk.js";
import { isDocumentId, isNatural } from "../sanitize.js";

export const id = "toolbelt-saves";
export const on = ["create", "update", "backfill"];

const FLAG_SCOPE = "pf2e-toolbelt";
const MAX_TARGETS = 64;  // tokens on one damage card
const MAX_VARIANTS = 8;  // save variants of one card
const MAX_REROLLS = 4;   // re-rolls of one target's save that get their own record

/** @param {import("../../types.js").MessageData} msg */
export function matches(msg) {
  return listSaves(msg).length > 0;
}

/**
 * @param {import("../../types.js").MessageData} msg
 * @param {import("../../types.js").NormalizeContext & { resolveToken?: (sceneId: string|null, tokenId: string) => { actorId?: string|null, alias?: string|null } | null }} ctx
 * @param {(overrides: object) => import("../../types.js").RollRecord} base
 */
export function extract(msg, ctx, base) {
  const out = [];
  for (const { variantKey, variant, tokenId, sceneId, save } of listSaves(msg)) {
    const roll = parseRoll(save.roll);
    const options = roll?.options && typeof roll.options === "object" ? roll.options : {};
    const natural = numberOrNull(save.die ?? firstD20(roll));
    if (!isNatural(natural)) continue; // not a physical d20: nothing to record
    const total = numberOrNull(save.value ?? roll?.total);
    const statistic = save.statistic ?? variant.statistic ?? null;
    const dc = numberOrNull(variant.dc);
    const token = ctx.resolveToken?.(sceneId, tokenId) ?? null;
    const rollerId = trustedRoller(options.rollerId, token);
    const userId = rollerId ?? (ctx.event === "update" ? ctx.updaterUserId ?? null : null);
    const baseId = `${msg._id}:tb:${safe(variantKey)}:${tokenId}`;
    const prev = ctx.existing?.(baseId);
    const prevSeq = prev ? seqOf(prev.id) : -1;
    const changed = prev && (prev.natural !== natural || prev.total !== total);
    if (changed && prevSeq >= MAX_REROLLS) continue; // a save is re-rolled once or twice, not without end
    const seq = prev ? (changed ? prevSeq + 1 : prevSeq) : 0;
    out.push(base({
      id: `${baseId}:${seq}`,
      dieIndex: out.length,
      natural,
      kept: true,
      formula: typeof roll?.formula === "string" && /d20/.test(roll.formula) ? dieFormula(roll) : "1d20",
      total,
      type: "saving-throw",
      source: "toolbelt",
      domains: Array.isArray(options.domains) ? [...options.domains] : (statistic ? [statistic, "saving-throw"] : ["saving-throw"]),
      stat: statistic,
      ident: statistic,
      action: variant.basic ? "basic-save" : null,
      dc,
      dcVisible: dc !== null ? true : null,
      outcome: normalizeOutcome(save.success ?? save.outcome ?? options.degreeOfSuccess),
      unadjustedOutcome: normalizeOutcome(save.unadjustedOutcome) ?? null,
      isReroll: options.isReroll === true || seq > 0,
      ...(seq > 0 && prev ? { rerollOf: prev.id } : {}),
      mode: save.private ? "blindroll" : null,
      blind: save.private === true,
      actorId: token?.actorId ?? null,
      tokenId,
      alias: token?.alias ?? null,
      userId,
      ...(rollerId ? {} : { userGuess: true }),
    }));
  }
  return out;
}

/**
 * `rollerId` is written by whoever saved the flag (the message's author, or a GM relaying a player's
 * request), so it is only believed when it is plausible: a well-formed user id and, when the token is
 * known, a user who could have rolled for it (its owner or a GM). Anything else falls back to the
 * updater and is marked as a guess.
 * @param {unknown} rollerId
 * @param {{ rollers?: string[] | null } | null} token
 */
function trustedRoller(rollerId, token) {
  if (!isDocumentId(rollerId)) return null;
  if (Array.isArray(token?.rollers) && !token.rollers.includes(rollerId)) return null;
  return /** @type {string} */ (rollerId);
}

function listSaves(msg) {
  const helper = msg?.flags?.[FLAG_SCOPE]?.targetHelper;
  if (!helper || typeof helper !== "object") return [];
  const sceneOf = new Map();
  for (const t of Array.isArray(helper.targets) ? helper.targets.slice(0, MAX_TARGETS) : []) {
    if (typeof t !== "string" || t.length > 80) continue;
    const m = /^Scene\.([A-Za-z0-9]{16})\.Token\.([A-Za-z0-9]{16})$/.exec(t);
    if (m) sceneOf.set(m[2], m[1]);
  }
  const out = [];
  const variants = helper.saveVariants && typeof helper.saveVariants === "object" ? helper.saveVariants : (helper.saves ? { null: { saves: helper.saves, dc: helper.dc, statistic: helper.statistic } } : {});
  for (const [variantKey, variant] of Object.entries(variants).slice(0, MAX_VARIANTS)) {
    const saves = variant?.saves && typeof variant.saves === "object" ? variant.saves : {};
    for (const [tokenId, save] of Object.entries(saves).slice(0, MAX_TARGETS)) {
      if (!isDocumentId(tokenId) || !save || typeof save !== "object") continue; // flag keys are free text: only token ids count
      out.push({ variantKey, variant, tokenId, sceneId: sceneOf.get(tokenId) ?? null, save });
    }
  }
  return out;
}

function firstD20(roll) {
  const terms = Array.isArray(roll?.terms) ? roll.terms : [];
  for (const t of terms) if (Number(t?.faces) === 20 && Array.isArray(t.results) && t.results[0]) return t.results[0].result;
  return null;
}

function dieFormula(roll) {
  const die = (roll.terms ?? []).find((t) => Number(t?.faces) === 20);
  if (!die) return "1d20";
  return `${die.number ?? 1}d20${Array.isArray(die.modifiers) ? die.modifiers.join("") : ""}`;
}

function normalizeOutcome(v) {
  if (typeof v === "string") {
    const s = v.replace(/[-_\s]/g, "").toLowerCase();
    if (s === "criticalsuccess") return "criticalSuccess";
    if (s === "criticalfailure") return "criticalFailure";
    if (s === "success" || s === "failure") return s;
  }
  if (typeof v === "number") return ["criticalFailure", "failure", "success", "criticalSuccess"][v] ?? null;
  return null;
}

function seqOf(id) {
  const n = Number(String(id).split(":").pop());
  return Number.isInteger(n) ? n : 0;
}

function safe(key) {
  return String(key).replace(/[^A-Za-z0-9_-]/g, "_");
}

function numberOrNull(v) {
  const n = Number(v);
  return v === null || v === undefined || Number.isNaN(n) ? null : n;
}
