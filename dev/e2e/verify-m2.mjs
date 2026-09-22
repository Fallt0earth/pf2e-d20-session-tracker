// M2 end-to-end verification on the dev instance (SCOPE §9 items 1–3, 5, 6, 8, 10 and the Toolbelt path).
//   node dev/e2e/verify-m2.mjs
// Sequence: GM writer online → PlayerA rolls (public, blind, save+DC, raw, fortune, hero-point reroll)
// → records land in the store and the journal; the player mirror sees them; GM reload keeps them and
// catch-up adds nothing; a full chat flush keeps them; Toolbelt save from PlayerB is attributed to
// PlayerB; pause stops capture; an Assistant GM is not the writer. Prints PASS/FAIL per check.
import { openSession, evaluate } from "./foundry.mjs";

const MODULE_ID = "pf2e-d20-session-tracker";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const API = `game.modules.get("${MODULE_ID}").api`;
const D20S = `const d20s = (r) => r.dice.filter(d => d.faces === 20).flatMap(d => d.results.map(x => x.result));`;

const summary = (page) => evaluate(page, `(() => {
  const api = ${API}; const key = api.sessionKeyFor(Date.now()); const recs = api.getSession(key);
  const by = (f) => recs.reduce((o, r) => { const k = String(r[f]); o[k] = (o[k] ?? 0) + 1; return o; }, {});
  const journalId = game.settings.get("${MODULE_ID}", "logJournalId");
  const journal = game.journal.get(journalId);
  const pg = journal?.pages.find(p => p.flags["${MODULE_ID}"]?.key === key);
  return { key, n: recs.length, bySource: by("source"), byType: by("type"), blind: recs.filter(r => r.blind).length,
           rerolls: recs.filter(r => r.isReroll).map(r => ({ id: r.id, natural: r.natural, kept: r.kept, rerollOf: r.rerollOf ?? null, source: r.source })),
           rerolledAway: recs.filter(r => r.rerolledBy).map(r => ({ id: r.id, natural: r.natural, kept: r.kept, rerollOutcome: r.rerollOutcome })),
           toolbelt: recs.filter(r => r.source === "toolbelt").map(r => ({ id: r.id, natural: r.natural, userId: r.userId, actorId: r.actorId, alias: r.alias, outcome: r.outcome, dc: r.dc })),
           journalPresent: !!journal, pagePresent: !!pg, pageRows: (r => Array.isArray(r) ? r.length : r ? Object.keys(r).length : null)(pg?.flags["${MODULE_ID}"]?.data?.rows), pageBytes: pg ? JSON.stringify(pg.flags["${MODULE_ID}"]).length : null };
})()`);

const gm = await openSession({ user: "Gamemaster" });
const roleLine = gm.log.find((l) => /d20 Session Tracker \| ready/.test(l)) ?? "";
check("GM client reports itself as the writer", /— writer,/.test(roleLine), roleLine.replace(/^\[log\] /, ""));
const before = await summary(gm.page);
console.log("before:", JSON.stringify({ n: before.n, bySource: before.bySource, journalPresent: before.journalPresent }));

