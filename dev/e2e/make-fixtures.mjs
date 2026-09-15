// Generate real chat messages on the dev world and dump them as normalizer fixtures (dev-only).
//
//   node dev/e2e/make-fixtures.mjs            # roll everything, dump test/fixtures/devworld/{messages,meta}.json
//   node dev/e2e/make-fixtures.mjs --dump-only
//
// As Gamemaster: create two level-5 test characters (one with a Longsword), give them hero points, hand
// ownership to PlayerA/PlayerB, then roll one of every message kind the normalizer must recognise.
// As PlayerA: a blind roll and a hero-point reroll on the player's own message (the pf2e.reroll hook
// fires on the rolling client, so the player context records the ground truth for its own reroll).
// Every roll passes skipDialog so nothing blocks in the headless browser. Errors are collected, not fatal.

import { mkdirSync, writeFileSync } from "node:fs";
import { withFoundry, evaluate } from "./foundry.mjs";

const OUT_DIR = new URL("../../test/fixtures/devworld/", import.meta.url);
const dumpOnly = process.argv.includes("--dump-only");

// Records pf2e.reroll hook calls on whichever client runs this, as ground truth for reroll tests.
const HOOK = `(() => {
  globalThis.__rerolls = [];
  Hooks.on("pf2e.reroll", (oldRoll, newRoll, resource, keep) => {
    const d20s = (r) => r.dice.filter(d => d.faces === 20).flatMap(d => d.results.map(x => x.result));
    globalThis.__rerolls.push({ old: d20s(oldRoll), oldTotal: oldRoll.total, new: d20s(newRoll), newTotal: newRoll.total,
      resource, keep: typeof keep === "string" ? keep : keep?.keep ?? null, at: Date.now() });
  });
  return true;
})()`;

const SETUP = `(async () => {
  const out = { errors: [] };
  const specs = [["Test Fighter", "PlayerA"], ["Test Rogue", "PlayerB"]];
  out.actors = [];
  for (const [name, owner] of specs) {
    let a = game.actors.getName(name);
    if (!a) a = await Actor.create({ name, type: "character", system: { details: { level: { value: 5 } } } });
    const user = game.users.getName(owner);
    await a.update({ "system.resources.heroPoints.value": 3, ownership: { default: 0, [game.user.id]: 3, ...(user ? { [user.id]: 3 } : {}) } });
    out.actors.push({ id: a.id, name: a.name, owner });
  }
  const fighter = game.actors.getName("Test Fighter");
  if (!fighter.itemTypes.weapon.length) {
    try {
      const pack = game.packs.get("pf2e.equipment-srd");
      const index = await pack.getIndex();
      const entry = index.find(e => e.name === "Longsword");
      const doc = await pack.getDocument(entry._id);
      await fighter.createEmbeddedDocuments("Item", [doc.toObject()]);
    } catch (e) { out.errors.push("weapon: " + e.message); }
  }
  out.weapons = fighter.itemTypes.weapon.map(w => w.name);
  // Strikes and damage ignore skipDialog; PF2e opens its modifier dialogs unless these user settings are off.
  for (const name of ["Gamemaster", "PlayerA", "PlayerB"]) {
    const u = game.users.getName(name);
    if (u) await u.update({ "flags.pf2e.settings.showCheckDialogs": false, "flags.pf2e.settings.showDamageDialogs": false });
  }
  // Initiative needs an active encounter with the actor as a combatant.
  try {
    if (!game.combat) await Combat.create({ active: true });
    const combat = game.combat ?? game.combats.contents[0];
    for (const a of [fighter, game.actors.getName("Test Rogue")]) {
      if (!combat.combatants.find(c => c.actorId === a.id)) await combat.createEmbeddedDocuments("Combatant", [{ actorId: a.id }]);
    }
    out.combat = combat.id;
  } catch (e) { out.errors.push("combat: " + e.message); }
  return out;
})()`;

// Every step races a timeout: a PF2e dialog that ignores skipDialog would otherwise hang the run.
// On timeout, open windows (AppV1 and AppV2) are closed and the step is reported as an error.
const STEP_HELPERS = `
  const errors = [];
  const last = () => game.messages.contents.at(-1);
  // Close only dialogs (PF2e's CheckModifiersDialog/DamageModifierDialog are AppV1; core DialogV2 is AppV2),
  // never the sidebar/hotbar/HUD applications that also live in foundry.applications.instances.
  const closeAll = async () => {
    for (const w of Object.values(ui.windows)) { if (/Dialog/.test(w.constructor.name)) { try { await w.close({ force: true }); } catch {} } }
    for (const a of foundry.applications.instances.values()) { if (/Dialog/.test(a.constructor.name)) { try { await a.close({ force: true }); } catch {} } }
  };
  const step = async (label, fn, ms = 20000) => {
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timeout " + ms + "ms")), ms); });
    try { await Promise.race([fn(), timeout]); }
    catch (e) { errors.push(label + ": " + e.message); await closeAll(); }
    finally { clearTimeout(timer); }
  };
  const p = { skipDialog: true };
`;

