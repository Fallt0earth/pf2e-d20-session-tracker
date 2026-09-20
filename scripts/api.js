// Public API on game.modules.get(MODULE_ID).api — used by macros, the console, and the e2e harness.
import { messageToRollRecords, classifyMessage } from "./capture/normalize.js";
import { sessionKeyFor, sessionLabel } from "./sessions/bucket.js";
import * as stats from "./stats/index.js";
import { buildSessionModel } from "./ui/view-model.js";
import { viewOptionsFor } from "./ui/view-options.js";
import { bucketOptions } from "./settings.js";

export function buildApi({ open, openReport, close, getSource, catchUp }) {
  return Object.freeze({
    open,
    /** Open the evening report popup on this client (never posts to chat). */
    openReport,
    close,
    /** The journal store (read on every client, written by the active GM). */
    get store() { return getSource(); },
    get source() { return getSource(); },
    listSessions: () => getSource()?.listSessions() ?? [],
    getSession: (key) => getSource()?.getSession(key) ?? [],
    catchUp,
    /** Session model for this viewer; access rules always come from the world settings. */
    summarize: (key, overrides) => buildSessionModel(getSource()?.getSession(key) ?? [], viewOptionsFor(getSource(), overrides)),
    normalize: messageToRollRecords,
    classifyMessage,
    /** The session a timestamp belongs to under the world's current session definition. */
    sessionKeyFor: (ts) => getSource()?.assignKey(ts) ?? sessionKeyFor(ts, bucketOptions()),
    /** The running session, or null when none is (gap mode after the idle gap, manual mode with none started). */
    currentKey: () => getSource()?.currentKey() ?? null,
    /** The session definition in force: { mode, timezone, boundaryHour, gapHours, manualOpen }. */
    sessionConfig: () => getSource()?.config() ?? null,
    sessionLabel,
    stats,
  });
}
