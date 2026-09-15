// @ts-check
// End-of-evening awards (SCOPE §4.4). Input: per-group summaries (see summarize.js) and the party
// summary. Output: a list of { key, groupId, label, value, detail } with i18n keys for the UI.

const MIN_N = 15;

/**
 * @param {Array<{ id: string, label: string, luck: any, basic: any, hist: number[], rerolls: any }>} groups
 * @param {{ luck: any }} party
 */
export function awards(groups, party) {
  const out = [];
  const eligible = groups.filter((g) => g.luck.n >= MIN_N && g.luck.z !== null);
  const pick = (key, list, score, { min = false, positive = true } = {}) => {
    const scored = list.map((g) => ({ g, s: score(g) })).filter((x) => x.s !== null && x.s !== undefined && Number.isFinite(x.s) && (!positive || x.s > 0));
    if (!scored.length) return;
    scored.sort((a, b) => (min ? a.s - b.s : b.s - a.s));
    const top = scored[0];
    out.push({ key, groupId: top.g.id, label: top.g.label, value: top.s, ties: scored.filter((x) => x.s === top.s).length - 1 });
  };
  pick("blessed", eligible, (g) => g.luck.z, { positive: true });
  pick("cursed", eligible.filter((g) => g.luck.z < 0), (g) => -g.luck.z, { positive: true });
  pick("grinder", groups, (g) => g.luck.n);
  pick("consistent", groups.filter((g) => g.luck.n >= MIN_N && g.basic.sd !== null), (g) => g.basic.sd, { min: true, positive: false });
  pick("chaotic", groups.filter((g) => g.luck.n >= MIN_N && g.basic.sd !== null), (g) => g.basic.sd, { positive: false });
  // Ties on counts break by rate (count / n): encode as count + rate/1000 so the count still dominates.
  pick("snakeEyes", groups, (g) => (g.luck.nat1.count ? g.luck.nat1.count + g.luck.nat1.count / g.luck.n / 1000 : 0));
  pick("golden", groups, (g) => (g.luck.nat20.count ? g.luck.nat20.count + g.luck.nat20.count / g.luck.n / 1000 : 0));
  pick("comeback", groups, (g) => g.rerolls?.best?.gain ?? null);
  if (party?.luck?.n) out.push({ key: "partyMood", groupId: "party", label: "Party", value: party.luck.z, ties: 0 });
  return out.map((a) => ({ ...a, value: typeof a.value === "number" ? Math.round(a.value * 100) / 100 : a.value }));
}
