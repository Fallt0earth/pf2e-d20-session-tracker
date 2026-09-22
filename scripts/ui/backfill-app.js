// The backfill dialog (GM only): a date range and the two junk-evening knobs, a preview of what each
// evening would gain with a tick per evening, a progress bar while the pages are written, and a
// summary. Adds only, never deletes; a re-run adds nothing. The work is in backfill/plan.js (pure)
// and backfill/backfill.js; this file only wires Foundry.
import { MODULE_ID } from "../constants.js";
import { getSetting, SETTINGS } from "../settings.js";
import { sessionLabel, wallClock } from "../sessions/bucket.js";
import { backfillBounds, backfillPlan, backfillRun } from "../backfill/backfill.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BackfillApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf2e-d20-backfill",
    classes: ["pf2e-d20-tracker", "pf2e-d20-backfill"],
    window: { title: "PF2E-D20.Backfill.Title", icon: "fa-solid fa-clock-rotate-left", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      preview: BackfillApp.#onPreview,
      run: BackfillApp.#onRun,
      back: BackfillApp.#onBack,
      finish: BackfillApp.#onFinish,
      tickAll: BackfillApp.#onTickAll,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/tracker/backfill.hbs`, scrollable: [".backfill-body"] },
  };

  /** @param {{ source: import("../storage/store.js").JournalStore }} options */
  constructor(options = {}) {
    super(options);
    this.source = options.source;
    this.phase = "form";           // form | scanning | preview | running | done
    this.inputs = null;            // the last values entered
    this.plan = null;
    this.progress = { label: "", done: 0, total: 1 };
    this.result = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.inputs) {
      const b = backfillBounds(this.source);
      this.inputs = { from: b.from, to: b.to, minRolls: getSetting(SETTINGS.minRollsToList), requireGM: true, messages: b.messages, timezone: b.timezone, manual: this.source.config().mode === "manual" };
    }
    const tz = this.source.config().timezone;
    const clock = (ts) => { const w = wallClock(ts, tz); return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`; };
    const why = (s) => {
      if (s.selected) return "";
      if (!s.gmPresent && this.inputs.requireGM) return game.i18n.localize("PF2E-D20.Backfill.WhyNoGM");
      if (s.n < this.inputs.minRolls) return game.i18n.format("PF2E-D20.Backfill.WhyFew", { min: this.inputs.minRolls });
      return "";
    };
    return Object.assign(context, {
      isForm: this.phase === "form",
      isBusy: this.phase === "scanning" || this.phase === "running",
      isPreview: this.phase === "preview",
      isDone: this.phase === "done",
      inputs: this.inputs,
      progress: this.progress,
      result: this.result,
      plan: this.plan && {
        empty: this.plan.sessions.length === 0,
        scanned: this.plan.scanned, skipped: this.plan.skipped, total: this.plan.total, count: this.plan.sessions.length,
        sessions: this.plan.sessions.map((s) => ({ key: s.key, label: sessionLabel(s.key), n: s.n, players: s.players, gmPresent: s.gmPresent, existing: s.existing, selected: s.selected, first: clock(s.firstTs), last: clock(s.lastTs), why: why(s) })),
      },
    });
  }

  /** Progress within a phase updates the bar in place; phase changes re-render. */
  _setProgress(label, done, total) {
    this.progress = { label, done, total: Math.max(1, total) };
    const bar = this.element?.querySelector("progress.backfill-progress");
    const text = this.element?.querySelector(".progress-label");
    if (bar) { bar.max = this.progress.total; bar.value = done; }
    if (text) text.textContent = label;
  }

  _readForm() {
    const q = (name) => this.element.querySelector(`[name="${name}"]`);
    const from = q("from")?.value || this.inputs.from;
    const to = q("to")?.value || this.inputs.to;
    const minRolls = Math.max(0, Math.trunc(Number(q("minRolls")?.value)) || 0);
    const requireGM = q("requireGM")?.checked ?? true;
    this.inputs = { ...this.inputs, from, to, minRolls, requireGM };
  }

  static async #onPreview() {
    if (!game.user.isGM) return;
    this._readForm();
    if (this.inputs.from > this.inputs.to) return ui.notifications.warn(game.i18n.localize("PF2E-D20.Backfill.BadRange"));
    this.phase = "scanning";
    this._setProgress(game.i18n.localize("PF2E-D20.Backfill.Scanning"), 0, 1);
    await this.render();
    try {
      this.plan = await backfillPlan(this.source, {
        from: this.inputs.from, to: this.inputs.to, minRolls: this.inputs.minRolls, requireGM: this.inputs.requireGM,
        onProgress: (p) => this._setProgress(game.i18n.format("PF2E-D20.Backfill.ScanProgress", { done: p.done, total: p.total }), p.done, p.total),
      });
      this.phase = "preview";
    } catch (e) {
      console.error(`d20 tracker | backfill plan failed`, e);
      ui.notifications.error(game.i18n.localize("PF2E-D20.Backfill.Failed"));
      this.phase = "form";
    }
    this.render();
  }

  static async #onRun() {
    if (!game.user.isGM || !this.plan) return;
    const keys = [...this.element.querySelectorAll('input[name="pick"]:checked')].map((el) => el.value);
    if (!keys.length) return ui.notifications.warn(game.i18n.localize("PF2E-D20.Backfill.NoneTicked"));
    this.phase = "running";
    this._setProgress(game.i18n.format("PF2E-D20.Backfill.Writing", { done: 0, total: keys.length, key: "" }), 0, keys.length);
    await this.render();
    try {
      this.result = await backfillRun(this.source, this.plan, keys, {
        onProgress: (p) => this._setProgress(game.i18n.format("PF2E-D20.Backfill.Writing", { done: p.done, total: p.total, key: sessionLabel(p.key) }), p.done, p.total),
      });
      this.phase = "done";
    } catch (e) {
      console.error(`d20 tracker | backfill failed`, e);
      ui.notifications.error(game.i18n.localize("PF2E-D20.Backfill.Failed"));
      this.phase = "preview";
    }
    this.render();
  }

  static #onBack() {
    this.phase = "form";
    this.plan = null;
    this.render();
  }

  static #onFinish() {
    this.close();
  }

  static #onTickAll(_event, target) {
    const on = target.dataset.value === "1";
    for (const el of this.element.querySelectorAll('input[name="pick"]')) { el.checked = on; el.closest("tr")?.classList.toggle("excluded", !on); }
  }
}
