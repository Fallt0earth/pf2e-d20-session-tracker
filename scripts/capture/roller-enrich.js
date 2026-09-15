// Runs on EVERY client. When this client performs a hero-point / mythic reroll, PF2e fires
// `pf2e.reroll` (old roll, new roll, resource, keep) BEFORE it deletes the original message and
// creates the new one (verified on 7.8.0 source and on 7.12.2 in spike S4). We stash both naturals,
// learn the original message id from the delete, and stamp everything into the new message's flags
// in preCreateChatMessage via updateSource, so the GM writer never has to parse HTML.
import { MODULE_ID } from "../constants.js";

const STALE_MS = 10_000;

export function registerRollerEnrichment() {
  let pending = null;
  const d20s = (roll) => (roll?.dice ?? []).filter((d) => d.faces === 20).flatMap((d) => d.results.map((r) => r.result));

  Hooks.on("pf2e.reroll", (oldRoll, newRoll, resource, keepOrOptions) => {
    pending = {
      oldNaturals: d20s(oldRoll),
      newNaturals: d20s(newRoll),
      oldTotal: oldRoll?.total ?? null,
      newTotal: newRoll?.total ?? null,
      keep: typeof keepOrOptions === "string" ? keepOrOptions : (keepOrOptions?.keep ?? "new"), // 7.x string, 8.x options object
      resource: typeof resource === "string" ? resource : (resource === true ? "heroPoint" : null),
      ts: Date.now(),
      oldMessageId: null,
    };
  });

  Hooks.on("preDeleteChatMessage", (message, _options, userId) => {
    if (pending && userId === game.userId && !pending.oldMessageId) pending.oldMessageId = message.id;
  });

  Hooks.on("preCreateChatMessage", (doc, _data, _options, userId) => {
    if (!pending) return;
    if (Date.now() - pending.ts > STALE_MS) { pending = null; return; }
    if (userId !== game.userId || !doc.flags?.pf2e?.context?.isReroll) return;
    doc.updateSource({ [`flags.${MODULE_ID}.reroll`]: pending });
    pending = null;
  });
}
