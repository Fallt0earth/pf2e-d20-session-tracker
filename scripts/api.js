// Public API on game.modules.get(MODULE_ID).api — used by macros, the console, and the e2e harness.
import { messageToRollRecords, classifyMessage } from "./capture/normalize.js";
import { sessionKeyFor, sessionLabel } from "./sessions/bucket.js";
import * as stats from "./stats/index.js";
import { buildSessionModel } from "./ui/view-model.js";
import { viewOptionsFor } from "./ui/view-options.js";
import { bucketOptions } from "./settings.js";

export function buildApi({ open, close, getSource, catchUp }) {
  return Object.freeze({
    open,
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
    sessionKeyFor: (ts) => sessionKeyFor(ts, bucketOptions()),
    sessionLabel,
    stats,
  });
}
