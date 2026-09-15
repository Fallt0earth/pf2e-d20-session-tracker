// The one place that turns settings + viewer identity into view-model options (used by the window and
// the API so a player can never get an unfiltered summary through either path).
import { getSetting, SETTINGS } from "../settings.js";

/**
 * @param {{ currentKey(): string }} source
 * @param {object} [overrides]  Client-side toggles to override (groupBy, countMode, includeGM, includeRaw).
 */
export function viewOptionsFor(source, overrides = {}) {
  const users = Object.fromEntries(game.users.contents.map((u) => [u.id, u.name]));
  const actors = Object.fromEntries(game.actors.contents.map((a) => [a.id, a.name]));
  return {
    countMode: getSetting(SETTINGS.countMode),
    groupBy: getSetting(SETTINGS.groupBy),
    includeGM: getSetting(SETTINGS.includeGM),
    includeRaw: getSetting(SETTINGS.includeRaw),
    ...overrides,
    // Access rules are never overridable from the client side.
    viewer: { isGM: game.user.isGM, userId: game.user.id },
    playerAccess: getSetting(SETTINGS.playerAccess),
    blindPolicy: getSetting(SETTINGS.blindPolicy),
    currentSessionKey: source.currentKey(),
    labels: { users, actors, gmUserIds: game.users.filter((u) => u.isGM).map((u) => u.id) },
  };
}
