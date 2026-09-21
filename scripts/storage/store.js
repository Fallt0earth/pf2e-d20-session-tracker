// JournalStore: the persistent data source. Read interface for every client (listSessions /
// getSession / currentKey / …) plus GM-only writes through a debounced serial queue so bursts become
// one page update and writes never overlap. Session keys come from the pure Sessionizer (M5), seeded
// with the time spans of the stored sessions, so live capture, catch-up and re-bucketing agree.
import { sessionLabel, localDateKey, isSessionKey, UNSCHEDULED } from "../sessions/bucket.js";
import { Sessionizer, rebucket, rebucketDiff, nextFreeKey, chronological } from "../sessions/sessionizer.js";
import { sessionConfig, setSetting, SETTINGS } from "../settings.js";
import { WriteQueue } from "../util/queue.js";
import { findLog, ensureLog, readPage, writePage, writeMeta, deletePage } from "./journal.js";
import { pageSummaryHtml } from "./page-text.js";
import { mergeRecord } from "./merge.js";

/**
 * A session page is rewritten whole on every write, and any player can post rolls all night: a page
 * stops growing here (about 1.4 MB). A long evening of a large table is a few hundred dice.
 */
const MAX_RECORDS_PER_SESSION = 5000;

/**
 * @typedef {object} SessionEntry
 * @property {import("../types.js").RollRecord[]} records
 * @property {Set<string>} ids
 * @property {any} meta          { label?, excluded?, manual?: { startedTs, endedTs } }
 * @property {string|null} pageId
 * @property {number|null} firstTs
 * @property {number|null} lastTs
 */

export class JournalStore {
  constructor() {
    this.kind = "journal";
    /** @type {Map<string, SessionEntry>} */
    this.sessions = new Map();
    /** @type {Map<string, import("../types.js").RollRecord[]>} msgId → records (for id and existing() lookups) */
    this.byMsg = new Map();
    this.journal = null;
    this.loaded = false;
    this.queue = new WriteQueue({ debounceMs: 250, onError: (e, key) => console.error(`d20 tracker | write failed for ${key}`, e) });
    this.listeners = new Set();
    /** @type {Set<string>} sessions already reported as full */
    this._full = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(key) { for (const fn of this.listeners) { try { fn(key); } catch (e) { console.error(e); } } }

  // ---- loading and mirroring -------------------------------------------------------------------

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
    if (!isSessionKey(key)) return null; // a page someone added to the log by hand: not a session
    const existing = this.sessions.get(key);
    if (existing) for (const r of existing.records) this._unindex(r);
    const entry = { records, ids: new Set(records.map((r) => r.id)), meta, pageId: page.id, firstTs: null, lastTs: null };
    this._respan(entry);
    this.sessions.set(key, entry);
    for (const r of records) this._index(r);
    return key;
  }

  /** Called from the journal page hooks (non-writer clients, or other GMs). */
  reloadPage(page) {
    if (!this.journal || page.parent?.id !== this.journal.id) {
      const journal = findLog(); // the log may have been created after we loaded
      if (!journal || page.parent?.id !== journal.id) return null;
      this.journal = journal;
    }
    if (!this.queue.idle) return null; // our own write echoing back; memory is already current
    const key = this._loadPage(page);
    if (key !== null) this._emit(key);
    return key;
  }

  forgetPage(page) {
    if (!this.queue.idle) return null;
    for (const [key, s] of this.sessions) {
      if (s.pageId === page.id) { for (const r of s.records) this._unindex(r); this.sessions.delete(key); this._emit(key); return key; }
    }
    return null;
  }

  _index(r) { const list = this.byMsg.get(r.msgId) ?? []; list.push(r); this.byMsg.set(r.msgId, list); }
  _unindex(r) { const list = this.byMsg.get(r.msgId); if (!list) return; const i = list.indexOf(r); if (i >= 0) list.splice(i, 1); if (!list.length) this.byMsg.delete(r.msgId); }
  _respan(entry) {
    entry.firstTs = entry.records.length ? Math.min(...entry.records.map((r) => r.ts)) : null;
    entry.lastTs = entry.records.length ? Math.max(...entry.records.map((r) => r.ts)) : null;
  }

  // ---- session definition ------------------------------------------------------------------------

  config() { return sessionConfig(); }

  intervals() {
    return [...this.sessions.entries()].map(([key, s]) => ({ key, firstTs: s.firstTs, lastTs: s.lastTs, manual: s.meta?.manual ?? null }));
  }

  /** A fresh assigner over the current definition and stored sessions (use one per batch). */
  sessionizer() { return new Sessionizer(this.config(), this.intervals()); }

  /** The session a timestamp belongs to under the current definition (records nothing). */
  assignKey(ts) { return this.sessionizer().peek(ts); }

  /** The running session, or null (gap: last roll older than the gap; manual: none open). */
  currentKey() { return this.sessionizer().current(Date.now()); }

  // ---- reads ---------------------------------------------------------------------------------------

