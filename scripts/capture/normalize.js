// @ts-check
// THE normalizer (SCOPE §4 key rule): messageToRollRecords(msg, ctx) → RollRecord[]. Used unchanged by
// live capture, the current-evening catch-up and the analyzer macro, so the paths cannot drift.
// Input is the plain `ChatMessage#toObject()` shape (docs/PLAN.md §4.1); no Foundry globals here.

import { EXTRACTORS } from "./extractors/index.js";
import { sanitizeRecord, authorOf, MAX_DICE_PER_MESSAGE, CLOCK_SKEW_MS } from "./sanitize.js";

/**
 * A message is written by the rolling client, so nothing in it is trusted: an extractor that throws
 * loses only its own message (never the rest of a catch-up), at most MAX_DICE_PER_MESSAGE dice are
 * kept, and every record is coerced to the stored shape before it leaves.
 * @param {import("../types.js").MessageData} msg
 * @param {import("../types.js").NormalizeContext} ctx
 * @returns {import("../types.js").RollRecord[]}
 */
export function messageToRollRecords(msg, ctx) {
  if (!msg || typeof msg !== "object" || typeof msg._id !== "string" || !msg._id || msg._id.length > 64) return [];
  const ts = effectiveTimestamp(msg, ctx);
  if (ts === null) return [];
  const base = makeBase(msg, ctx, ts);
  const out = [];
  for (const ex of EXTRACTORS) {
    if (!ex.on.includes(ctx.event)) continue;
    try {
      if (!ex.matches(msg)) continue;
      for (const r of ex.extract(msg, ctx, base)) {
        const clean = sanitizeRecord(r);
        if (clean && out.length < MAX_DICE_PER_MESSAGE) out.push(clean);
      }
    } catch (e) {
      ctx.warn?.(`extractor ${ex.id} skipped message ${msg._id}`, e);
    }
  }
  return out;
}

/**
 * The time a record is filed under. `message.timestamp` is set by the rolling client, so:
 *  - nothing is ever filed in the future (it would hold the running session open);
 *  - a live roll by a player whose timestamp is far from the writer's clock gets the writer's time.
 * A GM's messages are taken as they are (imports, and the e2e harness, create dated messages).
 * Without `ctx.now` (analyzer macro, unit tests) the message's own timestamp is used.
 * @returns {number|null}
 */
function effectiveTimestamp(msg, ctx) {
  const claimed = Number(msg.timestamp);
  if (!Number.isFinite(claimed) || claimed <= 0) return null;
  const now = typeof ctx.now === "function" ? Number(ctx.now()) : NaN;
  if (!Number.isFinite(now)) return claimed;
  const byGM = ctx.isGM?.(authorOf(msg)) === true;
  if (ctx.event === "create" && !byGM && Math.abs(now - claimed) > CLOCK_SKEW_MS) return now;
  if (claimed > now + CLOCK_SKEW_MS) return now;
  return claimed;
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
    userId: authorOf(msg),
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
