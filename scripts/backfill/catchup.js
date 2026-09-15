// Catch-up for the current evening (M2): normalize tonight's messages from game.messages and insert
// whatever the live capture missed (GM reload, Forge idle/wake, rolls before the GM joined).
// Same normalizer, event "backfill". Whole-history backfill is post-1.0.
import { messageToRollRecords } from "../capture/normalize.js";
import { captureContext } from "../capture/live.js";
import { sessionKeyFor } from "../sessions/bucket.js";
import { bucketOptions } from "../settings.js";

/**
 * @param {import("../storage/store.js").JournalStore} store
 * @param {{ key?: string }} [opts]  Evening key to catch up; defaults to the current one.
 */
export async function catchUp(store, { key } = {}) {
  if (!game.user.isGM) return { scanned: 0, added: 0, key: null };
  const opts = bucketOptions();
  const target = key ?? sessionKeyFor(Date.now(), opts);
  const ctx = captureContext("backfill", null, store);
  const messages = game.messages.contents.filter((m) => sessionKeyFor(m.timestamp, opts) === target);
  const fresh = [];
  for (const m of messages) {
    for (const r of messageToRollRecords(m.toObject(), ctx)) if (!store.has(r.id)) fresh.push(r);
  }
  if (fresh.length) {
    await store.append(fresh);
    await store.flush();
  }
  return { scanned: messages.length, added: fresh.length, key: target };
}
