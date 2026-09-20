// @ts-check
// THE normalizer (SCOPE §4 key rule): messageToRollRecords(msg, ctx) → RollRecord[]. Used unchanged by
// live capture, the current-evening catch-up and the analyzer macro, so the paths cannot drift.
// Input is the plain `ChatMessage#toObject()` shape (docs/PLAN.md §4.1); no Foundry globals here.

import { EXTRACTORS } from "./extractors/index.js";

/**
 * @param {import("../types.js").MessageData} msg
 * @param {import("../types.js").NormalizeContext} ctx
 * @returns {import("../types.js").RollRecord[]}
 */
export function messageToRollRecords(msg, ctx) {
  if (!msg || typeof msg !== "object" || !msg._id) return [];
  const ts = Number(msg.timestamp);
  if (!Number.isFinite(ts)) return [];
  const base = makeBase(msg, ctx, ts);
  const out = [];
  for (const ex of EXTRACTORS) {
    if (!ex.on.includes(ctx.event)) continue;
    let hit = false;
    try { hit = ex.matches(msg); } catch { hit = false; }
    if (!hit) continue;
    out.push(...ex.extract(msg, ctx, base));
  }
  return out;
}

/**
 * Which extractor would claim this message (for coverage reports); null when none.
 * @param {import("../types.js").MessageData} msg
 */
export function classifyMessage(msg) {
  for (const ex of EXTRACTORS) {
    try { if (ex.matches(msg)) return ex.id; } catch { /* ignore */ }
  }
  if (msg?.flags?.pf2e?.context?.type === "damage-roll") return "damage";
  if (typeof msg?.flags?.pf2e?.context?.type === "string") return "substituted-or-no-d20";
  return null;
}

function makeBase(msg, ctx, ts) {
  // The session key is resolved lazily, on the first record: in gap and manual modes asking for a key
  // can open a session, and a message without any d20 must never do that.
  let sessionKey;
  const speaker = msg.speaker ?? {};
  const whispered = Array.isArray(msg.whisper) && msg.whisper.length > 0;
  /** @type {Partial<import("../types.js").RollRecord>} */
  const defaults = {
    msgId: msg._id,
    ts,
    userId: typeof msg.author === "string" ? msg.author : (msg.author?._id ?? msg.author?.id ?? msg.user ?? null),
    actorId: speaker.actor ?? null,
    tokenId: speaker.token ?? null,
    alias: speaker.alias ?? null,
    natural: null,
    kept: true,
    formula: "1d20",
    total: null,
    type: "raw",
    source: "raw",
    domains: [],
    ident: null,
    action: null,
    dc: null,
    dcVisible: null,
    outcome: null,
    unadjustedOutcome: null,
    isReroll: false,
    rollTwice: null,
    mode: null,
    blind: msg.blind === true,
    whispered,
    inCombat: ctx.inCombat ?? null,
  };
  return (overrides) => {
    sessionKey ??= ctx.sessionKeyFor(ts);
    return /** @type {import("../types.js").RollRecord} */ ({ ...defaults, sessionKey, ...overrides });
  };
}
