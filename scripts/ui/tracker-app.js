// The tracker window: ApplicationV2 + HandlebarsApplicationMixin, tabs Tonight / Sessions (Fun and
// History arrive in M3/M3.5). All numbers come from the pure view-model; this file only wires Foundry.
import { MODULE_ID } from "../constants.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { buildSessionModel } from "./view-model.js";
import { buildFunModel } from "./fun-model.js";
import { buildHistoryModel } from "./history-model.js";
import { decorateFunGroup, decorateAwards } from "./fun-decorate.js";
import { decorateRow, partySentence, luckPercent } from "./tonight-decorate.js";
import { exportRecords } from "./export.js";
import { viewOptionsFor } from "./view-options.js";
import { sessionLabel, wallClock, isValidTimezone, UNSCHEDULED } from "../sessions/bucket.js";
import { dailyExample, boundaryForUsualStart } from "../sessions/sessionizer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (name) => `modules/${MODULE_ID}/templates/tracker/${name}.hbs`;
/** How long after the last data change an open window redraws (bursts of rolls become one render). */
export const RENDER_DELAY_MS = 300;

export class TrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf2e-d20-session-tracker",
    classes: ["pf2e-d20-tracker"],
    window: { title: "PF2E-D20.Title", icon: "fa-solid fa-dice-d20", resizable: true },
    position: { width: 760, height: 640 },
    actions: {
      setGroupBy: TrackerApp.#onSetGroupBy,
      setCountMode: TrackerApp.#onSetCountMode,
      toggleGM: TrackerApp.#onToggleGM,
      toggleRaw: TrackerApp.#onToggleRaw,
      toggleExpand: TrackerApp.#onToggleExpand,
      toggleShowAll: TrackerApp.#onToggleShowAll,
      refresh: TrackerApp.#onRefresh,
      togglePause: TrackerApp.#onTogglePause,
      selectSession: TrackerApp.#onSelectSession,
      catchUp: TrackerApp.#onCatchUp,
      renameSession: TrackerApp.#onRenameSession,
      toggleExclude: TrackerApp.#onToggleExclude,
      deleteSession: TrackerApp.#onDeleteSession,
      resetAll: TrackerApp.#onResetAll,
      openReport: TrackerApp.#onOpenReport,
      exportSession: TrackerApp.#onExport,
      exportAll: TrackerApp.#onExport,
      startSession: TrackerApp.#onStartSession,
      endSession: TrackerApp.#onEndSession,
      applyUsualStart: TrackerApp.#onApplyUsualStart,
      rebucket: TrackerApp.#onRebucket,
      mergePrevious: TrackerApp.#onMergePrevious,
      splitSession: TrackerApp.#onSplitSession,
      assignUnscheduled: TrackerApp.#onAssignUnscheduled,
      discardUnscheduled: TrackerApp.#onDiscardUnscheduled,
    },
  };

  static PARTS = {
    header: { template: T("header") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    tonight: { template: T("tonight"), scrollable: [".tonight-body"] },
    fun: { template: T("fun"), scrollable: [".fun-body"] },
    history: { template: T("history"), scrollable: [".history-body"] },
    sessions: { template: T("sessions"), scrollable: [".sessions-body"] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "tonight", icon: "fa-solid fa-fire", label: "PF2E-D20.Tabs.Tonight" },
        { id: "fun", icon: "fa-solid fa-trophy", label: "PF2E-D20.Tabs.Fun" },
        { id: "history", icon: "fa-solid fa-chart-line", label: "PF2E-D20.Tabs.History" },
        { id: "sessions", icon: "fa-solid fa-calendar-days", label: "PF2E-D20.Tabs.Sessions" },
      ],
      initial: "tonight",
    },
  };

  /** @param {{ source: { listSessions(): any[], getSession(key: string): any[], currentKey(): string, kind: string, refresh(): any } }} options */
  constructor(options = {}) {
    super(options);
    this.source = options.source;
    this.sessionKey = null;
    this.expanded = new Set();
    this.showAll = false;
    this.funCache = { key: null, value: null };
    this.pendingParts = new Set();
    this.renderTimer = null;
  }

  /** Fun model for the selected session, memoized by session, record count and view options. */
  _funModel(records, opts) {
    const iterations = getSetting(SETTINGS.mcIterations);
    const sig = JSON.stringify([this.sessionKey, records.length, records.at(-1)?.id, opts.countMode, opts.groupBy, opts.includeGM, opts.includeRaw, opts.viewer.userId, iterations]);
    if (this.funCache.key === sig) return this.funCache.value;
    const t0 = performance.now();
    const model = buildFunModel(records, opts, { iterations, seed: this.sessionKey });
    const byId = new Map([...model.groups.map((g) => [g.id, g]), ["party", model.party]]);
    const value = {
      empty: model.empty,
      iterations,
      party: decorateFunGroup(model.party),
      groups: model.groups.map(decorateFunGroup),
      awards: decorateAwards(model.awards, byId),
      ms: Math.round(performance.now() - t0),
    };
    this.funCache = { key: sig, value };
    return value;
  }

  /**
   * The data changed: re-render what shows it, once the burst is over. Rolls arrive in bursts
   * (initiative for a whole encounter, "Roll NPC Saves"), so the parts to redraw are collected and
   * drawn together RENDER_DELAY_MS after the last change. The active tab is included, so a Fun or
   * History tab that is being watched stays current; the others cost nothing until they are opened.
   */
  notify(sessionKey = null) {
    if (!this.rendered) return;
    const mine = !sessionKey || !this.sessionKey || sessionKey === this.sessionKey;
    for (const p of mine ? ["header", "tonight", "sessions"] : ["header", "sessions"]) this.pendingParts.add(p);
    const active = this.tabGroups.primary;
    if (mine && (active === "fun" || active === "history")) this.pendingParts.add(active);
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      const parts = [...this.pendingParts];
      this.pendingParts.clear();
      if (this.rendered) this.render({ parts });
    }, RENDER_DELAY_MS);
  }

  async close(options) {
    clearTimeout(this.renderTimer);
    this.pendingParts.clear();
    return super.close(options);
  }

  _viewOptions() {
    return viewOptionsFor(this.source);
  }

  _sessionList() {
    const unscheduledLabel = game.i18n.localize("PF2E-D20.Sessions.Unscheduled");
    const all = this.source.listSessions().map((s) => (s.unscheduled ? { ...s, label: unscheduledLabel, autoLabel: unscheduledLabel } : s));
    const min = getSetting(SETTINGS.minRollsToList);
    const current = this.source.currentKey(); // null when no session is running (gap and manual modes)
    const list = this.showAll ? all : all.filter((s) => (s.n >= min && !s.excluded && !s.unscheduled) || s.key === current || s.key === this.sessionKey);
    if (current && !list.some((s) => s.key === current)) list.unshift({ key: current, label: sessionLabel(current), autoLabel: sessionLabel(current), n: 0, firstTs: null, lastTs: null, empty: true });
    return list;
  }

  /** The GM-facing session definition panel and the manual Start/End state. */
  _definitionContext() {
    const cfg = this.source.config();
    const L = (k, d) => (d ? game.i18n.format(`PF2E-D20.Definition.${k}`, d) : game.i18n.localize(`PF2E-D20.Definition.${k}`));
    let preview;
    if (cfg.mode === "gap") preview = L("PreviewGap", { hours: cfg.gapHours });
    else if (cfg.mode === "manual") preview = L("PreviewManual", { hours: cfg.gapHours });
    else {
      const ex = dailyExample(cfg.boundaryHour);
      preview = ex ? L("PreviewDaily", { boundary: ex.boundary, tz: cfg.timezone, time: ex.exampleTime }) : L("PreviewDailyMidnight", { tz: cfg.timezone });
    }
    const open = cfg.manualOpen;
    return {
      mode: cfg.mode, isDaily: cfg.mode === "daily", isGap: cfg.mode === "gap", isManual: cfg.mode === "manual",
      gapHours: cfg.gapHours, timezone: cfg.timezone, boundaryHour: cfg.boundaryHour, preview,
      manualOpen: !!open, manualSince: open ? this._clock(open.startedTs) : null, manualKey: open?.key ?? null,
      sessionWord: game.i18n.localize(cfg.mode === "daily" ? "PF2E-D20.Controls.Session" : "PF2E-D20.Controls.SessionGeneric"),
    };
  }

  /** HH:MM in the world timezone. */
  _clock(ts) {
    const w = wallClock(ts, this.source.config().timezone);
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs("primary");
    const sessions = this._sessionList();
    if (!this.sessionKey || !sessions.some((s) => s.key === this.sessionKey)) {
      const newest = sessions.find((s) => !s.empty) ?? sessions[0];
      this.sessionKey = newest?.key ?? this.source.currentKey();
    }
    const opts = this._viewOptions();
    const records = this.source.getSession(this.sessionKey);
    const model = buildSessionModel(records, opts);
    const activeTab = this.tabGroups.primary ?? TrackerApp.TABS.primary.initial;
    // The Fun model runs the Monte Carlo and History walks every stored evening: only when that part
    // is being drawn now (a partial render of the other parts never pays for them).
    const drawing = (part) => !options.parts || options.parts.includes(part);
    context.fun = activeTab === "fun" && drawing("fun") ? this._funModel(records, opts) : { empty: true, deferred: true };
    context.history = activeTab === "history" && drawing("history") ? this._historyModel(opts) : { empty: true, deferred: true };
    const current = this.source.currentKey();
    const hasTargets = this.source.listSessions().some((s) => !s.unscheduled);
    Object.assign(context, {
      def: this._definitionContext(),
      playerAccess: getSetting(SETTINGS.playerAccess),
      isGM: game.user.isGM,
      preview: this.source.kind === "preview",
      captureEnabled: getSetting(SETTINGS.captureEnabled),
      sessions: sessions.map((s) => ({ ...s, selected: s.key === this.sessionKey, isCurrent: !!current && s.key === current, canMerge: !s.unscheduled && !s.empty && !!this.source.previousKey?.(s.key), canSplit: !s.unscheduled && s.n > 1, hasTargets })),
      sessionKey: this.sessionKey,
      sessionLabel: sessions.find((s) => s.key === this.sessionKey)?.label ?? sessionLabel(this.sessionKey),
      showAll: this.showAll,
      opts,
      model: this._decorate(model),
    });
    return context;
  }

  _decorate(model) {
    return {
      ...model,
      party: decorateRow(model.party),
      partySentence: partySentence(model.party),
      rows: model.rows.map((r) => decorateRow(r, { expanded: this.expanded.has(r.id) })),
    };
  }

  /** History across every non-excluded evening, decorated for the template. */
  _historyModel(opts) {
    const sessions = this.source.listSessions().filter((s) => !s.excluded && !s.unscheduled).reverse() // listSessions is newest first, by first roll
      .map((s) => ({ key: s.key, label: s.label, records: this.source.getSession(s.key) }));
    const m = buildHistoryModel(sessions, opts);
    const band = (b) => game.i18n.localize(`PF2E-D20.Band.${b}`);
    const spark = (points) => points.map((p) => {
      const z = p.zGuard === "none" || p.z === null ? 0 : Math.max(-3, Math.min(3, p.z));
      const pct = luckPercent(p);
      return { key: p.key, z: p.z === null ? "–" : p.z.toFixed(2), pct: pct === null ? "–" : `${pct}%`, n: p.n, h: Math.round((Math.abs(z) / 3) * 100), cls: z > 0 ? "pos" : z < 0 ? "neg" : "zero" };
    });
    const pctOf = (l) => { const p = luckPercent(l); return p === null ? null : p; };
    const zTitle = (l) => (l.z === null || l.z === undefined ? "" : game.i18n.format("PF2E-D20.Tonight.LuckTitle", { pct: pctOf(l) ?? "–", z: `${l.z > 0 ? "+" : ""}${l.z.toFixed(2)}` }));
    const groups = m.groups.map((g) => ({
      ...g, bandLabel: band(g.band), thin: g.allTime.zGuard === "thin", none: g.allTime.zGuard === "none",
      luckPct: pctOf(g.allTime), luckTitle: zTitle(g.allTime),
      bestPct: g.best ? pctOf(g.best) : null, worstPct: g.worst ? pctOf(g.worst) : null,
      nat20RateLabel: g.nat20Rate === null ? "–" : `${(g.nat20Rate * 100).toFixed(1)}%`,
      spark: spark(g.points),
    }));
    const sessionsOut = m.sessions.slice().reverse().map((s) => ({
      ...s,
      partyPct: pctOf(s.party), partyTitle: zTitle(s.party),
      cellList: m.groups.map((g) => { const c = s.cells[g.id]; return c ? { present: true, ...c, thin: c.zGuard === "thin", none: c.zGuard === "none", pct: pctOf(c), title: zTitle(c) } : { present: false }; }),
    }));
    const party = { ...m.party, bandLabel: band(m.party.band), evenings: m.sessions.length, luckPct: pctOf(m.party.allTime), luckTitle: zTitle(m.party.allTime), bestPct: m.party.best ? pctOf(m.party.best) : null, worstPct: m.party.worst ? pctOf(m.party.worst) : null };
    return { ...m, groups, sessions: sessionsOut, party };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const select = this.element.querySelector('select[name="session"]');
    select?.addEventListener("change", (ev) => { this.sessionKey = ev.currentTarget.value; this.render({ parts: ["header", "tonight", "fun"] }); });
    if (!game.user.isGM) return;
    // GM quick controls write world settings directly; every client follows through the setting's onChange.
    const bind = (selector, handler) => this.element.querySelector(selector)?.addEventListener("change", (ev) => handler(ev.currentTarget));
    bind('select[name="playerAccess"]', (el) => setSetting(SETTINGS.playerAccess, el.value));
    bind('select[name="sessionMode"]', async (el) => { if (el.value !== "manual") await this.source.endManual?.(); await setSetting(SETTINGS.sessionMode, el.value); });
    bind('input[name="sessionGapHours"]', (el) => { const v = Number(el.value); if (v >= 1 && v <= 24) setSetting(SETTINGS.sessionGapHours, v); });
    bind('input[name="boundaryHour"]', (el) => { const v = Math.trunc(Number(el.value)); if (v >= 0 && v <= 23) setSetting(SETTINGS.boundaryHour, v); });
    bind('input[name="timezone"]', (el) => {
      const tz = el.value.trim();
      if (isValidTimezone(tz)) setSetting(SETTINGS.timezone, tz);
      else { ui.notifications.warn(game.i18n.format("PF2E-D20.Definition.BadTimezone", { tz })); el.value = getSetting(SETTINGS.timezone); }
    });
  }

  /** The Fun and History tabs compute their models on demand, so re-render that part on switch. */
  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    if (tab === "fun" || tab === "history") this.render({ parts: [tab] });
  }

  static async #onStartSession() {
    if (!game.user.isGM) return;
    const key = await this.source.startManual();
    if (key) { this.sessionKey = key; this.render({ parts: ["header", "tonight", "sessions"] }); }
  }

  static async #onEndSession() {
    if (!game.user.isGM) return;
    await this.source.endManual();
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  /** "We usually start at HH" → put the day boundary 12 hours opposite, where a game is least likely to be running. */
  static async #onApplyUsualStart() {
    if (!game.user.isGM) return;
    const input = this.element.querySelector('input[name="usualStart"]');
    const hour = Math.trunc(Number(input?.value));
    if (!(hour >= 0 && hour <= 23)) return;
    await setSetting(SETTINGS.boundaryHour, boundaryForUsualStart(hour));
  }

  /** Re-apply the current session definition to every stored roll, after showing what would change. */
  static async #onRebucket() {
    if (!game.user.isGM) return;
    await this.source.flush();
    const { after, diff } = this.source.planRebucket();
    const L = (k, d) => (d ? game.i18n.format(`PF2E-D20.Definition.${k}`, d) : game.i18n.localize(`PF2E-D20.Definition.${k}`));
    if (!diff.moved) return ui.notifications.info(L("RebucketNothing"));
    const list = (rows) => `<ul>${rows.map((r) => `<li>${foundry.utils.escapeHTML(sessionLabel(r.key))}: <b>${r.n}</b></li>`).join("")}</ul>`;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("Rebucket") },
      content: `<p>${L("RebucketConfirm", { moved: diff.moved, created: diff.created.length, removed: diff.removed.length })}</p><div class="pf2e-d20-rebucket"><div><b>${L("Before")}</b>${list(diff.before)}</div><div><b>${L("After")}</b>${list(diff.after)}</div></div><p><small>${L("RebucketNote")}</small></p>`,
    });
    if (!ok) return;
    await this.source.applyRebucket(after);
    this.sessionKey = null;
    ui.notifications.info(L("RebucketDone", { moved: diff.moved }));
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static async #onMergePrevious(_event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key;
    const into = this.source.previousKey(key);
    if (!into) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PF2E-D20.Sessions.Merge") },
      content: `<p>${game.i18n.format("PF2E-D20.Sessions.MergeConfirm", { from: sessionLabel(key), into: sessionLabel(into) })}</p>`,
    });
    if (!ok) return;
    await this.source.mergeSessions(key, into);
    this.sessionKey = into;
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  /** Offer the longest pauses in the session as split points (no typing of times or timezones). */
  static async #onSplitSession(_event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key;
    const stamps = [...new Set(this.source.getSession(key).map((r) => r.ts))].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) gaps.push({ at: stamps[i], prev: stamps[i - 1], ms: stamps[i] - stamps[i - 1] });
    const options = gaps.filter((g) => g.ms >= 60_000).sort((a, b) => b.ms - a.ms).slice(0, 6).sort((a, b) => a.at - b.at);
    if (!options.length) return ui.notifications.info(game.i18n.localize("PF2E-D20.Sessions.SplitNone"));
    const mins = (ms) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m` : `${Math.round(ms / 60_000)}m`);
    const count = (ts) => this.source.getSession(key).filter((r) => r.ts >= ts).length;
    const choices = options.map((g, i) => `<label class="split-option"><input type="radio" name="at" value="${g.at}" ${i === 0 ? "checked" : ""}> ${game.i18n.format("PF2E-D20.Sessions.SplitOption", { pause: mins(g.ms), from: this._clock(g.prev), to: this._clock(g.at), after: count(g.at) })}</label>`).join("");
    const at = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("PF2E-D20.Sessions.Split") },
      content: `<p>${game.i18n.format("PF2E-D20.Sessions.SplitHint", { label: sessionLabel(key) })}</p>${choices}`,
      ok: { label: game.i18n.localize("PF2E-D20.Sessions.Split"), callback: (_ev, button) => Number(button.form.elements.at.value) },
      rejectClose: false,
    });
    if (!at) return;
    const newKey = await this.source.splitSession(key, at);
    if (newKey) this.sessionKey = newKey;
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static async #onAssignUnscheduled() {
    if (!game.user.isGM) return;
    const targets = this.source.listSessions().filter((s) => !s.unscheduled);
    if (!targets.length) return;
    const options = targets.map((s) => `<option value="${s.key}">${foundry.utils.escapeHTML(s.label)} (${s.n})</option>`).join("");
    const key = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("PF2E-D20.Sessions.AssignUnscheduled") },
      content: `<p>${game.i18n.localize("PF2E-D20.Sessions.AssignHint")}</p><select name="key">${options}</select>`,
      ok: { label: game.i18n.localize("PF2E-D20.Sessions.AssignUnscheduled"), callback: (_ev, button) => button.form.elements.key.value },
      rejectClose: false,
    });
    if (!key) return;
    await this.source.moveRecords(UNSCHEDULED, key);
    this.sessionKey = key;
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static async #onDiscardUnscheduled() {
    if (!game.user.isGM) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PF2E-D20.Sessions.DiscardUnscheduled") },
      content: `<p>${game.i18n.localize("PF2E-D20.Sessions.DiscardConfirm")}</p>`,
    });
    if (!ok) return;
    await this.source.deleteSession(UNSCHEDULED);
    if (this.sessionKey === UNSCHEDULED) this.sessionKey = null;
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static #onExport(_event, target) {
    const key = target.dataset.key ?? null;
    const format = target.dataset.format ?? "csv";
    const r = exportRecords(this.source, key, format);
    ui.notifications.info(game.i18n.format("PF2E-D20.Export.Done", { name: r.name, count: r.count }));
  }

  static async #onSetGroupBy(_event, target) { await setSetting(SETTINGS.groupBy, target.dataset.value); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onSetCountMode(_event, target) { await setSetting(SETTINGS.countMode, target.dataset.value); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onToggleGM() { await setSetting(SETTINGS.includeGM, !getSetting(SETTINGS.includeGM)); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onToggleRaw() { await setSetting(SETTINGS.includeRaw, !getSetting(SETTINGS.includeRaw)); this.render({ parts: ["header", "tonight", "fun"] }); }
  /** Opens the evening report in its own popup on this client only. Nothing is posted to chat. */
  static #onOpenReport() {
    game.modules.get(MODULE_ID)?.api?.openReport(this.sessionKey);
  }
  static #onToggleExpand(_event, target) {
    const id = target.dataset.id;
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.render({ parts: ["tonight"] });
  }
  static #onToggleShowAll() { this.showAll = !this.showAll; this.render({ parts: ["header", "sessions"] }); }
  static #onRefresh() { this.source.refresh?.(); this.render({ parts: ["header", "tonight", "sessions"] }); }
  static async #onTogglePause() {
    if (!game.user.isGM) return;
    await setSetting(SETTINGS.captureEnabled, !getSetting(SETTINGS.captureEnabled));
    this.render({ parts: ["header"] });
  }
  static #onSelectSession(_event, target) {
    this.sessionKey = target.dataset.key;
    this.tabGroups.primary = "tonight";
    this.render({ parts: ["header", "tabs", "tonight", "sessions"] });
  }

  static async #onCatchUp() {
    if (!game.user.isGM) return;
    const api = game.modules.get(MODULE_ID).api;
    const r = await api.catchUp();
    ui.notifications.info(game.i18n.format("PF2E-D20.Sessions.CatchUpDone", { added: r.added, scanned: r.scanned }));
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static async #onRenameSession(_event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key;
    const current = this.source.getMeta?.(key)?.label ?? "";
    const label = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("PF2E-D20.Sessions.Rename") },
      content: `<input type="text" name="label" value="${foundry.utils.escapeHTML(current)}" placeholder="${sessionLabel(key)}" autofocus>`,
      ok: { label: game.i18n.localize("PF2E-D20.Sessions.Rename"), callback: (_ev, button) => button.form.elements.label.value.trim() },
    });
    if (label === null || label === undefined) return;
    await this.source.setMeta(key, { label });
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static async #onToggleExclude(_event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key;
    const excluded = this.source.getMeta?.(key)?.excluded === true;
    await this.source.setMeta(key, { excluded: !excluded });
    this.render({ parts: ["header", "sessions"] });
  }

  static async #onDeleteSession(_event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.key;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PF2E-D20.Sessions.Delete") },
      content: `<p>${game.i18n.format("PF2E-D20.Sessions.DeleteConfirm", { label: sessionLabel(key) })}</p>`,
    });
    if (!ok) return;
    await this.source.deleteSession(key);
    if (this.sessionKey === key) this.sessionKey = null;
    this.render({ parts: ["header", "tonight", "sessions"] });
  }

  static async #onResetAll() {
    if (!game.user.isGM) return;
    const first = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize("PF2E-D20.Sessions.ResetAll") }, content: `<p>${game.i18n.localize("PF2E-D20.Sessions.ResetConfirm1")}</p>` });
    if (!first) return;
    const second = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize("PF2E-D20.Sessions.ResetAll") }, content: `<p><b>${game.i18n.localize("PF2E-D20.Sessions.ResetConfirm2")}</b></p>` });
    if (!second) return;
    await this.source.deleteAll();
    this.sessionKey = null;
    this.render({ parts: ["header", "tonight", "sessions"] });
  }
}
