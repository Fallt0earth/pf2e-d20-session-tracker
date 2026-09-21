// @ts-check
// Compact at-rest format for a session page (spike S2: plain objects cost ~580 B/record and 50k of
// them took ~50 s to write; per-evening pages are ~100× smaller, and this halves them again).
// Records are stored as arrays under a field-name header. `domains` is not stored (the derived `stat`
// slug is), and `sessionKey`/`msgId` are restored from the page key and the record id on decode.
// Pure: no Foundry globals. Versioned so future layouts can migrate.

export const CODEC_VERSION = 1;

/** Field order of a stored row. Append only; never reorder within a version. */
export const FIELDS = Object.freeze([
  "id", "dieIndex", "ts", "userId", "userGuess", "actorId", "tokenId", "alias",
  "natural", "kept", "formula", "total", "type", "source", "stat", "ident", "action",
  "dc", "dcVisible", "outcome", "unadjustedOutcome", "isReroll", "rerollOf", "rerolledBy",
  "rerollOutcome", "resource", "rollTwice", "mode", "blind", "whispered", "inCombat",
  "valueHidden", "discardUnknown",
]);

const KNOWN_FIELDS = new Set(FIELDS);

const DEFAULTS = Object.freeze({
  userGuess: false, kept: true, formula: "1d20", type: "raw", source: "raw", stat: null, ident: null, action: null,
  dc: null, dcVisible: null, outcome: null, unadjustedOutcome: null, isReroll: false, rerollOf: undefined,
  rerolledBy: undefined, rerollOutcome: undefined, resource: undefined, rollTwice: null, mode: null,
  blind: false, whispered: false, inCombat: null, valueHidden: undefined, discardUnknown: undefined,
  userId: null, actorId: null, tokenId: null, alias: null, natural: null, total: null,
});

/**
 * @param {import("../types.js").RollRecord[]} records
 * @returns {{ v: number, fields: readonly string[], rows: any[][] }}
 */
export function encode(records) {
  const rows = records.map((r) => FIELDS.map((f) => {
    const v = r[f];
    return v === undefined ? null : v;
  }));
  return { v: CODEC_VERSION, fields: FIELDS, rows };
}

/**
 * @param {{ v?: number, fields?: readonly string[], rows?: any[][] } | null | undefined} packed
 * @param {string} sessionKey
 * @returns {import("../types.js").RollRecord[]}
 */
export function decode(packed, sessionKey) {
  if (!packed || !Array.isArray(packed.rows)) return [];
  const fields = Array.isArray(packed.fields) && packed.fields.length ? packed.fields : FIELDS;
  return packed.rows.map((row) => {
    /** @type {any} */
    const r = { ...DEFAULTS, domains: [] };
    fields.forEach((f, i) => {
      if (!KNOWN_FIELDS.has(f) || !Array.isArray(row)) return; // a header names stored fields, nothing else
      const v = row[i];
      if (v === null && DEFAULTS[f] === undefined) return; // optional field absent
      r[f] = v;
    });
    r.sessionKey = sessionKey;
    r.msgId = typeof r.id === "string" ? r.id.split(":")[0] : null;
    if (r.stat && !r.domains.length) r.domains = [r.stat];
    return /** @type {import("../types.js").RollRecord} */ (r);
  });
}

/** Approximate stored size in bytes for capacity checks. */
export function encodedSize(records) {
  return JSON.stringify(encode(records)).length;
}
