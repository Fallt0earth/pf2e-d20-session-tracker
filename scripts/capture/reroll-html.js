// @ts-check
// Fallback parser for hero-point / mythic rerolls when the rolling client's enrichment flag is absent
// (catch-up of messages rolled while the GM was away). PF2e's reroll message content is
//   <div class="reroll-discard">…old roll html…</div><div class="reroll-second …">…new roll html…</div>
// (or the classes swapped when the old roll was kept). Only the discarded roll's HTML holds the
// discarded natural. Regex only — no DOM — so it runs under node. Fragile by nature: fixtures guard it.
// The content is free text from the rolling client: html-scan.js keeps the parsing bounded.

import { prepareHtml, numericElements, findOpenTag, findCloseTag } from "./html-scan.js";
import { isNatural } from "./sanitize.js";

const MAX_DISCARDED_DICE = 4;

/**
 * Extract the discarded roll's d20 naturals (and total when present) from a reroll message's content.
 * @param {string|undefined|null} content   message.content
 * @returns {{ naturals: number[], total: number|null, found: boolean }}
 */
export function parseRerollDiscard(content) {
  const html = prepareHtml(content);
  const open = html ? findOpenTag(html, "div", "reroll-discard") : null;
  if (!open) return { naturals: [], total: null, found: false };
  const block = html.slice(open.contentStart, findCloseTag(html, "div", open.contentStart));
  const isD20 = (e) => e.classes.includes("roll") && e.classes.includes("die") && e.classes.includes("d20");
  const naturals = numericElements(block, ["li"]).filter((e) => isD20(e) && isNatural(e.value)).slice(0, MAX_DISCARDED_DICE).map((e) => e.value);
  const total = numericElements(block, ["span", "div", "h4"]).find((e) => e.classes.includes("dice-total"));
  return { naturals, total: total ? total.value : null, found: true };
}

/** True when the content carries a reroll block at all (either class present). */
export function looksLikeReroll(html) {
  return typeof html === "string" && /\breroll-(?:discard|second)\b/.test(html);
}
