// Entry point: settings, Handlebars helpers, the journal store, GM live capture, roller enrichment,
// tonight's catch-up, the window, entry points, API.
import { MODULE_ID, MODULE_TITLE } from "./constants.js";
import { registerSettings, getSetting, SETTINGS } from "./settings.js";
import { JournalStore } from "./storage/store.js";
import { registerLiveCapture, isWriter } from "./capture/live.js";
import { registerRollerEnrichment } from "./capture/roller-enrich.js";
import { catchUp } from "./backfill/catchup.js";
import { TrackerApp } from "./ui/tracker-app.js";
import { registerEntryPoints, canOpen } from "./ui/entry.js";
import { buildApi } from "./api.js";

let store = null;
let app = null;

function open() {
  if (!canOpen()) return ui.notifications.warn(game.i18n.localize("PF2E-D20.Settings.PlayerAccess.None"));
  if (!store.loaded) store.load();
  app ??= new TrackerApp({ source: store });
  app.render({ force: true });
  return app;
}

function registerHelpers() {
  const num = (v) => v === null || v === undefined || !Number.isFinite(Number(v));
  Handlebars.registerHelper("d20fixed", (v, digits) => (num(v) ? "–" : Number(v).toFixed(typeof digits === "number" ? digits : 2)));
  Handlebars.registerHelper("d20signed", (v, digits) => (num(v) ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(typeof digits === "number" ? digits : 2)}`));
  Handlebars.registerHelper("d20pct", (v) => (num(v) ? "–" : `${Math.round(v * 100)}%`));
  Handlebars.registerHelper("d20vs", (count, expected) => `${count} vs ${Number(expected).toFixed(1)}`);
  Handlebars.registerHelper("d20time", (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–"));
  Handlebars.registerHelper("d20eq", (a, b) => a === b);
}

Hooks.once("init", () => {
  registerSettings(() => app?.notify());
  registerHelpers();
  registerEntryPoints(open);
  registerRollerEnrichment();
  game.modules.get(MODULE_ID).api = buildApi({
    open,
    close: () => app?.close(),
    getSource: () => store,
    catchUp: (opts) => catchUp(store, opts),
  });
  console.log(`${MODULE_TITLE} | init v${game.modules.get(MODULE_ID)?.version ?? "?"}`);
});

Hooks.once("ready", async () => {
  store = new JournalStore().load();
  store.onChange((key) => app?.notify(key));

  // Every client mirrors journal changes (players never write; the GM sees other GMs' writes).
  Hooks.on("updateJournalEntryPage", (page) => store.reloadPage(page));
  Hooks.on("createJournalEntryPage", (page) => store.reloadPage(page));
  Hooks.on("deleteJournalEntryPage", (page) => store.forgetPage(page));
  Hooks.on("deleteJournalEntry", (journal) => { if (journal.id === store.journal?.id) store.load(); });
  // A freshly created log has no pages: adopt it without reloading (reloading would drop the writer's
  // in-memory records that are about to be written into it).
  Hooks.on("createJournalEntry", (journal) => { if (journal.flags?.[MODULE_ID]?.isLog && !store.journal) store.journal = journal; });

  if (game.user.isGM) registerLiveCapture(store);

  const role = isWriter() ? "writer" : game.user.isGM ? "gm (not writer)" : "player";
  console.log(`${MODULE_TITLE} | ready on Foundry ${game.version}, ${game.system.id} ${game.system.version} — ${role}, ${store.sessions.size} evenings stored, capture ${getSetting(SETTINGS.captureEnabled) ? "on" : "paused"}`);

  if (isWriter() && getSetting(SETTINGS.captureEnabled)) {
    try {
      const r = await catchUp(store);
      if (r.added) console.log(`${MODULE_TITLE} | catch-up added ${r.added} dice for ${r.key}`);
    } catch (e) { console.error(`${MODULE_TITLE} | catch-up failed`, e); }
  }
});
