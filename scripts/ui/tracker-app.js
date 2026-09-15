// The tracker window: ApplicationV2 + HandlebarsApplicationMixin, tabs Tonight / Sessions (Fun and
// History arrive in M3/M3.5). All numbers come from the pure view-model; this file only wires Foundry.
import { MODULE_ID } from "../constants.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { buildSessionModel } from "./view-model.js";
import { buildFunModel } from "./fun-model.js";
import { decorateFunGroup, decorateAwards } from "./fun-decorate.js";
import { postSummary } from "./summary-card.js";
import { viewOptionsFor } from "./view-options.js";
import { sessionLabel } from "../sessions/bucket.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (name) => `modules/${MODULE_ID}/templates/tracker/${name}.hbs`;

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
      postSummary: TrackerApp.#onPostSummary,
    },
  };

  static PARTS = {
    header: { template: T("header") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    tonight: { template: T("tonight"), scrollable: [".tonight-body"] },
    fun: { template: T("fun"), scrollable: [".fun-body"] },
    sessions: { template: T("sessions"), scrollable: [".sessions-body"] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "tonight", icon: "fa-solid fa-fire", label: "PF2E-D20.Tabs.Tonight" },
        { id: "fun", icon: "fa-solid fa-trophy", label: "PF2E-D20.Tabs.Fun" },
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

  /** Re-render if this session (or any, when null) is what is displayed. */
  notify(sessionKey = null) {
    if (!this.rendered) return;
    if (sessionKey && this.sessionKey && sessionKey !== this.sessionKey) return this.render({ parts: ["header", "sessions"] });
    return this.render({ parts: ["header", "tonight", "sessions"] });
  }

  _viewOptions() {
    return viewOptionsFor(this.source);
  }

  _sessionList() {
    const all = this.source.listSessions();
    const min = getSetting(SETTINGS.minRollsToList);
    const current = this.source.currentKey();
    const list = this.showAll ? all : all.filter((s) => (s.n >= min && !s.excluded) || s.key === current || s.key === this.sessionKey);
    if (!list.some((s) => s.key === current)) list.unshift({ key: current, label: sessionLabel(current), n: 0, firstTs: null, lastTs: null, empty: true });
    return list;
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
    context.fun = activeTab === "fun" ? this._funModel(records, opts) : { empty: true, deferred: true };
    Object.assign(context, {
      isGM: game.user.isGM,
      preview: this.source.kind === "preview",
      captureEnabled: getSetting(SETTINGS.captureEnabled),
      sessions: sessions.map((s) => ({ ...s, selected: s.key === this.sessionKey, isCurrent: s.key === this.source.currentKey() })),
      sessionKey: this.sessionKey,
      sessionLabel: sessionLabel(this.sessionKey),
      showAll: this.showAll,
      opts,
      model: this._decorate(model),
    });
    return context;
  }

  _decorate(model) {
    const row = (r) => ({
      ...r,
      expanded: this.expanded.has(r.id),
      bandLabel: game.i18n.localize(`PF2E-D20.Band.${r.band}`),
      thin: r.luck.zGuard === "thin",
      none: r.luck.zGuard === "none",
      histBars: r.hist.map((c, i) => ({ face: i + 1, count: c, pct: Math.round((c / Math.max(1, Math.max(...r.hist))) * 100) })),
      types: Object.entries(r.byType).sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n })),
    });
    return { ...model, party: row(model.party), rows: model.rows.map(row) };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const select = this.element.querySelector('select[name="session"]');
    select?.addEventListener("change", (ev) => { this.sessionKey = ev.currentTarget.value; this.render({ parts: ["header", "tonight", "fun"] }); });
  }

  /** Switching to the Fun tab computes its model on demand (Monte Carlo), so re-render that part. */
  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    if (tab === "fun") this.render({ parts: ["fun"] });
  }

  static async #onSetGroupBy(_event, target) { await setSetting(SETTINGS.groupBy, target.dataset.value); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onSetCountMode(_event, target) { await setSetting(SETTINGS.countMode, target.dataset.value); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onToggleGM() { await setSetting(SETTINGS.includeGM, !getSetting(SETTINGS.includeGM)); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onToggleRaw() { await setSetting(SETTINGS.includeRaw, !getSetting(SETTINGS.includeRaw)); this.render({ parts: ["header", "tonight", "fun"] }); }
  static async #onPostSummary() {
    if (!game.user.isGM) return;
    const whisper = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("PF2E-D20.Summary.Post") },
      content: `<p>${game.i18n.localize("PF2E-D20.Summary.PostHint")}</p>`,
      buttons: [
        { action: "public", label: game.i18n.localize("PF2E-D20.Summary.Public"), icon: "fa-solid fa-comments", default: true },
        { action: "whisper", label: game.i18n.localize("PF2E-D20.Summary.Whisper"), icon: "fa-solid fa-user-secret" },
        { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" },
      ],
      rejectClose: false,
    });
    if (whisper !== "public" && whisper !== "whisper") return;
    await postSummary(this.source, this.sessionKey, { whisper: whisper === "whisper" });
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
