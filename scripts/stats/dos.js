// @ts-check
// Degree-of-success split and the "moments" (clutch, heartbreaker, wasted 20). Not luck — the DC and
// modifiers are in there — but fun. Counts kept dice only so fortune pairs count once.

const OUTCOMES = ["criticalSuccess", "success", "failure", "criticalFailure"];

/** @param {import("../types.js").RollRecord[]} records */
export function dosSplit(records) {
  const out = { criticalSuccess: 0, success: 0, failure: 0, criticalFailure: 0, n: 0 };
  for (const r of records) {
    if (!r.kept || !r.outcome || !OUTCOMES.includes(r.outcome)) continue;
    out[r.outcome]++;
    out.n++;
  }
  return out;
}

/**
 * Clutch: highest natural on a kept roll that had a visible DC and succeeded.
 * Heartbreaker: a natural 1 on a roll that would have succeeded on a 2 (total − 1 + 2 ≥ dc).
 * Wasted 20: a natural 20 on a check with no DC (flat checks and raw rolls aside).
 * @param {import("../types.js").RollRecord[]} records
 */
export function moments(records) {
  let clutch = null, heartbreaker = null, wasted20 = null;
  const succeeded = (r) => r.outcome === "success" || r.outcome === "criticalSuccess";
  for (const r of records) {
    if (!r.kept || r.natural === null) continue;
    if (r.dc !== null && r.dcVisible !== false && succeeded(r) && r.natural < 20 && (!clutch || r.natural > clutch.natural)) clutch = r;
    if (r.natural === 1 && r.dc !== null && r.total !== null && r.total - 1 + 2 >= r.dc && (!heartbreaker || (r.dc - (r.total - 1 + 2)) < (heartbreaker.dc - (heartbreaker.total - 1 + 2)))) heartbreaker = r;
    if (r.natural === 20 && r.dc === null && r.type !== "flat-check" && r.type !== "raw" && !wasted20) wasted20 = r;
  }
  return { clutch, heartbreaker, wasted20 };
}
