// End-of-evening chat card: party mood, the leaderboard and the awards, posted by the GM (public or
// whispered to GMs). Waits for Dice So Nice if present so it never lands mid-animation.
import { MODULE_ID } from "../constants.js";
import { sessionLabel } from "../sessions/bucket.js";
import { buildSessionModel } from "./view-model.js";
import { buildFunModel } from "./fun-model.js";
import { viewOptionsFor } from "./view-options.js";
import { decorateAwards } from "./fun-decorate.js";
import { getSetting, SETTINGS } from "../settings.js";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export function buildSummaryHtml(source, sessionKey) {
  const opts = viewOptionsFor(source);
  const records = source.getSession(sessionKey);
  const tonight = buildSessionModel(records, opts);
  const fun = buildFunModel(records, opts, { iterations: Math.min(getSetting(SETTINGS.mcIterations), 5000), seed: sessionKey });
  const byId = new Map([...fun.groups.map((g) => [g.id, g]), ["party", fun.party]]);
  const awardsList = decorateAwards(fun.awards, byId);
  const party = tonight.party;
  const bandLabel = L(`PF2E-D20.Band.${party.band}`);
  const rows = tonight.rows.map((r) => `<tr class="band-${r.band}"><td>${esc(r.label)}</td><td>${r.luck.n}</td><td>${fmt(r.luck.mean)}</td><td>${r.luck.zGuard === "none" ? "–" : (r.luck.z > 0 ? "+" : "") + fmt(r.luck.z)}${r.luck.zGuard === "thin" ? "*" : ""}</td><td>${r.luck.nat20.count}</td><td>${r.luck.nat1.count}</td></tr>`).join("");
  const awardsHtml = awardsList.length ? `<ul class="awards">${awardsList.map((a) => `<li><b>${esc(a.title)}</b> ${esc(a.text)}</li>`).join("")}</ul>` : "";
  return `<div class="pf2e-d20-summary">
    <h3><i class="fa-solid fa-dice-d20"></i> ${esc(L("PF2E-D20.Summary.Title", { label: sessionLabel(sessionKey) }))}</h3>
    <p class="mood band-${party.band}">${esc(L("PF2E-D20.Summary.Mood", { n: party.luck.n, mean: fmt(party.luck.mean), z: (party.luck.z > 0 ? "+" : "") + fmt(party.luck.z), band: bandLabel, pct: party.luck.percentile === null ? "–" : Math.round(party.luck.percentile * 100) }))}</p>
    <table><thead><tr><th></th><th>n</th><th>${esc(L("PF2E-D20.Tonight.Mean"))}</th><th>z</th><th>20</th><th>1</th></tr></thead><tbody>${rows}</tbody></table>
    ${awardsHtml}
    <p class="foot">${esc(L("PF2E-D20.Summary.Foot"))}</p>
  </div>`;
}

/**
 * @param {object} source
 * @param {string} sessionKey
 * @param {{ whisper?: boolean }} [opts]
 */
export async function postSummary(source, sessionKey, { whisper = false } = {}) {
  if (!game.user.isGM) return null;
  if (game.dice3d?.waitFor3DAnimationByMessageID) { /* nothing pending: this card carries no roll */ }
  const content = buildSummaryHtml(source, sessionKey);
  return ChatMessage.create({
    content,
    speaker: { alias: game.i18n.localize("PF2E-D20.Title") },
    whisper: whisper ? game.users.filter((u) => u.isGM).map((u) => u.id) : [],
    flags: { [MODULE_ID]: { summary: true, sessionKey } },
  });
}