  find(id) { const msgId = String(id).split(":")[0]; return (this.byMsg.get(msgId) ?? []).find((r) => r.id === id) ?? null; }
  has(id) { return !!this.find(id); }

  /** Latest record whose id starts with `${baseId}:` (Toolbelt save sequence numbers). */
  existing(baseId) {
    const msgId = String(baseId).split(":")[0];
    const matches = (this.byMsg.get(msgId) ?? []).filter((r) => r.id.startsWith(`${baseId}:`));
    return matches.sort((a, b) => Number(b.id.split(":").pop()) - Number(a.id.split(":").pop()))[0];
  }

  listSessions() {
    const list = [...this.sessions.entries()].map(([key, s]) => ({
      key,
      label: s.meta?.label || sessionLabel(key),
      autoLabel: sessionLabel(key),
      n: s.records.length,
      excluded: s.meta?.excluded === true,
      unscheduled: key === UNSCHEDULED,
      manual: s.meta?.manual ?? null,
      firstTs: s.firstTs,
      lastTs: s.lastTs,
    }));
    return chronological(list).reverse(); // newest first; keys are identifiers, not a timeline
  }

  getSession(key) { return this.sessions.get(key)?.records ?? []; }
  getMeta(key) { return this.sessions.get(key)?.meta ?? {}; }

  /** The session played just before this one (by first roll, not by key), for "merge with previous". */
  previousKey(key) {
    const keys = chronological(this.intervals().filter((s) => s.key !== UNSCHEDULED)).map((s) => s.key);
    const i = keys.indexOf(key);
    return i > 0 ? keys[i - 1] : null;
  }

  _session(key) {
    let s = this.sessions.get(key);
    if (!s) { s = { records: [], ids: new Set(), meta: {}, pageId: null, firstTs: null, lastTs: null }; this.sessions.set(key, s); }
    return s;
  }

  // ---- writes (GM only) ----------------------------------------------------------------------------

