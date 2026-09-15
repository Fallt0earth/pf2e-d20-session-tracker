// The hidden "d20 Session Log" JournalEntry: one page per evening, records in page flags (compact codec).
// Players receive ownership-NONE journals (spike S3), so every client can read; only the GM writes.
import { MODULE_ID, SCHEMA_VERSION } from "../constants.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { encode, decode } from "./codec.js";

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

export async function writePage(journal, key, records, meta = {}) {
  const flags = { v: SCHEMA_VERSION, key, meta, data: encode(records) };
  const page = pageFor(journal, key);
  if (page) {
    await page.update({ [`flags.${MODULE_ID}`]: flags });
    return page;
  }
  const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [
    { name: key, type: "text", text: { content: "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML }, flags: { [MODULE_ID]: flags } },
  ]);
  return created;
}

export async function writeMeta(journal, key, meta) {
  const page = pageFor(journal, key);
  if (page) await page.update({ [`flags.${MODULE_ID}.meta`]: meta });
}

export async function deletePage(journal, key) {
  const page = pageFor(journal, key);
  if (page) await page.delete();
}
