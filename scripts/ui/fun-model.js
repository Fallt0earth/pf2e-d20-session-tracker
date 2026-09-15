// @ts-check
// Pure model for the Fun tab: the same visibility/count/grouping rules as the Tonight tab, then the
// full group summaries (streaks, DoS, rerolls, chi-square, Monte Carlo) and the awards.
import { countedRecords, groupRecords } from "./view-model.js";
import { groupSummary } from "../stats/summarize.js";
import { awards } from "../stats/awards.js";

/**
 * @param {import("../types.js").RollRecord[]} records   one session
 * @param {import("./view-model.js").ViewOptions} opts
 * @param {{ iterations?: number, seed?: string|number, mc?: boolean }} [mc]
 */
export function buildFunModel(records, opts, mc = {}) {
  const counted = countedRecords(records, opts);
  const groups = groupRecords(counted, opts);
  const mcFor = (suffix) => (mc.mc === false ? false : { iterations: mc.iterations ?? 10_000, seed: `${mc.seed ?? "d20"}:${suffix}` });
  const party = { id: "party", label: "Party", subtitle: "", ...groupSummary(counted, { mc: mcFor("party") }) };
  const list = [...groups.values()].map((g) => ({ id: g.id, label: g.label, subtitle: g.subtitle, ...groupSummary(g.records, { mc: mcFor(g.id) }) }));
  list.sort((a, b) => (b.luck.z ?? -Infinity) - (a.luck.z ?? -Infinity) || b.n - a.n || a.label.localeCompare(b.label));
  return { counted: counted.length, party, groups: list, awards: awards(list, party), empty: counted.length === 0 };
}