const player = await openSession({ user: "PlayerA" });
const rolled = await evaluate(player.page, `(async () => {
  ${D20S}
  const a = game.actors.getName("Test Fighter"); const p = { skipDialog: true }; const out = { errors: [] };
  const step = async (l, f) => { try { await f(); } catch (e) { out.errors.push(l + ": " + e.message); } };
  await step("skill", () => a.skills.athletics.roll(p));
  await step("blind", () => a.skills.stealth.roll({ ...p, rollMode: "blindroll" }));
  await step("save", () => a.saves.reflex.roll({ ...p, dc: { value: 18 } }));
  await step("raw", () => new Roll("1d20").toMessage());
  await step("fortune", () => a.skills.acrobatics.roll({ ...p, rollTwice: "keep-higher" }));
  await step("reroll", async () => {
    await a.skills.athletics.roll({ ...p, dc: { value: 15 } });
    const original = game.messages.contents.at(-1);
    out.originalId = original.id; out.originalNatural = original.rolls.flatMap(d20s)[0];
    await game.pf2e.Check.rerollFromMessage(original, { heroPoint: true, keep: "higher" });
    const m = game.messages.contents.at(-1); out.newId = m.id; out.shownNatural = m.rolls.flatMap(d20s)[0]; out.flag = m.flags["${MODULE_ID}"]?.reroll ?? null;
  });
  return out;
})()`);
check("PlayerA rolled the six message kinds without errors", rolled.errors.length === 0, rolled.errors.join("; "));
check("reroll message carries the roller-side enrichment flag", !!rolled.flag && rolled.flag.oldMessageId === rolled.originalId, JSON.stringify(rolled.flag));
await sleep(3000);

const after = await summary(gm.page);
const delta = after.n - before.n;
// Expected physical dice: skill 1 + blind 1 + save 1 + raw 1 + fortune 2 + reroll (original + new) 2 = 8
check("GM store gained 8 physical dice", delta === 8, `gained ${delta}; bySource ${JSON.stringify(after.bySource)}`);
check("blind roll captured on the GM", after.blind >= before.blind + 1, `blind ${after.blind}`);
const pair = { original: after.rerolledAway.find((r) => r.id.startsWith(rolled.originalId)), fresh: after.rerolls.find((r) => r.id.startsWith(rolled.newId)) };
check("reroll pair: original die marked, new die recorded, exactly one kept", !!pair.original && !!pair.fresh && (pair.original.kept !== pair.fresh.kept) && pair.fresh.source === "reroll-enrich", JSON.stringify(pair));
check("journal page written with compact rows", after.journalPresent && after.pagePresent && after.pageRows >= after.n - 1, `rows ${after.pageRows}, records ${after.n}, ${after.pageBytes} bytes`);

const playerView = await evaluate(player.page, `(() => { const api = ${API}; const key = api.sessionKeyFor(Date.now()); const recs = api.getSession(key); const model = api.summarize(key); const me = model.rows.find(r => r.id === game.user.id); return { mirrored: recs.length, storeBlind: recs.filter(r => r.blind).length, myRow: me ? { n: me.luck.n, secret: me.secret } : null, visible: model.visible, total: model.total }; })()`);
check("player client mirrors the journal live", playerView.mirrored === after.n, `player sees ${playerView.mirrored} of ${after.n}`);
check("player view hides tonight's secret rolls", playerView.myRow && playerView.myRow.secret === 0 && playerView.visible < playerView.total, JSON.stringify(playerView));

await gm.close();
const gm2 = await openSession({ user: "Gamemaster" });
const catchLine = gm2.log.find((l) => /catch-up added/.test(l)) ?? "(no catch-up additions)";
const reloaded = await summary(gm2.page);
check("records persist across a GM reload; catch-up adds nothing new", reloaded.n === after.n && !/catch-up added [1-9]/.test(catchLine), `${reloaded.n} vs ${after.n}; ${catchLine}`);

// Chat flush: delete every chat message, records must survive.
const flushed = await evaluate(gm2.page, `(async () => { const ids = game.messages.contents.map(m => m.id); for (let i = 0; i < ids.length; i += 100) await ChatMessage.deleteDocuments(ids.slice(i, i + 100)); return { deleted: ids.length, left: game.messages.size }; })()`);
await sleep(1000);
const postFlush = await summary(gm2.page);
check("records survive a full chat flush", flushed.left === 0 && postFlush.n === after.n, `deleted ${flushed.deleted}, records ${postFlush.n}`);
const catchAfterFlush = await evaluate(gm2.page, `${API}.catchUp()`);
check("catch-up after the flush is a no-op", catchAfterFlush.added === 0, JSON.stringify(catchAfterFlush));

