// @ts-check
// How an incoming record merges into the stored record with the same id. What the writer has already
// read off a message is settled: the die, its time, and a roller that was not a guess never change
// afterwards, whatever a later message claims about them. Everything else (the reroll link, the
// outcome, a guess that becomes certain) may be refreshed. Pure: no Foundry globals.

/**
 * @param {import("../types.js").RollRecord} stored
 * @param {import("../types.js").RollRecord} incoming
 * @returns {import("../types.js").RollRecord}
 */
export function mergeRecord(stored, incoming) {
  /** @type {any} */
  const merged = { ...stored, ...incoming };
  merged.id = stored.id;
  merged.msgId = stored.msgId;
  merged.sessionKey = stored.sessionKey;
  merged.ts = stored.ts;
  if (stored.natural !== null && stored.natural !== undefined) merged.natural = stored.natural;
  if (stored.userId && stored.userGuess !== true) {
    merged.userId = stored.userId;
    if (stored.userGuess === undefined) delete merged.userGuess; else merged.userGuess = stored.userGuess;
  }
  return merged;
}