const GM_ROLLS = `(async () => {
  ${STEP_HELPERS}
  const a = game.actors.getName("Test Fighter");
  const b = game.actors.getName("Test Rogue");

  await step("skill", () => a.skills.athletics.roll(p));
  await step("skill+dc", () => a.skills.athletics.roll({ ...p, dc: { value: 15 } }));
  await step("save", () => a.saves.reflex.roll({ ...p, dc: { value: 18 } }));
  await step("perception", () => a.perception.roll(p));
  await step("blind-gm", () => b.skills.stealth.roll({ ...p, rollMode: "blindroll" }));
  await step("gmroll", () => b.skills.thievery.roll({ ...p, rollMode: "gmroll" }));
  await step("fortune", () => a.skills.acrobatics.roll({ ...p, rollTwice: "keep-higher" }));
  await step("misfortune", () => a.skills.acrobatics.roll({ ...p, rollTwice: "keep-lower" }));
  const strike = a.system.actions.find(s => s.item?.isOfType?.("weapon")) ?? a.system.actions[0];
  await step("strike", () => strike.variants[0].roll({}));
  await step("strike-map", () => strike.variants[1].roll({}));   // MAP -5
  await step("damage", () => strike.damage({}));                  // damage-roll message
  await step("strike-blind", () => strike.variants[0].roll({ rollMode: "blindroll" }));
  await step("raw-1d20", () => new Roll("1d20 + 3").toMessage({ speaker: ChatMessage.getSpeaker({ actor: a }) }));
  await step("raw-bare", () => new Roll("1d20").toMessage());
  await step("raw-2d20kh", () => new Roll("2d20kh").toMessage());
  await step("raw-no-d20", () => new Roll("2d6 + 4").toMessage());
  await step("initiative", () => a.initiative.roll(p));
  await step("flat-check", () => game.pf2e.Check.roll(new game.pf2e.CheckModifier("flat-check", { modifiers: [] }), { type: "flat-check", actor: a, dc: { value: 5 }, skipDialog: true }));

  const rerolls = [];
  for (const keep of ["new", "higher", "lower"]) {
    await step("reroll-" + keep, async () => {
      await a.skills.athletics.roll({ ...p, dc: { value: 15 } });
      const original = last();
      const origDie = original.rolls[0].dice.find(d => d.faces === 20).results[0].result;
      await game.pf2e.Check.rerollFromMessage(original, { heroPoint: true, keep });
      rerolls.push({ keep, originalId: original.id, originalNatural: origDie, newMessageId: last().id });
    });
  }
  return { errors, rerolls, hook: globalThis.__rerolls, messages: game.messages.size };
})()`;

const PLAYER_ROLLS = `(async () => {
  ${STEP_HELPERS}
  const a = game.actors.getName("Test Fighter");
  await step("player-skill", () => a.skills.athletics.roll(p));
  await step("player-blind", () => a.skills.stealth.roll({ ...p, rollMode: "blindroll" }));
  await step("player-save", () => a.saves.will.roll({ ...p, dc: { value: 20 } }));
  const rerolls = [];
  await step("player-reroll-new", async () => {
    await a.skills.athletics.roll({ ...p, dc: { value: 15 } });
    const original = last();
    const origDie = original.rolls[0].dice.find(d => d.faces === 20).results[0].result;
    await game.pf2e.Check.rerollFromMessage(original, { heroPoint: true, keep: "new" });
    rerolls.push({ keep: "new", originalId: original.id, originalNatural: origDie, newMessageId: last().id });
  });
  return { errors, rerolls, hook: globalThis.__rerolls, user: game.user.name };
})()`;

const DUMP = `({
  users: game.users.contents.map(u => ({ id: u.id, name: u.name, role: u.role, isGM: u.isGM })),
  actors: game.actors.contents.map(a => ({ id: a.id, name: a.name, type: a.type })),
  messages: game.messages.contents.map(m => m.toObject()),
})`;

const meta = { generatedAt: new Date().toISOString(), gm: null, player: null, setup: null };

if (!dumpOnly) {
  await withFoundry({ user: "Gamemaster" }, async (page, log) => {
    await evaluate(page, HOOK);
    meta.setup = await evaluate(page, SETUP);
    console.log("setup:", JSON.stringify(meta.setup));
    meta.gm = await evaluate(page, GM_ROLLS);
    console.log("gm rolls:", JSON.stringify({ errors: meta.gm.errors, rerolls: meta.gm.rerolls.length, hook: meta.gm.hook.length, messages: meta.gm.messages }));
    const errs = log.filter((l) => /pageerror|\[error\]/.test(l) && !/Chromium version/.test(l));
    if (errs.length) console.log("gm console errors:\n" + errs.join("\n"));
  });
  await withFoundry({ user: "PlayerA" }, async (page, log) => {
    await evaluate(page, HOOK);
    meta.player = await evaluate(page, PLAYER_ROLLS);
    console.log("player rolls:", JSON.stringify({ errors: meta.player.errors, rerolls: meta.player.rerolls.length, hook: meta.player.hook.length }));
    const errs = log.filter((l) => /pageerror|\[error\]/.test(l) && !/Chromium version/.test(l));
    if (errs.length) console.log("player console errors:\n" + errs.join("\n"));
  });
}

await withFoundry({ user: "Gamemaster" }, async (page) => {
  const dump = await evaluate(page, DUMP);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(new URL("messages.json", OUT_DIR), JSON.stringify(dump.messages, null, 1));
  writeFileSync(new URL("meta.json", OUT_DIR), JSON.stringify({ ...meta, users: dump.users, actors: dump.actors }, null, 1));
  const kinds = {};
  for (const m of dump.messages) {
    const t = m.flags?.pf2e?.context?.type ?? (m.flags?.["pf2-flat-check"] ? "pf2-flat-check" : (m.rolls?.length ? "raw-roll" : "no-roll"));
    kinds[t] = (kinds[t] ?? 0) + 1;
  }
  console.log(`dumped ${dump.messages.length} messages to test/fixtures/devworld/: ${JSON.stringify(kinds)}`);
});
