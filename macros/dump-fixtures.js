// Foundry Script macro: download recent chat messages as JSON fixtures for the normalizer tests.
// Paste into a Script macro (or the F12 console wrapped in an async function) as GM and execute.
// Collects up to LIMIT_PER_KIND messages per kind from the last DAYS days, plus the user and actor
// name maps, and saves a single JSON file through the browser download dialog. Read-only.
// Anonymize before committing: node dev/anonymize-fixtures.mjs <file>

const DAYS = 30;
const LIMIT_PER_KIND = 25;

const since = Date.now() - DAYS * 86_400_000;
const kindOf = (m) => {
  const type = m.flags?.pf2e?.context?.type;
  if (m.flags?.["pf2-flat-check"]) return "pf2-flat-check";
  if (m.flags?.["pf2e-toolbelt"]?.targetHelper?.saves) return "toolbelt-saves";
  if (type === "damage-roll") return "damage";
  if (typeof type === "string") return m.flags.pf2e.context.isReroll ? `${type}:reroll` : type;
  return m.rolls?.length ? "roll-no-context" : "other";
};

const perKind = {};
const picked = [];
for (const m of game.messages.contents) {
  if (m.timestamp < since) continue;
  const kind = kindOf(m);
  if (kind === "other") continue;
  perKind[kind] = (perKind[kind] ?? 0) + 1;
  if (perKind[kind] <= LIMIT_PER_KIND) picked.push(m.toObject());
}

const dump = {
  exportedAt: new Date().toISOString(),
  foundry: game.version, system: `${game.system.id} ${game.system.version}`,
  modules: game.modules.filter((x) => x.active).map((x) => `${x.id}@${x.version}`),
  users: game.users.contents.map((u) => ({ id: u.id, name: u.name, role: u.role, isGM: u.isGM })),
  actors: game.actors.contents.map((a) => ({ id: a.id, name: a.name, type: a.type })),
  kinds: perKind,
  messages: picked,
};
const filename = `d20-fixtures-${new Date().toISOString().slice(0, 10)}.json`;
foundry.utils.saveDataToFile(JSON.stringify(dump, null, 1), "application/json", filename);
ui.notifications.info(`d20 tracker: ${picked.length} messages (${Object.keys(perKind).length} kinds) saved as ${filename}`);
console.log("d20 tracker | kinds:", perKind);
