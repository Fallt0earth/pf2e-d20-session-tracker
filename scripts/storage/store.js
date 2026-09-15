// JournalStore: the persistent data source (M2). Same read interface as the M1 preview source
// (listSessions / getSession / currentKey / kind / loaded / refresh) plus GM-only writes through a
// debounced serial queue so bursts become one page update and writes never overlap.
import { sessionKeyFor, sessionLabel, compareKeys } from "../sessions/bucket.js";
import { bucketOptions } from "../settings.js";
import { WriteQueue } from "../util/queue.js";
import { findLog, ensureLog, readPage, writePage, writeMeta, deletePage } from "./journal.js";
import { pageSummaryHtml } from "./page-text.js";

export class JournalStore {
  constructor() {
    this.kind = "journal";
    /** @type {Map<string, { records: import("../types.js").RollRecord[], ids: Set<string>, meta: object, pageId: string|null }>} */
    this.sessions = new Map();
    /** @type {Map<string, import("../types.js").RollRecord[]>} msgId → records (for existing() lookups) */
    this.byMsg = new Map();
    this.journal = null;
    this.loaded = false;
    this.queue = new WriteQueue({ debounceMs: 250, onError: (e, key) => console.error(`d20 tracker | write failed for ${key}`, e) });
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(key) { for (const fn of this.listeners) { try { fn(key); } catch (e) { console.error(e); } } }

  load() {
    this.journal = findLog();
    this.sessions.clear();
    this.byMsg.clear();
    if (this.journal) for (const page of this.journal.pages) this._loadPage(page);
    this.loaded = true;
    return this;
  }

  refresh() { return this.load(); }

  _loadPage(page) {
    const { key, meta, records } = readPage(page);
    const existing = this.sessions.get(key);
    if (existing) for (const r of existing.records) this._unindex(r);
    const entry = { records, ids: new Set(records.map((r) => r.id)), meta, pageId: page.id };
    this.sessions.set(key, entry);
    for (const r of records) this._index(r);
    return key;
  }

  /** Called from the updateJournalEntryPage / createJournalEntryPage hooks (non-writer clients, or other GMs). */
  reloadPage(page) {
    if (!this.journal || page.parent?.id !== this.journal.id) {
      // The log may have been created after we loaded.
      const journal = findLog();
      if (!journal || page.parent?.id !== journal.id) return null;
      this.journal = journal;
    }
    if (!this.queue.idle) return null; // our own write echoing back; memory is already current
    const key = this._loadPage(page);
    this._emit(key);
    return key;
  }

  forgetPage(page) {
    for (const [key, s] of this.sessions) {
      if (s.pageId === page.id) { for (const r of s.records) this._unindex(r); this.sessions.delete(key); this._emit(key); return key; }
    }
    return null;
  }

  _index(r) { const list = this.byMsg.get(r.msgId) ?? []; list.push(r); this.byMsg.set(r.msgId, list); }
  _unindex(r) { const list = this.byMsg.get(r.msgId); if (!list) return; const i = list.indexOf(r); if (i >= 0) list.splice(i, 1); if (!list.length) this.byMsg.delete(r.msgId); }

  currentKey() { return sessionKeyFor(Date.now(), bucketOptions()); }

  has(id) { const msgId = String(id).split(":")[0]; return (this.byMsg.get(msgId) ?? []).some((r) => r.id === id); }

  /** Latest record whose id starts with `${baseId}:` (Toolbelt save sequence numbers). */
  existing(baseId) {
    const msgId = String(baseId).split(":")[0];
    const matches = (this.byMsg.get(msgId) ?? []).filter((r) => r.id.startsWith(`${baseId}:`));
    return matches.sort((a, b) => Number(b.id.split(":").pop()) - Number(a.id.split(":").pop()))[0];
  }

  listSessions() {
    return [...this.sessions.entries()].map(([key, s]) => ({
      key,
      label: s.meta?.label || sessionLabel(key),
      autoLabel: sessionLabel(key),
      n: s.records.length,
      excluded: s.meta?.excluded === true,
      firstTs: s.records.length ? Math.min(...s.records.map((r) => r.ts)) : null,
      lastTs: s.records.length ? Math.max(...s.records.map((r) => r.ts)) : null,
    })).sort((a, b) => compareKeys(b.key, a.key));
  }

  getSession(key) { return this.sessions.get(key)?.records ?? []; }
  getMeta(key) { return this.sessions.get(key)?.meta ?? {}; }

  _session(key) {
    let s = this.sessions.get(key);
    if (!s) { s = { records: [], ids: new Set(), meta: {}, pageId: null }; this.sessions.set(key, s); }
    return s;
  }

  /**
   * GM only. Upsert by id; unchanged records are ignored. Returns the session keys that changed.
   * @param {import("../types.js").RollRecord[]} records
   */
  async append(records) {
    if (!game.user.isGM) return [];
    const touched = new Set();
    for (const r of records) {
      const s = this._session(r.sessionKey);
      const idx = s.records.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        const merged = { ...s.records[idx], ...r };
        if (JSON.stringify(merged) === JSON.stringify(s.records[idx])) continue;
        this._unindex(s.records[idx]);
        s.records[idx] = merged;
        this._index(merged);
      } else {
        s.records.push(r);
        s.ids.add(r.id);
        this._index(r);
      }
      touched.add(r.sessionKey);
    }
    for (const key of touched) {
      this.queue.schedule(key, (k) => this._flush(k));
      this._emit(key);
    }
    return [...touched];
  }

  async _flush(key) {
    this.journal ??= await ensureLog();
    const s = this.sessions.get(key);
    if (!s) return;
    let text = "";
    try { text = pageSummaryHtml(key, s.records, s.meta); } catch (e) { console.warn("d20 tracker | page text skipped", e); }
    const page = await writePage(this.journal, key, s.records, s.meta, text);
    s.pageId = page.id;
  }

  flush() { return this.queue.flush(); }

  async setMeta(key, patch) {
    if (!game.user.isGM) return;
    const s = this._session(key);
    s.meta = { ...s.meta, ...patch };
    this.journal ??= await ensureLog();
    if (s.pageId && !("label" in patch)) await writeMeta(this.journal, key, s.meta); else await this._flush(key); // a rename also retitles the page
    this._emit(key);
  }

  async deleteSession(key) {
    if (!game.user.isGM) return;
    const s = this.sessions.get(key);
    if (s) for (const r of s.records) this._unindex(r);
    this.sessions.delete(key);
    if (this.journal) await deletePage(this.journal, key);
    this._emit(key);
  }

  async deleteAll() {
    if (!game.user.isGM) return;
    const journal = findLog();
    if (journal) await journal.delete();
    this.journal = null;
    this.sessions.clear();
    this.byMsg.clear();
    this._emit(null);
  }
}
