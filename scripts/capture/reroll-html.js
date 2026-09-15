// @ts-check
// Fallback parser for hero-point / mythic rerolls when the rolling client's enrichment flag is absent
// (catch-up of messages rolled while the GM was away). PF2e's reroll message content is
//   <div class="reroll-discard">…old roll html…</div><div class="reroll-second …">…new roll html…</div>
// (or the classes swapped when the old roll was kept). Only the discarded roll's HTML holds the
// discarded natural. Regex only — no DOM — so it runs under node. Fragile by nature: fixtures guard it.

const DISCARD_OPEN = /<div\s+class="[^"]*\breroll-discard\b[^"]*"[^>]*>/i;
const DIE_LI = /<li\s+class="[^"]*\broll\b[^"]*\bdie\b[^"]*\bd20\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/li>/gi;
const DICE_TOTAL = /<(?:span|div|h4)\s+class="[^"]*\bdice-total\b[^"]*"[^>]*>\s*(-?\d+)\s*<\/(?:span|div|h4)>/i;

/**
 * Extract the discarded roll's d20 naturals (and total when present) from a reroll message's content.
 * @param {string|undefined|null} html   message.content
 * @returns {{ naturals: number[], total: number|null, found: boolean }}
 */
export function parseRerollDiscard(html) {
  if (typeof html !== "string" || !html) return { naturals: [], total: null, found: false };
  const open = DISCARD_OPEN.exec(html);
  if (!open) return { naturals: [], total: null, found: false };
  const start = open.index + open[0].length;
  const block = html.slice(start, findDivEnd(html, start));
  const naturals = [];
  for (const m of block.matchAll(DIE_LI)) naturals.push(Number(m[1]));
  const totalMatch = DICE_TOTAL.exec(block);
  return { naturals, total: totalMatch ? Number(totalMatch[1]) : null, found: true };
}

/** True when the content carries a reroll block at all (either class present). */
export function looksLikeReroll(html) {
  return typeof html === "string" && /\breroll-(?:discard|second)\b/.test(html);
}

/**
 * Index just past the </div> that closes the div opened before `from`, tracking nesting.
 * Falls back to the end of the string when tags are unbalanced.
 */
function findDivEnd(html, from) {
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = tag.exec(html))) {
    if (m[0][1] === "/") { depth--; if (depth === 0) return m.index; }
    else depth++;
  }
  return html.length;
}