// Toolbelt save from PlayerB on a targeted Fireball.
const playerB = await openSession({ user: "PlayerB" });
const dmg = await evaluate(gm2.page, `(async () => {
  const scene = game.scenes.getName("d20 spike"); if (!scene?.active) await scene.activate();
  const fighter = game.actors.getName("Test Fighter"), rogue = game.actors.getName("Test Rogue");
  const rogueToken = scene.tokens.contents.find(t => t.actorId === rogue.id);
  canvas.tokens.get(rogueToken.id).setTarget(true, { releaseOthers: true });
  const fireball = fighter.itemTypes.spell.find(s => s.name === "Fireball");
  const before = game.messages.size;
  await fireball.rollDamage({});
  await new Promise(r => setTimeout(r, 2000));
  const m = game.messages.contents.slice(before).find(x => x.flags?.pf2e?.context?.type === "damage-roll");
  return { id: m?.id ?? null, hasTargets: !!m?.flags?.["pf2e-toolbelt"]?.targetHelper?.targets?.length };
})()`);
await sleep(1500);
const clicked = await evaluate(playerB.page, `(async () => {
  const li = document.querySelector('li.chat-message[data-message-id="${dmg.id}"]');
  const btn = li?.querySelector('[data-action="roll-save"]');
  if (!btn) return { found: !!li, clicked: false };
  btn.click(); await new Promise(r => setTimeout(r, 3000));
  const save = Object.values(game.messages.get("${dmg.id}").flags["pf2e-toolbelt"]?.targetHelper?.saveVariants ?? {})[0]?.saves;
  return { found: true, clicked: true, save: save ? Object.values(save)[0]?.die : null, userId: game.user.id };
})()`);
await sleep(2500);
const withSave = await summary(gm2.page);
const tb = withSave.toolbelt.find((r) => r.id.startsWith(dmg.id));
check("Toolbelt save captured from the damage message update", !!tb && tb.natural === clicked.save, JSON.stringify({ clicked, tb }));
check("Toolbelt save attributed to PlayerB with the Rogue as actor", !!tb && tb.userId === clicked.userId && !!tb.actorId, JSON.stringify(tb));

// Pause capture: a player roll must not be recorded.
await evaluate(gm2.page, `game.settings.set("${MODULE_ID}", "captureEnabled", false)`);
await sleep(500);
await evaluate(player.page, `game.actors.getName("Test Fighter").skills.athletics.roll({ skipDialog: true })`);
await sleep(2000);
const paused = await summary(gm2.page);
check("paused capture records nothing", paused.n === withSave.n, `${paused.n} vs ${withSave.n}`);
await evaluate(gm2.page, `game.settings.set("${MODULE_ID}", "captureEnabled", true)`);
const caught = await evaluate(gm2.page, `${API}.catchUp()`);
check("catch-up recovers the roll made while paused", caught.added === 1, JSON.stringify(caught));

// Second GM: an Assistant is online but not the writer.
await evaluate(gm2.page, `(async () => { if (!game.users.getName("Assistant")) await User.create({ name: "Assistant", role: CONST.USER_ROLES.ASSISTANT }); return true; })()`);
const assistant = await openSession({ user: "Assistant" });
const aRole = assistant.log.find((l) => /d20 Session Tracker \| ready/.test(l)) ?? "";
check("Assistant GM is not the writer while the Gamemaster is online", /gm \(not writer\)/.test(aRole), aRole.replace(/^\[log\] /, ""));
await evaluate(player.page, `game.actors.getName("Test Fighter").skills.athletics.roll({ skipDialog: true })`);
await sleep(2500);
const twoGMs = await summary(gm2.page);
check("one roll with two GMs online yields exactly one record", twoGMs.n === paused.n + 2, `${twoGMs.n} vs ${paused.n + 2} (paused count + caught-up roll + this roll)`);

await Promise.all([assistant.close(), playerB.close(), player.close(), gm2.close()]);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
