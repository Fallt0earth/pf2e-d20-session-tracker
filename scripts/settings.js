// Settings (docs/PLAN.md §4.8) and the keybinding. World settings are GM-only by Foundry's rules.
import { MODULE_ID } from "./constants.js";
import { DEFAULT_TIMEZONE, DEFAULT_BOUNDARY_HOUR } from "./sessions/bucket.js";

export const SETTINGS = Object.freeze({
  timezone: "timezone",
  boundaryHour: "boundaryHour",
  captureEnabled: "captureEnabled",
  captureRawRolls: "captureRawRolls",
  minRollsToList: "minRollsToList",
  playerAccess: "playerAccess",
  blindPolicy: "blindPolicy",
  mcIterations: "mcIterations",
  logJournalId: "logJournalId",
  sessionIndex: "sessionIndex",
  schemaVersion: "schemaVersion",
  // client
  groupBy: "groupBy",
  countMode: "countMode",
  includeGM: "includeGM",
  includeRaw: "includeRaw",
  defaultTab: "defaultTab",
});

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export async function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/** Bucketing options as configured for this world. */
export function bucketOptions() {
  return { timezone: getSetting(SETTINGS.timezone), boundaryHour: getSetting(SETTINGS.boundaryHour) };
}

export function registerSettings(onChange = () => {}) {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, onChange, ...data });
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: false, onChange, ...data });
  const hidden = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: false, ...data });
  const L = (k) => `PF2E-D20.Settings.${k}`;

  world(SETTINGS.timezone, { name: L("Timezone.Name"), hint: L("Timezone.Hint"), type: String, default: DEFAULT_TIMEZONE });
  world(SETTINGS.boundaryHour, { name: L("BoundaryHour.Name"), hint: L("BoundaryHour.Hint"), type: Number, default: DEFAULT_BOUNDARY_HOUR, range: { min: 0, max: 23, step: 1 } });
  world(SETTINGS.captureEnabled, { name: L("CaptureEnabled.Name"), hint: L("CaptureEnabled.Hint"), type: Boolean, default: true });
  world(SETTINGS.captureRawRolls, { name: L("CaptureRawRolls.Name"), hint: L("CaptureRawRolls.Hint"), type: Boolean, default: true });
  world(SETTINGS.minRollsToList, { name: L("MinRollsToList.Name"), hint: L("MinRollsToList.Hint"), type: Number, default: 30, range: { min: 0, max: 500, step: 5 } });
  world(SETTINGS.playerAccess, { name: L("PlayerAccess.Name"), hint: L("PlayerAccess.Hint"), type: String, default: "all", choices: { all: L("PlayerAccess.All"), own: L("PlayerAccess.Own"), none: L("PlayerAccess.None") } });
  world(SETTINGS.blindPolicy, { name: L("BlindPolicy.Name"), hint: L("BlindPolicy.Hint"), type: String, default: "hideCurrent", choices: { hideCurrent: L("BlindPolicy.HideCurrent"), hideAlways: L("BlindPolicy.HideAlways"), show: L("BlindPolicy.Show") } });
  world(SETTINGS.mcIterations, { name: L("McIterations.Name"), hint: L("McIterations.Hint"), type: Number, default: 10000, range: { min: 1000, max: 50000, step: 1000 } });
  hidden(SETTINGS.logJournalId, { type: String, default: "" });
  hidden(SETTINGS.sessionIndex, { type: Object, default: {} });
  hidden(SETTINGS.schemaVersion, { type: Number, default: 0 });

  client(SETTINGS.groupBy, { type: String, default: "user" });
  client(SETTINGS.countMode, { type: String, default: "all" });
  client(SETTINGS.includeGM, { type: Boolean, default: true });
  client(SETTINGS.includeRaw, { type: Boolean, default: true });
  client(SETTINGS.defaultTab, { type: String, default: "tonight" });

  game.keybindings.register(MODULE_ID, "open", {
    name: L("Keybinding.Open"),
    editable: [],
    onDown: () => { game.modules.get(MODULE_ID)?.api?.open(); return true; },
    restricted: false,
  });
}
