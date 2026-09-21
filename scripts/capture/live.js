// GM-only live capture (decision D2a): the active GM client normalizes every new or updated chat
// message and appends the records to the store. Other clients do nothing here (see roller-enrich.js).
import { messageToRollRecords } from "./normalize.js";
import { CLOCK_SKEW_MS } from "./sanitize.js";
import { getSetting, SETTINGS } from "../settings.js";

export function isWriter() {
  const gm = game.users.activeGM;
  return !!gm && gm.id === game.user.id;
}

/**
 * Normalizer context. `assign` decides the session of a timestamp: live capture peeks at the store
 * (the span grows when the records are appended); batches pass one shared Sessionizer's `assign`.
 * @param {"create"|"update"|"backfill"} event
 * @param {string|null} updaterUserId
 * @param {import("../storage/store.js").JournalStore} store
 * @param {(ts: number) => string} [assign]
 */
export function captureContext(event, updaterUserId, store, assign) {
  return {
    sessionKeyFor: assign ?? ((ts) => store.assignKey(ts)),
    event,
    updaterUserId: updaterUserId ?? null,
    inCombat: event === "backfill" ? null : !!game.combat?.active,
    captureRawRolls: getSetting(SETTINGS.captureRawRolls),
    existing: (baseId) => store.existing(baseId),
    // What the normalizer needs to judge a message's own claims (time, reroll link, who rolled a save).
    now: () => Date.now(),
    isGM: (userId) => game.users.get(userId)?.isGM === true,
    find: (id) => store.find(id),
    messageAuthor: (msgId) => game.messages.get(msgId)?.author?.id ?? null,
    warn: (text, error) => console.warn(`d20 tracker | ${text}`, error),
    resolveToken: (sceneId, tokenId) => {
      const scene = (sceneId ? game.scenes.get(sceneId) : null) ?? game.scenes.find((s) => s.tokens.has(tokenId)) ?? null;
      const token = scene?.tokens.get(tokenId) ?? null;
      if (!token) return null;
      const actor = token.actor ?? null;
      // Users who could have rolled this token's save: its owners and the GMs. Null when the actor is gone.
      const rollers = actor ? game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id) : null;
      return { actorId: token.actorId ?? actor?.id ?? null, alias: token.name ?? null, rollers };
    },
  };
}

/**
 * @param {import("../storage/store.js").JournalStore} store
 */
export function registerLiveCapture(store) {
  let warnedSkew = false;

  const handle = async (message, event, userId) => {
    if (!isWriter() || !getSetting(SETTINGS.captureEnabled)) return;
    const data = message.toObject();
    if (event === "create" && !warnedSkew && Math.abs(Date.now() - data.timestamp) > CLOCK_SKEW_MS) {
      warnedSkew = true;
      console.warn(`d20 tracker | message ${message.id} timestamp differs from this clock by ${Math.round((Date.now() - data.timestamp) / 60000)} min — check the rolling client's clock; a player's roll that far off is filed under this client's time`);
    }
    await store.autoCloseManual(); // a forgotten manual End closes itself before this roll is placed
    const records = messageToRollRecords(data, captureContext(event, userId, store));
    if (records.length) await store.append(records);
  };
  // One bad message must not surface as an unhandled rejection or disturb the chat log.
  const safely = (message, event, userId) => handle(message, event, userId).catch((e) => console.error(`d20 tracker | capture failed for message ${message?.id}`, e));

  Hooks.on("createChatMessage", (message, _options, userId) => { safely(message, "create", userId); });
  Hooks.on("updateChatMessage", (message, changes, _options, userId) => {
    // Toolbelt saves arrive as flag updates on damage messages; Modifiers Matter also updates flags (harmless, deduped).
    const relevant = changes?.flags !== undefined || changes?.content !== undefined || changes?.rolls !== undefined;
    if (relevant) safely(message, "update", userId);
  });
  // deleteChatMessage: records survive deletion on purpose (PF2e deletes the original message of a reroll).
}
