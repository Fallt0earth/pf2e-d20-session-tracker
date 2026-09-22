// @ts-check
// Bounds and shapes for everything that reaches a stored record. Chat messages are written by the
// players' clients, so every part of one (flags, speaker, rolls, content, timestamp) is untrusted
// input: the normalizer keeps only values of the expected shape and size. Pure: no Foundry globals.

/** Most physical d20s recorded from one message. PF2e needs four (fortune plus a reroll). */
export const MAX_DICE_PER_MESSAGE = 24;
/** Card HTML beyond this length is not parsed (PF2e reroll and flat-check cards are a few KB). */
export const MAX_HTML_LENGTH = 50_000;
/** A live roll by a player whose timestamp is further than this from the writer's clock gets the writer's time. */
export const CLOCK_SKEW_MS = 15 * 60 * 1000;

const DOCUMENT_ID = /^[A-Za-z0-9]{16}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/;
const ROW_KEY = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/;
const OUTCOMES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const MODES = ["roll", "publicroll", "gmroll", "blindroll", "selfroll"];
const ROLL_TWICE = ["keep-higher", "keep-lower"];
const REROLL_OUTCOMES = ["kept", "discarded"];

/** The user a message was created by (the server refuses a player's message that names another author). @param {any} msg */
export function authorOf(msg) {
  return typeof msg?.author === "string" ? msg.author : (msg?.author?._id ?? msg?.author?.id ?? msg?.user ?? null);
}

/** A Foundry document id as the server generates them (16 alphanumerics). */
export function isDocumentId(v) {
  return typeof v === "string" && DOCUMENT_ID.test(v);
}

/** A d20 face. */
export function isNatural(v) {
  return Number.isInteger(v) && v >= 1 && v <= 20;
}

/** Array of d20 faces, at most `max` long; anything else in the input is dropped. */
export function naturalsOf(v, max = 4) {
  return Array.isArray(v) ? v.slice(0, max).map(Number).filter(isNatural) : [];
}

/** Lower-case slug ("reflex", "melee-strike", "sailing-lore") or null. */
export function slugOrNull(v) {
  return typeof v === "string" && SLUG.test(v) ? v : null;
}

/** PF2e identifiers and domains ("<itemId>.longsword.melee", "str-based"): a bounded plain token or null. */
function tokenOrNull(v) {
  return typeof v === "string" && TOKEN.test(v) ? v : null;
}

function text(v, max) {
  if (typeof v !== "string" || !v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

function finite(v, limit = 100_000) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

const oneOf = (v, list) => (typeof v === "string" && list.includes(v) ? v : null);
const idish = (v) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);

/**
 * Coerce one record to the stored shape. Unknown fields are dropped, strings are bounded, enumerated
 * fields only keep known values. Returns null when the record cannot be stored at all.
 * @param {any} r
 * @returns {import("../types.js").RollRecord | null}
 */
export function sanitizeRecord(r) {
  if (!r || typeof r !== "object") return null;
  const id = text(r.id, 160), msgId = idish(r.msgId), sessionKey = text(r.sessionKey, 40);
  if (!id || !msgId || !sessionKey || !Number.isFinite(r.ts)) return null;
  if (msgId.includes(":") || !id.startsWith(`${msgId}:`)) return null; // the store finds a record through the message id in front of its id
  if (!ROW_KEY.test(id)) return null; // the id is a key on the stored page and a path segment in Foundry updates (same rule as codec.js isRowKey)
  const natural = r.natural === null || r.natural === undefined ? null : Number(r.natural);
  if (natural !== null && !isNatural(natural)) return null;
  /** @type {any} */
  const out = {
    id, msgId, sessionKey,
    dieIndex: Number.isInteger(r.dieIndex) && r.dieIndex >= 0 ? r.dieIndex : 0,
    ts: r.ts,
    userId: idish(r.userId),
    actorId: idish(r.actorId),
    tokenId: idish(r.tokenId),
    alias: text(r.alias, 80),
    natural,
    kept: r.kept !== false,
    formula: text(r.formula, 24) ?? "1d20",
    total: finite(r.total),
    type: slugOrNull(r.type) ?? "raw",
    source: slugOrNull(r.source) ?? "raw",
    domains: Array.isArray(r.domains) ? r.domains.slice(0, 60).map(tokenOrNull).filter(Boolean) : [],
    stat: slugOrNull(r.stat),
    ident: tokenOrNull(r.ident),
    action: tokenOrNull(r.action),
    dc: finite(r.dc, 1000),
    dcVisible: typeof r.dcVisible === "boolean" ? r.dcVisible : null,
    outcome: oneOf(r.outcome, OUTCOMES),
    unadjustedOutcome: oneOf(r.unadjustedOutcome, OUTCOMES),
    isReroll: r.isReroll === true,
    rollTwice: oneOf(r.rollTwice, ROLL_TWICE),
    mode: oneOf(r.mode, MODES),
    blind: r.blind === true,
    whispered: r.whispered === true,
    inCombat: typeof r.inCombat === "boolean" ? r.inCombat : null,
  };
  if (r.userGuess === true) out.userGuess = true;
  const rerollOf = text(r.rerollOf, 160); // a message id (PF2e reroll) or a record id (Toolbelt re-roll)
  if (rerollOf) out.rerollOf = rerollOf;
  if (idish(r.rerolledBy)) out.rerolledBy = r.rerolledBy;
  if (oneOf(r.rerollOutcome, REROLL_OUTCOMES)) out.rerollOutcome = r.rerollOutcome;
  if (typeof r.resource === "string" && /^[A-Za-z][A-Za-z0-9-]{0,39}$/.test(r.resource)) out.resource = r.resource;
  if (r.valueHidden === true) out.valueHidden = true;
  if (r.discardUnknown === true) out.discardUnknown = true;
  return out;
}
