// The hidden "d20 Session Log" JournalEntry: one page per evening, records in page flags (compact codec).
// Players receive ownership-NONE journals (spike S3), so every client can read; only the GM writes.
import { MODULE_ID, SCHEMA_VERSION } from "../constants.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { encode, decode, flagsUpdate, metaUpdate } from "./codec.js";

export const LOG_NAME = "d20 Session Log";

export function findLog() {
  const id = getSetting(SETTINGS.logJournalId);
  const byId = id ? game.journal.get(id) : null;
  if (byId) return byId;
  return game.journal.find((j) => j.flags?.[MODULE_ID]?.isLog === true) ?? null;
}

/** GM only. Creates the journal when missing and remembers its id. */
export async function ensureLog() {
  let journal = findLog();
  if (!journal) {
    journal = await JournalEntry.create({
      name: LOG_NAME,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { isLog: true, v: SCHEMA_VERSION } },
    });
  }
  if (getSetting(SETTINGS.logJournalId) !== journal.id) await setSetting(SETTINGS.logJournalId, journal.id);
  return journal;
}

export function pageFor(journal, key) {
  if (!journal) return null;
  return journal.pages.find((p) => p.flags?.[MODULE_ID]?.key === key) ?? journal.pages.find((p) => p.name === key) ?? null;
}

/** @returns {{ key: string, meta: object, records: import("../types.js").RollRecord[] }} */
export function readPage(page) {
  const f = page.flags?.[MODULE_ID] ?? {};
  const key = f.key ?? page.name;
  return { key, meta: f.meta ?? {}, records: decode(f.data, key) };
}

/**
 * Write a session's records. An existing page gets the smallest update that makes it match (one new
 * roll is one key of ~300 B on the wire for every client; see codec.js), never the whole page again.
 */
export async function writePage(journal, key, records, meta = {}, text = "") {
  const next = { v: SCHEMA_VERSION, key, meta, data: encode(records) };
  const page = pageFor(journal, key);
  const name = meta.label || key;
  if (page) {
    const update = flagsUpdate(MODULE_ID, page.flags?.[MODULE_ID], next);
    if ((page.text?.content ?? "") !== text) update["text.content"] = text;
    if (page.name !== name) update.name = name;
    if (Object.keys(update).length) await page.update(update);
    return page;
  }
  const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [
    { name, type: "text", text: { content: text, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML }, flags: { [MODULE_ID]: next } },
  ]);
  return created;
}

export async function writeMeta(journal, key, meta) {
  const page = pageFor(journal, key);
  if (!page) return;
  const update = metaUpdate(MODULE_ID, page.flags?.[MODULE_ID]?.meta, meta);
  if (Object.keys(update).length) await page.update(update);
}

export async function deletePage(journal, key) {
  const page = pageFor(journal, key);
  if (page) await page.delete();
}
