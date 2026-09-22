// The evening report: its own popup window, opened only by an explicit click (the scroll button in
// the tracker, a chat link someone chose to click, or api.openReport()). Nothing is posted to chat
// unless the GM presses "post a link", and that is a single line with an Open button.
import { MODULE_ID } from "../constants.js";
import { getSetting, SETTINGS } from "../settings.js";
import { sessionLabel } from "../sessions/bucket.js";
import { buildSessionModel } from "./view-model.js";
import { buildFunModel } from "./fun-model.js";
import { viewOptionsFor } from "./view-options.js";
import { decorateRow, partySentence } from "./tonight-decorate.js";
import { decorateFunGroup, decorateAwards } from "./fun-decorate.js";
import { postReportLink } from "./report-link.js";
import { RENDER_DELAY_MS } from "./tracker-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ReportApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf2e-d20-tracker", "pf2e-d20-report"],
    window: { title: "PF2E-D20.Report.Title", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      shareLink: ReportApp.#onShareLink,
      openTracker: ReportApp.#onOpenTracker,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/tracker/report.hbs`, scrollable: [".report-body"] },
  };

  /** @param {{ source: object, sessionKey: string }} options */
  constructor(options = {}) {
    super({ ...options, id: `pf2e-d20-report-${String(options.sessionKey).replace(/[^A-Za-z0-9-]/g, "_")}` }); // an element id: "~" and the like become "_"
    this.source = options.source;
    this.sessionKey = options.sessionKey;
    this.funCache = { key: null, value: null };
    this.renderTimer = null;
  }

  /** The data changed: redraw once the burst is over (same delay as the tracker window). */
  notify() {
    if (!this.rendered) return;
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => { if (this.rendered) this.render(); }, RENDER_DELAY_MS);
  }

  async close(options) {
    clearTimeout(this.renderTimer);
    return super.close(options);
  }

  /** The Monte Carlo is the one expensive part of the report: keyed by what can change its result. */
  _funModel(records, opts) {
    const iterations = Math.min(getSetting(SETTINGS.mcIterations), 5000);
    const sig = JSON.stringify([this.sessionKey, records.length, records.at(-1)?.id, opts.countMode, opts.groupBy, opts.includeGM, opts.includeRaw, opts.viewer.userId, iterations]);
    if (this.funCache.key !== sig) this.funCache = { key: sig, value: buildFunModel(records, opts, { iterations, seed: this.sessionKey }) };
    return this.funCache.value;
  }

  get title() {
    return game.i18n.format("PF2E-D20.Report.WindowTitle", { label: this.source.getMeta?.(this.sessionKey)?.label || sessionLabel(this.sessionKey) });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const opts = viewOptionsFor(this.source);
    const records = this.source.getSession(this.sessionKey);
    const tonight = buildSessionModel(records, opts);
    const fun = this._funModel(records, opts);
    const byId = new Map([...fun.groups.map((g) => [g.id, g]), ["party", fun.party]]);
    const party = decorateRow(tonight.party);
    const partyFun = decorateFunGroup(fun.party);
    const highlights = [
      ...partyFun.streaks.map((s) => `${s.label}: ${s.length}${s.extra ? ` ${s.extra}` : ""}${s.when ? `, ${s.when}` : ""}${s.rarity ? ` (${s.rarity})` : ""}`),
      ...partyFun.moments.map((m) => `${m.label}: ${m.text}`),
      ...(partyFun.rerolls ? [`${game.i18n.localize("PF2E-D20.Fun.Rerolls")}: ${partyFun.rerolls.count}, ${game.i18n.format("PF2E-D20.Fun.NetPips", { pips: partyFun.rerolls.netGain })}`] : []),
    ];
    return Object.assign(context, {
      isGM: game.user.isGM,
      empty: tonight.empty,
      label: this.source.getMeta?.(this.sessionKey)?.label || sessionLabel(this.sessionKey),
      party,
      partySentence: partySentence(tonight.party),
      rows: tonight.rows.map((r) => decorateRow(r)),
      awards: decorateAwards(fun.awards, byId),
      highlights,
    });
  }

  static async #onShareLink() {
    if (!game.user.isGM) return;
    await postReportLink(this.sessionKey);
    ui.notifications.info(game.i18n.localize("PF2E-D20.Report.LinkPosted"));
  }

  static #onOpenTracker() {
    game.modules.get(MODULE_ID)?.api?.open();
  }
}