  /**
   * Upsert by id; unchanged records are ignored. A record whose id is already stored stays in the
   * session it was first put in, whatever key the caller computed. Returns the session keys touched.
   * @param {import("../types.js").RollRecord[]} records
   */
  async append(records) {
    if (!game.user.isGM) return [];
    const touched = new Set();
    for (const incoming of records) {
      const known = this.find(incoming.id);
      let r = known && known.sessionKey !== incoming.sessionKey ? { ...incoming, sessionKey: known.sessionKey } : incoming;
      const s = this._session(r.sessionKey);
      const idx = s.records.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        const merged = mergeRecord(s.records[idx], r); // the stored die, time and roller are settled
        if (JSON.stringify(merged) === JSON.stringify(s.records[idx])) continue;
        this._unindex(s.records[idx]);
        s.records[idx] = merged;
        this._index(merged);
        r = merged;
      } else {
        if (s.records.length >= MAX_RECORDS_PER_SESSION) { this._warnFull(r.sessionKey); continue; }
        s.records.push(r);
        s.ids.add(r.id);
        this._index(r);
      }
      s.firstTs = s.firstTs === null ? r.ts : Math.min(s.firstTs, r.ts);
      s.lastTs = s.lastTs === null ? r.ts : Math.max(s.lastTs, r.ts);
      touched.add(r.sessionKey);
    }
    for (const key of touched) { this.queue.schedule(key, (k) => this._flush(k)); this._emit(key); }
    return [...touched];
  }

  /** Once per session and page load: the session holds all it will take (see MAX_RECORDS_PER_SESSION). */
  _warnFull(key) {
    if (this._full.has(key)) return;
    this._full.add(key);
    console.warn(`d20 tracker | session ${key} holds ${MAX_RECORDS_PER_SESSION} dice; further rolls are not recorded`);
    ui.notifications?.warn(game.i18n.format("PF2E-D20.Sessions.Full", { label: sessionLabel(key), max: MAX_RECORDS_PER_SESSION }));
  }

  async _flush(key) {
    this.journal ??= await ensureLog();
    const s = this.sessions.get(key);
    if (!s) { await deletePage(this.journal, key); return; }
    if (!s.records.length && !s.meta?.manual && !s.meta?.label) { // an emptied session leaves no page behind
      await deletePage(this.journal, key);
      this.sessions.delete(key);
      return;
    }
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

  // ---- moving records between sessions ---------------------------------------------------------------

  /** Move the records matching `predicate` from one session to another; returns how many moved. */
  async moveRecords(fromKey, toKey, predicate = () => true) {
    if (!game.user.isGM || fromKey === toKey) return 0;
    const from = this.sessions.get(fromKey);
    if (!from) return 0;
    const moving = from.records.filter(predicate);
    if (!moving.length) return 0;
    const to = this._session(toKey);
    for (const r of moving) {
      this._unindex(r);
      from.ids.delete(r.id);
      const moved = { ...r, sessionKey: toKey };
      to.records.push(moved);
      to.ids.add(moved.id);
      this._index(moved);
    }
    const gone = new Set(moving.map((r) => r.id));
    from.records = from.records.filter((r) => !gone.has(r.id));
    this._respan(from);
    this._respan(to);
    this.queue.schedule(fromKey, (k) => this._flush(k));
    this.queue.schedule(toKey, (k) => this._flush(k));
    await this.flush();
    this._emit(null);
    return moving.length;
  }

  /** Fold a session into another (its manual interval, if any, extends the target's). */
  async mergeSessions(fromKey, intoKey) {
    const from = this.sessions.get(fromKey), into = this.sessions.get(intoKey);
    if (!from || !into) return 0;
    const a = from.meta?.manual, b = into.meta?.manual;
    if (a && b) into.meta = { ...into.meta, manual: { startedTs: Math.min(a.startedTs, b.startedTs), endedTs: a.endedTs === null || b.endedTs === null ? null : Math.max(a.endedTs, b.endedTs) } };
    from.meta = { ...from.meta, manual: undefined, label: undefined };
    const n = await this.moveRecords(fromKey, intoKey);
    if (this.sessions.has(fromKey)) await this.deleteSession(fromKey);
    return n;
  }

  /** Records at or after `ts` become a new session; returns its key (or null when nothing would move). */
  async splitSession(key, ts) {
    const s = this.sessions.get(key);
    if (!s) return null;
    const moving = s.records.filter((r) => r.ts >= ts);
    if (!moving.length || moving.length === s.records.length) return null;
    const first = Math.min(...moving.map((r) => r.ts));
    const newKey = nextFreeKey(localDateKey(first, this.config().timezone), this.sessions);
    const m = s.meta?.manual;
    if (m) {
      this._session(newKey).meta = { manual: { startedTs: ts, endedTs: m.endedTs } };
      s.meta = { ...s.meta, manual: { startedTs: m.startedTs, endedTs: ts - 1 } };
    }
    await this.moveRecords(key, newKey, (r) => r.ts >= ts);
    return newKey;
  }

  // ---- manual sessions -------------------------------------------------------------------------------

  async startManual(now = Date.now()) {
    if (!game.user.isGM) return null;
    const cfg = this.config();
    if (cfg.manualOpen) return cfg.manualOpen.key;
    const key = nextFreeKey(localDateKey(now, cfg.timezone), this.sessions);
    await this.setMeta(key, { manual: { startedTs: now, endedTs: null } });
    await setSetting(SETTINGS.manualSession, { key, startedTs: now });
    return key;
  }

  async endManual(endTs = Date.now()) {
    if (!game.user.isGM) return;
    const open = this.config().manualOpen;
    if (!open) return;
    const s = this.sessions.get(open.key);
    if (s?.meta?.manual) await this.setMeta(open.key, { manual: { startedTs: s.meta.manual.startedTs, endedTs: Math.max(endTs, s.lastTs ?? 0, s.meta.manual.startedTs) } });
    await setSetting(SETTINGS.manualSession, {});
  }

  /** A forgotten End: close the running manual session at its last roll once the gap has passed. */
  async autoCloseManual(now = Date.now()) {
    if (!game.user.isGM) return false;
    const sz = this.sessionizer();
    const open = sz.config.manualOpen;
    if (!open || !sz.manualExpired(now)) return false;
    const s = this.sessions.get(open.key);
    await this.endManual(Math.max(s?.lastTs ?? 0, open.startedTs));
    return true;
  }

  // ---- re-bucketing stored history ---------------------------------------------------------------------

  /** What re-applying the current definition would do. Pure computation; nothing is written. */
  planRebucket() {
    const before = new Map([...this.sessions.entries()].map(([k, s]) => [k, s.records]));
    const all = [...before.values()].flat();
    const after = rebucket(all, this.config(), { manualSessions: this.intervals() });
    return { before, after, diff: rebucketDiff(before, after) };
  }

  /** Apply a plan from planRebucket(): meta survives where a key survives; emptied pages disappear. */
  async applyRebucket(after) {
    if (!game.user.isGM) return;
    const oldMeta = new Map([...this.sessions.entries()].map(([k, s]) => [k, { meta: s.meta, pageId: s.pageId }]));
    const oldKeys = [...this.sessions.keys()];
    this.byMsg.clear();
    const next = new Map();
    for (const [key, records] of after) {
      const kept = oldMeta.get(key);
      const entry = { records, ids: new Set(records.map((r) => r.id)), meta: kept?.meta ?? {}, pageId: kept?.pageId ?? null, firstTs: null, lastTs: null };
      this._respan(entry);
      next.set(key, entry);
      for (const r of records) this._index(r);
    }
    for (const key of oldKeys) { // empty manual sessions keep their page
      const kept = oldMeta.get(key);
      if (!next.has(key) && kept?.meta?.manual) next.set(key, { records: [], ids: new Set(), meta: kept.meta, pageId: kept.pageId, firstTs: null, lastTs: null });
    }
    this.sessions = next;
    for (const key of new Set([...oldKeys, ...next.keys()])) this.queue.schedule(key, (k) => this._flush(k));
    await this.flush();
    this._emit(null);
  }
}
