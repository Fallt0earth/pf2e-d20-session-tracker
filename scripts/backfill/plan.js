// @ts-check
// Whole-history backfill, the pure half (SCOPE Should-6, D5): plan what the world's chat log would add.
// The same normalizer as live capture and the catch-up runs over every message in a date range, one
// Sessionizer buckets the results in time order under the session definition in force, and the plan
// lists what each evening would gain. Nothing is written here; the GM ticks the evenings in the
// preview and the Foundry side stores them. Records the store already holds are skipped (a re-run adds
// nothing), and the two SCOPE mitigations for junk evenings decide what is ticked by default: fewer
// rolls than the threshold, or no message from a GM that evening, leaves an evening unticked, never
// dropped. Pure: no Foundry globals.

import { messageToRollRecords } from "../capture/normalize.js";
import { Sessionizer, chronological } from "../sessions/sessionizer.js";
import { UNSCHEDULED } from "../sessions/bucket.js";
import { authorOf } from "../capture/sanitize.js";

/**
 * @typedef {object} PlannedSession
 * @property {string} key
 * @property {number} n              records the backfill would add
 * @property {number} existing       records of that evening the store already holds
 * @property {number} players        distinct rolling users among the new records
 * @property {boolean} gmPresent     a GM authored a message that evening
 * @property {number} firstTs
 * @property {number} lastTs
 * @property {boolean} selected      ticked by default (n ≥ minRolls and, when required, gmPresent)
 * @property {import("../types.js").RollRecord[]} records
 */

/**
 * @param {import("../types.js").MessageData[]} messages   ChatMessage#toObject() shapes, any order
 * @param {object} opts
 * @param {import("../types.js").NormalizeContext} opts.ctx   a backfill context; its sessionKeyFor and existing are replaced by the plan's own
 * @param {object} opts.config                                the session definition (Sessionizer config)
 * @param {Array<{ key: string, firstTs: number|null, lastTs: number|null, manual?: any }>} [opts.intervals]   stored sessions
 * @param {(id: string) => boolean} [opts.has]               whether the store already holds a record id
 * @param {number} [opts.from]                               inclusive lower bound on message.timestamp
 * @param {number} [opts.to]                                 exclusive upper bound
 * @param {string[]} [opts.gmUserIds]
 * @param {number} [opts.minRolls]                           evenings below this are unticked (default 30, SCOPE §5)
 * @param {boolean} [opts.requireGM]                         untick evenings without a GM message (default true)
 * @returns {{ scanned: number, sessions: PlannedSession[], total: number, skipped: number }}
 */
export function planBackfill(messages, opts) {
  const { ctx, config, intervals = [], has = () => false, from = -Infinity, to = Infinity, gmUserIds = [], minRolls = 30, requireGM = true } = opts;
  const inRange = messages.filter((m) => m && Number.isFinite(m.timestamp) && m.timestamp >= from && m.timestamp < to).sort((a, b) => a.timestamp - b.timestamp);
  const sessionizer = new Sessionizer(config, intervals);
  /** @type {Map<string, any[]>} baseId → records planned in this batch (Toolbelt save sequence numbers) */
  const planned = new Map();
  const batchCtx = {
    ...ctx,
    event: "backfill",
    sessionKeyFor: (ts) => sessionizer.assign(ts),
    existing: (baseId) => planned.get(baseId)?.at(-1) ?? ctx.existing?.(baseId),
  };
  const gms = new Set(gmUserIds);
  /** @type {Map<string, { records: any[], existing: number }>} */
  const byKey = new Map();
  let skipped = 0;
  for (const m of inRange) {
    for (const r of messageToRollRecords(m, batchCtx)) {
      const baseId = r.id.split(":").slice(0, -1).join(":");
      if (!planned.has(baseId)) planned.set(baseId, []);
      planned.get(baseId).push(r);
      const s = byKey.get(r.sessionKey) ?? { records: [], existing: 0 };
      if (has(r.id)) { s.existing++; skipped++; } else s.records.push(r);
      byKey.set(r.sessionKey, s);
    }
  }
  // "GM present": a GM wrote something that evening, roll or not. Keys are settled now that every
  // record has been assigned, so peek places a message without dice as its neighbours were.
  const gmKeys = new Set();
  if (gms.size) for (const m of inRange) if (gms.has(authorOf(m))) gmKeys.add(sessionizer.peek(m.timestamp));
  const sessions = [...byKey.entries()]
    .filter(([, s]) => s.records.length)
    .map(([key, s]) => {
      const n = s.records.length;
      const gmPresent = gmKeys.has(key) || s.records.some((r) => r.userId && gms.has(r.userId));
      return {
        key, n, existing: s.existing,
        players: new Set(s.records.map((r) => r.userId).filter(Boolean)).size,
        gmPresent,
        firstTs: Math.min(...s.records.map((r) => r.ts)),
        lastTs: Math.max(...s.records.map((r) => r.ts)),
        selected: key !== UNSCHEDULED && n >= minRolls && (!requireGM || gmPresent),
        records: s.records,
      };
    });
  return { scanned: inRange.length, sessions: chronological(sessions), total: sessions.reduce((a, s) => a + s.n, 0), skipped };
}
