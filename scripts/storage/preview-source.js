// M1 data source: the chat log on this client, normalized in memory. Nothing is stored. Replaced by the
// journal store in M2 (same interface: listSessions / getSession / refresh / addMessage).
import { messageToRollRecords } from "../capture/normalize.js";
import { sessionKeyFor, sessionLabel, compareKeys } from "../sessions/bucket.js";
import { bucketOptions, getSetting, SETTINGS } from "../settings.js";

export class PreviewSource {
  constructor() {
    /** @type {Map<string, import("../types.js").RollRecord[]>} */
    this.sessions = new Map();
    this.ids = new Set();
    this.kind = "preview";
    this.loaded = false;
  }

  _ctx() {
    const opts = bucketOptions();
    return { sessionKeyFor: (ts) => sessionKeyFor(ts, opts), event: "backfill", captureRawRolls: getSetting(SETTINGS.captureRawRolls), inCombat: null };
  }

  /** Re-normalize the whole chat log. */
  refresh() {
    this.sessions.clear();
    this.ids.clear();
    const ctx = this._ctx();
    for (const message of game.messages.contents) this._ingest(message.toObject(), ctx);
    this.loaded = true;
    return this;
  }

  /** Incrementally add one message (createChatMessage hook). Returns the affected session key or null. */
  addMessage(message) {
    if (!this.loaded) return null;
    return this._ingest(message.toObject(), this._ctx());
  }

  _ingest(data, ctx) {
    const records = messageToRollRecords(data, ctx);
    let key = null;
    for (const r of records) {
      if (this.ids.has(r.id)) continue;
      this.ids.add(r.id);
      if (!this.sessions.has(r.sessionKey)) this.sessions.set(r.sessionKey, []);
      this.sessions.get(r.sessionKey).push(r);
      key = r.sessionKey;
    }
    return key;
  }

  currentKey() {
    return sessionKeyFor(Date.now(), bucketOptions());
  }

  /** Newest first. */
  listSessions() {
    return [...this.sessions.entries()]
      .map(([key, records]) => ({ key, label: sessionLabel(key), n: records.length, firstTs: Math.min(...records.map((r) => r.ts)), lastTs: Math.max(...records.map((r) => r.ts)) }))
      .sort((a, b) => compareKeys(b.key, a.key));
  }

  getSession(key) {
    return this.sessions.get(key) ?? [];
  }
}
