// Whole-history backfill, the Foundry half (SCOPE Should-6, D5): read the world's chat log for a date
// range, hand it to the pure planner, and store the evenings the GM chose. Reads happen in chunks with
// a yield between them so the dialog can show progress; writes go through the store one evening at a
// time (one page each), so a large backfill never blocks the client and a failure loses at most one
// evening. Adds only: nothing is ever deleted, and a re-run adds nothing (stored ids are skipped).
import { planBackfill } from "./plan.js";
import { captureContext } from "../capture/live.js";
import { localMidnight, localDateKey } from "../sessions/bucket.js";

const DAY_MS = 86_400_000;
const CHUNK = 400;
const nextTick = () => new Promise((r) => setTimeout(r, 0));

/** The range the form starts with: from the oldest message in the world to today, as date keys. */
export function backfillBounds(store) {
  const tz = store.config().timezone;
  let earliest = Infinity;
  for (const m of game.messages.contents) if (Number.isFinite(m.timestamp) && m.timestamp < earliest) earliest = m.timestamp;
  const now = Date.now();
  return { from: localDateKey(Number.isFinite(earliest) ? earliest : now, tz), to: localDateKey(now, tz), messages: game.messages.size, timezone: tz };
}

/**
 * Plan a backfill. Dates are `YYYY-MM-DD` in the world timezone (inclusive on both ends) or raw
 * timestamps. Nothing is written.
 * @param {import("../storage/store.js").JournalStore} store
 * @param {{ from?: string|number, to?: string|number, minRolls?: number, requireGM?: boolean, onProgress?: (p: object) => void }} [opts]
 */
export async function backfillPlan(store, { from, to, minRolls = 30, requireGM = true, onProgress } = {}) {
  const cfg = store.config();
  const lo = typeof from === "string" ? localMidnight(from, cfg.timezone) : (from ?? -Infinity);
  const hi = typeof to === "string" ? localMidnight(to, cfg.timezone) + DAY_MS : (to ?? Infinity);
  if (lo === null || hi === null || !(lo < hi)) throw new Error("backfill: the date range is empty");
  const docs = game.messages.contents.filter((m) => m.timestamp >= lo && m.timestamp < hi);
  const messages = [];
  for (let i = 0; i < docs.length; i += CHUNK) {
    for (const m of docs.slice(i, i + CHUNK)) messages.push(m.toObject());
    onProgress?.({ phase: "scan", done: messages.length, total: docs.length });
    await nextTick();
  }
  const plan = planBackfill(messages, {
    ctx: captureContext("backfill", null, store),
    config: cfg,
    intervals: store.intervals(),
    has: (id) => store.has(id),
    from: lo, to: hi,
    gmUserIds: game.users.filter((u) => u.isGM).map((u) => u.id),
    minRolls, requireGM,
  });
  return { ...plan, from: lo, to: hi };
}

/**
 * Store the chosen evenings of a plan, oldest first, one page write each.
 * @param {import("../storage/store.js").JournalStore} store
 * @param {Awaited<ReturnType<typeof backfillPlan>>} plan
 * @param {Iterable<string>} keys   session keys to add (from the plan)
 * @param {{ onProgress?: (p: object) => void }} [opts]
 */
export async function backfillRun(store, plan, keys, { onProgress } = {}) {
  if (!game.user.isGM) return { added: 0, sessions: 0, keys: [] };
  const chosen = new Set(keys);
  const sessions = plan.sessions.filter((s) => chosen.has(s.key));
  let added = 0, done = 0;
  for (const s of sessions) {
    await store.append(s.records);
    await store.flush();
    added += s.records.length;
    done++;
    onProgress?.({ phase: "write", done, total: sessions.length, key: s.key, added });
    await nextTick();
  }
  return { added, sessions: sessions.length, keys: sessions.map((s) => s.key) };
}
