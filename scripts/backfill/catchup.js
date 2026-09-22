// Catch-up for the running session: normalize recent messages from game.messages and insert whatever
// the live capture missed (GM reload, Forge idle/wake, rolls before the GM joined). Same normalizer,
// event "backfill", one shared Sessionizer for the batch. Whole-history backfill is post-1.0.
import { messageToRollRecords } from "../capture/normalize.js";
import { captureContext } from "../capture/live.js";
import { sessionKeyFor, dayWindow } from "../sessions/bucket.js";

const HOUR = 3_600_000;

/**
 * Which chat messages a catch-up looks at:
 *  daily  — those whose daily key is the target (default: today's);
 *  gap    — from one gap before the running session's first roll (or one gap back from now);
 *  manual — from the running session's Start (or one gap back from now, landing in "unscheduled").
 * @param {import("../storage/store.js").JournalStore} store
 * @param {{ key?: string }} [opts]
 */
export function catchUpWindow(store, { key } = {}) {
  const cfg = store.config();
  const now = Date.now();
  if (cfg.mode === "daily") {
    const target = key ?? sessionKeyFor(now, cfg);
    const { lo, hi } = dayWindow(target);
    return { target, filter: (m) => m.timestamp >= lo && m.timestamp <= hi && sessionKeyFor(m.timestamp, cfg) === target };
  }
  const gapMs = cfg.gapHours * HOUR;
  const target = key ?? store.currentKey();
  const span = target ? store.sessions.get(target) : null;
  const since = cfg.mode === "manual" && cfg.manualOpen && !key
    ? cfg.manualOpen.startedTs
    : (span?.firstTs ?? now) - gapMs;
  const until = key && span?.lastTs ? span.lastTs + gapMs : Infinity;
  return { target, filter: (m) => m.timestamp >= since && m.timestamp <= until };
}

/**
 * @param {import("../storage/store.js").JournalStore} store
 * @param {{ key?: string }} [opts]  Session to catch up; defaults to the running one.
 */
export async function catchUp(store, opts = {}) {
  if (!game.user.isGM) return { scanned: 0, added: 0, key: null };
  await store.autoCloseManual();
  const { target, filter } = catchUpWindow(store, opts);
  const messages = game.messages.contents.filter(filter).sort((a, b) => a.timestamp - b.timestamp);
  const sessionizer = store.sessionizer();
  const ctx = captureContext("backfill", null, store, (ts) => sessionizer.assign(ts));
  const fresh = [];
  for (const m of messages) {
    for (const r of messageToRollRecords(m.toObject(), ctx)) if (!store.has(r.id)) fresh.push(r);
  }
  if (fresh.length) {
    await store.append(fresh);
    await store.flush();
  }
  return { scanned: messages.length, added: fresh.length, key: target ?? fresh.at(-1)?.sessionKey ?? null };
}
