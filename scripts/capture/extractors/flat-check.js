// @ts-check
// Extractor 4: messages from the "PF2e Flat Check" module (Latharne fork, id pf2-flat-check, V3.2.0).
// Verified on the dev world (spike S6, 2026-09-15): the message has NO rolls array and an EMPTY object
// under flags["pf2-flat-check"]; it is created on the active GM's client (author = GM) with the
// attacker's token/actor as speaker; blind only when a target is Undetected. Content:
//   <div><b>Test Rogue</b> is <b>Concealed</b> to attacker.<br />Flat Check DC is <b>5</b>.</div>
//   <div class="dice-roll"><div class="dice-result flat-check-success"><h4 class="dice-total flat-check">7</h4></div></div>
// With the world setting hideRollValue on, the h4 holds "Success"/"Failure" instead of the number, but
// the dice-result class still carries the outcome.

export const id = "flat-check";
export const on = ["create", "backfill"];

const TOTAL = /<h4\s+class="[^"]*\bdice-total\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/h4>/i;
const TOTAL_FALLBACKS = [
  /<(?:span|div)\s+class="[^"]*\bdice-total\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\//i,
  /<li\s+class="[^"]*\bdie\b[^"]*\bd20\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/li>/i,
];
const DC = /Flat Check DC is\s*(?:<b>)?\s*(\d{1,2})|\bDC\s*(?:is)?\s*:?\s*(?:<b>)?\s*(\d{1,2})\b/i;
const OUTCOME = /\bflat-check-(success|failure)\b/i;

/** @param {import("../../types.js").MessageData} msg */
export function matches(msg) {
  const flags = msg?.flags;
  return !!flags && typeof flags === "object" && Object.prototype.hasOwnProperty.call(flags, "pf2-flat-check");
}

/**
 * Parse natural, DC and outcome out of the flat-check card.
 * @param {string|undefined|null} html
 * @returns {{ natural: number|null, dc: number|null, outcome: string|null }}
 */
export function parseFlatCheckContent(html) {
  if (typeof html !== "string") return { natural: null, dc: null, outcome: null };
  let natural = null;
  for (const re of [TOTAL, ...TOTAL_FALLBACKS]) {
    const m = re.exec(html);
    if (m) { natural = Number(m[1]); break; }
  }
  if (natural !== null && (natural < 1 || natural > 20)) natural = null;
  const dcm = DC.exec(html);
  const dc = dcm ? Number(dcm[1] ?? dcm[2]) : null;
  const om = OUTCOME.exec(html);
  const outcome = om ? om[1].toLowerCase() : null;
  return { natural, dc, outcome };
}

/**
 * @param {import("../../types.js").MessageData} msg
 * @param {import("../../types.js").NormalizeContext} ctx
 * @param {(overrides: object) => import("../../types.js").RollRecord} base
 */
export function extract(msg, ctx, base) {
  const { natural, dc, outcome } = parseFlatCheckContent(msg.content);
  return [base({
    id: `${msg._id}:flat:0`,
    dieIndex: 0,
    natural,
    kept: true,
    formula: "1d20",
    total: natural,
    type: "flat-check",
    source: "pf2-flat-check",
    domains: ["flat-check"],
    dc,
    dcVisible: dc !== null ? true : null,
    outcome,
    userGuess: true, // the author is always the GM client; the attacker is only known via the speaker
    ...(natural === null ? { valueHidden: true } : {}),
  })];
}
