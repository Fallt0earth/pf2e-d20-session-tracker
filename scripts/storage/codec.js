// @ts-check
// Compact at-rest format for a session page (spike S2: plain objects cost ~580 B/record and 50k of
// them took ~50 s to write; per-evening pages are ~100× smaller, and this halves them again).
// Records are stored as arrays under a field-name header, keyed by record id (v2). Keying matters
// for the wire, not the disk: Foundry replaces arrays whole but merges objects key by key, so one new
// roll travels to every client as one key (~300 B) instead of the whole page (80 KB at 300 dice).
// `domains` is not stored (the derived `stat` slug is), and `sessionKey`/`msgId` are restored from the
// page key and the record id on decode. Pure: no Foundry globals. v1 pages (rows as an array) decode
// unchanged and are rewritten in v2 on their next write.

export const CODEC_VERSION = 2;

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

/** A row key is used as a path segment in Foundry updates: no ".", no leading "-=", no prototype names. */
export function isRowKey(id) {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(id);
}

/**
 * @param {import("../types.js").RollRecord[]} records
 * @returns {{ v: number, fields: readonly string[], rows: Record<string, any[]> }}
 */
export function encode(records) {
  /** @type {Record<string, any[]>} */
  const rows = {};
  for (const r of records) {
    if (!isRowKey(r.id)) continue;
    rows[r.id] = FIELDS.map((f) => {
      const v = r[f];
      return v === undefined ? null : v;
    });
  }
  return { v: CODEC_VERSION, fields: FIELDS, rows };
}

/**
 * @param {{ v?: number, fields?: readonly string[], rows?: any[][] | Record<string, any[]> } | null | undefined} packed
 * @param {string} sessionKey
 * @returns {import("../types.js").RollRecord[]}   in roll order (ts, then die index)
 */
export function decode(packed, sessionKey) {
  const list = rowsOf(packed);
  if (!list.length) return [];
  const fields = Array.isArray(packed?.fields) && packed.fields.length ? packed.fields : FIELDS;
  const out = list.map((row) => {
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
  // Keyed rows come back in write order, which is not roll order after a catch-up or a merge.
  return out.sort((a, b) => (a.ts - b.ts) || (a.dieIndex - b.dieIndex) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The stored rows of either layout as a list. */
function rowsOf(packed) {
  if (!packed || typeof packed !== "object") return [];
  if (Array.isArray(packed.rows)) return packed.rows;
  if (packed.rows && typeof packed.rows === "object") return Object.values(packed.rows);
  return [];
}

/** How many rows a page holds, in either layout. */
export function rowCount(packed) {
  return rowsOf(packed).length;
}

/**
 * The smallest Foundry update that turns a page's stored module flags into `next`: dotted paths under
 * `flags.<scope>`. Rows are keyed by id, so a new roll is one key and a changed roll is one key;
 * `-=id` (Foundry's deletion syntax) drops a row. A page in the v1 layout, or with another field
 * header, has every row sent once, which overwrites the old array. Empty when nothing changed.
 * @param {string} scope   the module id
 * @param {any} current    page.flags[scope] as stored (may be undefined)
 * @param {{ v: number, key: string, meta: object, data: ReturnType<typeof encode> }} next
 * @returns {Record<string, any>}
 */
export function flagsUpdate(scope, current, next) {
  /** @type {Record<string, any>} */
  const out = {};
  const prefix = `flags.${scope}`;
  const cur = current && typeof current === "object" ? current : {};
  const curData = cur.data && typeof cur.data === "object" ? cur.data : {};
  const sameFields = JSON.stringify(curData.fields ?? null) === JSON.stringify(next.data.fields);
  const keyed = curData.rows && typeof curData.rows === "object" && !Array.isArray(curData.rows) && curData.v === next.data.v && sameFields;
  const curRows = keyed ? curData.rows : {};
  for (const [id, row] of Object.entries(next.data.rows)) {
    if (!Object.hasOwn(curRows, id) || JSON.stringify(curRows[id]) !== JSON.stringify(row)) out[`${prefix}.data.rows.${id}`] = row;
  }
  for (const id of Object.keys(curRows)) if (!Object.hasOwn(next.data.rows, id)) out[`${prefix}.data.rows.-=${id}`] = null;
  if (curData.v !== next.data.v) out[`${prefix}.data.v`] = next.data.v;
  if (!sameFields) out[`${prefix}.data.fields`] = [...next.data.fields];
  if (cur.v !== next.v) out[`${prefix}.v`] = next.v;
  if (cur.key !== next.key) out[`${prefix}.key`] = next.key;
  return Object.assign(out, metaUpdate(scope, cur.meta, next.meta));
}

/**
 * The update that makes a page's stored meta equal `meta`. Meta merges key by key on the page, so a
 * key that went away (a manual interval after a merge, a cleared label) is deleted by name.
 * @param {string} scope
 * @param {any} current   page.flags[scope].meta as stored
 * @param {any} meta
 * @returns {Record<string, any>}
 */
export function metaUpdate(scope, current, meta) {
  /** @type {Record<string, any>} */
  const out = {};
  const prefix = `flags.${scope}.meta`;
  const curMeta = current && typeof current === "object" ? current : {};
  const nextMeta = meta && typeof meta === "object" ? meta : {};
  for (const [k, v] of Object.entries(nextMeta)) if (v !== undefined && JSON.stringify(curMeta[k]) !== JSON.stringify(v)) out[`${prefix}.${k}`] = v;
  for (const k of Object.keys(curMeta)) if (nextMeta[k] === undefined) out[`${prefix}.-=${k}`] = null;
  return out;
}

/** Approximate stored size in bytes for capacity checks. */
export function encodedSize(records) {
  return JSON.stringify(encode(records)).length;
}
