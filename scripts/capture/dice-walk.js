// @ts-check
// Walk a serialized Roll (ChatMessage.rolls entries are Roll#toJSON output, stored as JSON strings)
// and return every physical d20 result, in depth-first order. Handles Die terms directly in `terms`,
// PoolTerm `rolls`, and parenthetical/nested `roll`/`terms` so `/r 1d20 + 1d20` or `{1d20,1d20}kh`
// behave sensibly. Pure: no Foundry globals.

/**
 * @typedef {object} D20Result
 * @property {number} natural       Face rolled, 1–20.
 * @property {boolean} kept         active !== false && !discarded (kh/kl drop, reroll modifiers).
 * @property {string} formula       Die-term formula, e.g. "1d20", "2d20kh", "2d20kl".
 * @property {number} rollIndex     Index in message.rolls.
 * @property {number} termIndex     Depth-first index of the Die term within the roll.
 * @property {number} resultIndex   Index within the Die term's results.
 * @property {number} dieIndex      Running index across the whole message (assigned by the caller).
 */

/**
 * Parse a rolls entry, tolerating already-parsed objects and malformed JSON.
 * @param {string|object} entry
 * @returns {object|null}
 */
export function parseRoll(entry) {
  if (entry && typeof entry === "object") return entry;
  if (typeof entry !== "string") return null;
  try { return JSON.parse(entry); } catch { return null; }
}

/**
 * All d20 results of one serialized roll.
 * @param {object} roll   Parsed Roll JSON ({ formula, total, terms: [...] }).
 * @param {number} rollIndex
 * @returns {D20Result[]}
 */
export function d20sOfRoll(roll, rollIndex = 0) {
  /** @type {D20Result[]} */
  const out = [];
  let termIndex = 0;
  const visitTerm = (term) => {
    if (!term || typeof term !== "object") return;
    if (term.class === "Die" || (term.faces !== undefined && Array.isArray(term.results))) {
      if (Number(term.faces) === 20) {
        const results = Array.isArray(term.results) ? term.results : [];
        const formula = dieFormula(term);
        results.forEach((r, resultIndex) => {
          const natural = Number(r?.result);
          if (!Number.isInteger(natural)) return;
          out.push({ natural, kept: r.active !== false && !r.discarded, formula, rollIndex, termIndex, resultIndex, dieIndex: -1 });
        });
      }
      termIndex++;
      return;
    }
    // PoolTerm: { rolls: [Roll, ...] } ; ParentheticalTerm (evaluated): { roll: Roll } ; anything with nested terms.
    if (Array.isArray(term.rolls)) for (const inner of term.rolls) visitRoll(inner);
    if (term.roll && typeof term.roll === "object") visitRoll(term.roll);
    if (Array.isArray(term.terms)) for (const t of term.terms) visitTerm(t);
  };
  const visitRoll = (r) => {
    if (!r || typeof r !== "object") return;
    if (Array.isArray(r.terms)) for (const t of r.terms) visitTerm(t);
  };
  visitRoll(roll);
  return out;
}

/**
 * All d20 results across a message's rolls, with `dieIndex` numbered across the message.
 * @param {Array<string|object>|undefined} rolls   message.rolls (strings or objects)
 * @returns {Array<D20Result & { total: number|null, rollFormula: string|null }>}
 */
export function d20sOfMessage(rolls) {
  const out = [];
  (rolls ?? []).forEach((entry, rollIndex) => {
    const roll = parseRoll(entry);
    if (!roll) return;
    const total = Number.isFinite(Number(roll.total)) ? Number(roll.total) : null;
    for (const d of d20sOfRoll(roll, rollIndex)) {
      out.push({ ...d, dieIndex: out.length, total, rollFormula: typeof roll.formula === "string" ? roll.formula : null });
    }
  });
  return out;
}

/** True when any roll in the message contains a d20 term (kept or not). */
export function messageHasD20(rolls) {
  return d20sOfMessage(rolls).length > 0;
}

function dieFormula(term) {
  const number = Number.isInteger(Number(term.number)) ? Number(term.number) : 1;
  const mods = Array.isArray(term.modifiers) ? term.modifiers.join("") : "";
  return `${number}d${term.faces}${mods}`;
}
