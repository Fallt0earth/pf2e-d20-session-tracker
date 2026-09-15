// CSV / JSON downloads through the browser (client-side; nothing is written on the server, which is
// what The Forge requires). Respects the viewer's access rules.
import { recordsToCsv, recordsToJson } from "../storage/csv.js";
import { visibleRecords } from "./view-model.js";
import { viewOptionsFor } from "./view-options.js";

function labels() {
  return {
    users: Object.fromEntries(game.users.contents.map((u) => [u.id, u.name])),
    actors: Object.fromEntries(game.actors.contents.map((a) => [a.id, a.name])),
  };
}

/**
 * @param {object} source
 * @param {string|null} key   one evening, or null for every evening
 * @param {"csv"|"json"} format
 */
export function exportRecords(source, key, format = "csv") {
  const opts = viewOptionsFor(source);
  const keys = key ? [key] : source.listSessions().map((s) => s.key);
  const records = keys.flatMap((k) => visibleRecords(source.getSession(k), opts));
  const name = `d20-${key ?? "all"}.${format}`;
  const data = format === "json" ? recordsToJson(records, labels()) : recordsToCsv(records, labels());
  foundry.utils.saveDataToFile(data, format === "json" ? "application/json" : "text/csv", name);
  return { name, count: records.length };
}
