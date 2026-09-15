// M0.5 spikes on the dev instance (docs/PLAN.md §5, S1–S7). Each spike prints its findings and saves
// raw dumps under test/fixtures/devworld/spikes/. Exploratory by design: they report, they do not assert.
//
//   node dev/e2e/spikes.mjs s7        # ApplicationV2 TABS, progress notifications
//   node dev/e2e/spikes.mjs s3        # ownership-NONE journal visible to a player client?
//   node dev/e2e/spikes.mjs s1        # player blind roll → createChatMessage on the GM client
//   node dev/e2e/spikes.mjs s4        # reroll enrichment: hook order and preCreate updateSource
//   node dev/e2e/spikes.mjs s2        # 50k-record page: size, write time, join time
//   node dev/e2e/spikes.mjs scene     # create the spike scene with both test tokens (needed by s5/s6)
//   node dev/e2e/spikes.mjs s6        # pf2-flat-check message shape (concealed target), hidden-value variant
//   node dev/e2e/spikes.mjs s5        # Toolbelt target helper: damage message flags, player save from the card

import { mkdirSync, writeFileSync } from "node:fs";
import { openSession, evaluate } from "./foundry.mjs";

const MODULE_ID = "pf2e-d20-session-tracker";
const OUT = new URL("../../test/fixtures/devworld/spikes/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const save = (name, data) => { writeFileSync(new URL(name, OUT), JSON.stringify(data, null, 1)); console.log(`saved spikes/${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (label, data) => console.log(label, JSON.stringify(data, null, 1));

const D20S = `const d20s = (r) => r.dice.filter(d => d.faces === 20).flatMap(d => d.results.map(x => x.result));`;

const spikes = {
  async s7() {
    const gm = await openSession({ user: "Gamemaster" });
    try {
      show("S7", await evaluate(gm.page, `({
        appV2HasTABS: "TABS" in foundry.applications.api.ApplicationV2,
        appV2HasPrepareTabs: typeof foundry.applications.api.ApplicationV2.prototype._prepareTabs === "function",
        handlebarsMixin: typeof foundry.applications.api.HandlebarsApplicationMixin === "function",
        notificationsProgress: (() => { const n = ui.notifications.info("spike", { progress: true }); const r = { type: typeof n, keys: Object.keys(n ?? {}).slice(0, 12), hasUpdate: typeof n?.update === "function", hasNotificationsUpdate: typeof ui.notifications.update === "function" }; try { if (n?.update) n.update({ pct: 1 }); else ui.notifications.update(n, { pct: 1 }); } catch (e) { r.updateError = e.message; } return r; })(),
        saveDataToFile: typeof foundry.utils.saveDataToFile === "function",
        sceneControlsRecord: !Array.isArray(ui.controls.controls) && typeof ui.controls.controls === "object",
        controlKeys: Object.keys(ui.controls.controls ?? {}),
        mersenne: typeof foundry.dice.MersenneTwister === "function",
        activeGM: game.users.activeGM?.name ?? null,
        renderPlayersHook: true,
      })`));
    } finally { await gm.close(); }
  },

  async s3() {
    const gm = await openSession({ user: "Gamemaster" });
    const player = await openSession({ user: "PlayerA" });
    try {
      const created = await evaluate(gm.page, `(async () => {
        const j = await JournalEntry.create({ name: "d20 spike s3", ownership: { default: 0 }, flags: { "${MODULE_ID}": { isLog: true } } });
        const [p] = await j.createEmbeddedDocuments("JournalEntryPage", [{ name: "2026-09-15", type: "text", flags: { "${MODULE_ID}": { v: 1, records: [{ id: "x", natural: 17, blind: true }] } } }]);
        return { journalId: j.id, pageId: p.id };
      })()`);
      await sleep(1500);
      const seen = await evaluate(player.page, `(() => {
        const j = game.journal.get("${created.journalId}");
        const p = j?.pages?.get("${created.pageId}");
        return { journalPresent: !!j, visible: j?.visible ?? null, observer: j?.testUserPermission(game.user, "OBSERVER") ?? null,
                 pagePresent: !!p, pageFlag: p?.flags?.["${MODULE_ID}"] ?? null, journalCount: game.journal.size };
      })()`);
      show("S3 player view of ownership-NONE journal:", seen);
      // live update delivery
      await evaluate(gm.page, `(async () => { const p = game.journal.get("${created.journalId}").pages.get("${created.pageId}"); await p.update({ "flags.${MODULE_ID}.records": [{ id: "x", natural: 17 }, { id: "y", natural: 3 }] }); })()`);
      await sleep(1500);
      const after = await evaluate(player.page, `game.journal.get("${created.journalId}")?.pages?.get("${created.pageId}")?.flags?.["${MODULE_ID}"]?.records?.length ?? null`);
      show("S3 player sees page update (records length):", after);
      save("s3.json", { created, seen, after });
      await evaluate(gm.page, `game.journal.get("${created.journalId}").delete()`);
    } finally { await gm.close(); await player.close(); }
  },

  async s1() {
    const gm = await openSession({ user: "Gamemaster" });
    const player = await openSession({ user: "PlayerA" });
    try {
      await evaluate(gm.page, `(() => { globalThis.__seen = []; Hooks.on("createChatMessage", (m, opts, userId) => { ${D20S} globalThis.__seen.push({ id: m.id, blind: m.blind, whisper: m.whisper.map(String), rolls: m.rolls.length, naturals: m.rolls.flatMap(d20s), userId, isContentVisible: m.isContentVisible, visible: m.visible, type: m.flags.pf2e?.context?.type ?? null }); }); return true; })()`);
      const rolled = await evaluate(player.page, `(async () => { ${D20S} const a = game.actors.getName("Test Fighter"); await a.skills.stealth.roll({ skipDialog: true, rollMode: "blindroll" }); await a.saves.reflex.roll({ skipDialog: true, rollMode: "gmroll" }); await a.skills.athletics.roll({ skipDialog: true }); const ms = game.messages.contents.slice(-3); return ms.map(m => ({ id: m.id, blind: m.blind, naturals: m.rolls.flatMap(d20s), visibleToPlayer: m.isContentVisible })); })()`);
      await sleep(2000);
      const seen = await evaluate(gm.page, `globalThis.__seen`);
      show("S1 player rolled:", rolled);
      show("S1 GM createChatMessage saw:", seen);
      save("s1.json", { rolled, seen });
    } finally { await gm.close(); await player.close(); }
  },

  async s4() {
    const gm = await openSession({ user: "Gamemaster" });
    const player = await openSession({ user: "PlayerA" });
    try {
      const result = await evaluate(player.page, `(async () => {
        ${D20S}
        globalThis.__order = []; let pending = null;
        Hooks.on("pf2e.reroll", (oldRoll, newRoll, resource, keep) => { __order.push(["pf2e.reroll", performance.now()]); pending = { oldNaturals: d20s(oldRoll), newNaturals: d20s(newRoll), oldTotal: oldRoll.total, newTotal: newRoll.total, keep: typeof keep === "string" ? keep : (keep?.keep ?? "new"), resource, ts: Date.now() }; });
        Hooks.on("preDeleteChatMessage", (msg, opts, userId) => { __order.push(["preDeleteChatMessage", performance.now(), msg.id, userId === game.userId]); if (pending && userId === game.userId && !pending.oldMessageId) pending.oldMessageId = msg.id; });
        Hooks.on("preCreateChatMessage", (doc, data, opts, userId) => { __order.push(["preCreateChatMessage", performance.now(), !!doc.flags?.pf2e?.context?.isReroll, userId === game.userId]); if (pending && userId === game.userId && doc.flags?.pf2e?.context?.isReroll) { doc.updateSource({ ["flags.${MODULE_ID}.reroll"]: pending }); pending = null; } });
        const a = game.actors.getName("Test Fighter");
        await a.skills.athletics.roll({ skipDialog: true, dc: { value: 15 } });
        const original = game.messages.contents.at(-1);
        const originalNatural = original.rolls.flatMap(d20s)[0];
        await game.pf2e.Check.rerollFromMessage(original, { heroPoint: true, keep: "higher" });
        const m = game.messages.contents.at(-1);
        return { order: __order, originalId: original.id, originalNatural, newMessageId: m.id, shownNatural: m.rolls.flatMap(d20s)[0], flag: m.flags?.["${MODULE_ID}"] ?? null, resource: pending?.resource };
      })()`);
      await sleep(1500);
      const gmView = await evaluate(gm.page, `(() => { const m = game.messages.get("${result.newMessageId}"); return { present: !!m, flag: m?.flags?.["${MODULE_ID}"] ?? null, isReroll: m?.flags?.pf2e?.context?.isReroll ?? null, originalStillExists: !!game.messages.get("${result.originalId}") }; })()`);
      show("S4 rolling client:", result);
      show("S4 GM client sees the enrichment flag:", gmView);
      save("s4.json", { result, gmView });
    } finally { await gm.close(); await player.close(); }
  },

  async s2() {
    const baseline = await openSession({ user: "Gamemaster" });
    const joinBefore = baseline.joinMs;
    const created = await evaluate(baseline.page, `(async () => {
      const N = 50000;
      const records = Array.from({ length: N }, (_, i) => ({ id: "m" + i + ":r0:t0:d0", msgId: "m" + i, dieIndex: 0, ts: Date.now() - i * 1000, sessionKey: "2026-09-15", userId: "abcdefghijklmnop", actorId: "qrstuvwxyzabcdef", tokenId: null, alias: "Test Fighter", natural: (i % 20) + 1, kept: true, formula: "1d20", total: (i % 20) + 6, type: "skill-check", source: "pf2e-check", domains: ["all", "check", "skill-check", "athletics", "str-based", "str-skill-check"], ident: "athletics", action: null, dc: 15, dcVisible: true, outcome: "success", unadjustedOutcome: "success", isReroll: false, rollTwice: null, mode: "roll", blind: false, whispered: false, inCombat: null }));
      const bytes = JSON.stringify(records).length;
      const j = await JournalEntry.create({ name: "d20 spike s2", ownership: { default: 0 } });
      const t1 = performance.now();
      const [page] = await j.createEmbeddedDocuments("JournalEntryPage", [{ name: "2026-09-15", type: "text", flags: { "${MODULE_ID}": { v: 1, records } } }]);
      const t2 = performance.now();
      await page.update({ ["flags.${MODULE_ID}.records"]: [...records, records[0]] });
      const t3 = performance.now();
      const t4 = performance.now();
      const n = game.journal.get(j.id).pages.get(page.id).flags["${MODULE_ID}"].records.length;
      const t5 = performance.now();
      return { N, bytes, createMs: Math.round(t2 - t1), updateMs: Math.round(t3 - t2), readMs: Math.round(t5 - t4), readBack: n, journalId: j.id };
    })()`);
    await baseline.close();
    const second = await openSession({ user: "Gamemaster" });
    const joinAfter = second.joinMs;
    await evaluate(second.page, `game.journal.get("${created.journalId}").delete()`);
    await second.close();
    const third = await openSession({ user: "Gamemaster" });
    const joinCleaned = third.joinMs;
    await third.close();
    const out = { ...created, joinMsBefore: joinBefore, joinMsWith50k: joinAfter, joinMsAfterDelete: joinCleaned };
    show("S2 50k-record page:", out);
    save("s2.json", out);
  },

  async scene() {
    const gm = await openSession({ user: "Gamemaster" });
    try {
      show("scene", await evaluate(gm.page, `(async () => {
        let scene = game.scenes.getName("d20 spike");
        if (!scene) scene = await Scene.create({ name: "d20 spike", width: 1500, height: 1000, grid: { size: 100 }, padding: 0, tokenVision: false, fog: { exploration: false } });
        const fighter = game.actors.getName("Test Fighter"), rogue = game.actors.getName("Test Rogue");
        const existing = scene.tokens.contents.map(t => t.actorId);
        const docs = [];
        if (!existing.includes(fighter.id)) docs.push((await fighter.getTokenDocument({ x: 300, y: 300 })).toObject());
        if (!existing.includes(rogue.id)) docs.push((await rogue.getTokenDocument({ x: 500, y: 300 })).toObject());
        if (docs.length) await scene.createEmbeddedDocuments("Token", docs);
        if (!scene.active) await scene.activate();
        return { sceneId: scene.id, tokens: scene.tokens.contents.map(t => ({ id: t.id, actor: t.actorId, name: t.name })) };
      })()`));
    } finally { await gm.close(); }
  },

  async s6() {
    const gm = await openSession({ user: "Gamemaster" });
    try {
      const out = await evaluate(gm.page, `(async () => {
        const scene = game.scenes.getName("d20 spike"); if (!scene?.active) await scene.activate();
        const fighter = game.actors.getName("Test Fighter"), rogue = game.actors.getName("Test Rogue");
        const rogueToken = scene.tokens.contents.find(t => t.actorId === rogue.id);
        const settings = [...game.settings.settings.keys()].filter(k => k.startsWith("pf2-flat-check"));
        const settingValues = Object.fromEntries(settings.map(k => { const [ns, ...rest] = k.split("."); try { return [k, game.settings.get(ns, rest.join("."))]; } catch { return [k, "?"]; } }));
        if (!rogue.hasCondition?.("concealed")) await rogue.increaseCondition("concealed");
        canvas.tokens.get(rogueToken.id).setTarget(true, { releaseOthers: true });
        const before = game.messages.size;
        const strike = fighter.system.actions.find(s => s.item?.isOfType?.("weapon")) ?? fighter.system.actions[0];
        await strike.variants[0].roll({});
        await new Promise(r => setTimeout(r, 2500));
        const newMsgs = game.messages.contents.slice(before).map(m => m.toObject());
        const flat = newMsgs.filter(m => m.flags?.["pf2-flat-check"]);
        return { settings: settingValues, newMessages: newMsgs.length, flatMessages: flat, others: newMsgs.filter(m => !m.flags?.["pf2-flat-check"]).map(m => ({ id: m._id, type: m.flags?.pf2e?.context?.type })) };
      })()`);
      show("S6 pf2-flat-check settings:", out.settings);
      show("S6 flat-check messages:", out.flatMessages.map((m) => ({ id: m._id, author: m.author, speaker: m.speaker, blind: m.blind, whisper: m.whisper, rolls: m.rolls, flags: m.flags, content: m.content })));
      save("s6.json", out);
      // hidden-value variant
      const hiddenKey = Object.keys(out.settings).find((k) => /hide/i.test(k));
      if (hiddenKey) {
        const [ns, ...rest] = hiddenKey.split(".");
        const out2 = await evaluate(gm.page, `(async () => {
          await game.settings.set("${ns}", "${rest.join(".")}", true);
          const fighter = game.actors.getName("Test Fighter");
          const before = game.messages.size;
          const strike = fighter.system.actions.find(s => s.item?.isOfType?.("weapon")) ?? fighter.system.actions[0];
          await strike.variants[0].roll({});
          await new Promise(r => setTimeout(r, 2500));
          const flat = game.messages.contents.slice(before).map(m => m.toObject()).filter(m => m.flags?.["pf2-flat-check"]);
          await game.settings.set("${ns}", "${rest.join(".")}", false);
          return flat;
        })()`);
        show("S6 hidden-value flat-check content:", out2.map((m) => m.content));
        save("s6-hidden.json", out2);
      }
    } finally { await gm.close(); }
  },

  async s5() {
    // Target Helper is off by default; turning it on registers hooks at init, so enable, then reopen.
    {
      const pre = await openSession({ user: "Gamemaster" });
      const changed = await evaluate(pre.page, `(async () => { if (!game.settings.get("pf2e-toolbelt", "targetHelper.enabled")) { await game.settings.set("pf2e-toolbelt", "targetHelper.enabled", true); return true; } return false; })()`);
      await pre.close();
      console.log("S5 targetHelper.enabled set:", changed);
    }
    const gm = await openSession({ user: "Gamemaster" });
    const player = await openSession({ user: "PlayerB" });
    try {
      const setup = await evaluate(gm.page, `(async () => {
        const errors = [];
        const scene = game.scenes.getName("d20 spike"); if (!scene?.active) await scene.activate();
        const fighter = game.actors.getName("Test Fighter"), rogue = game.actors.getName("Test Rogue");
        const rogueToken = scene.tokens.contents.find(t => t.actorId === rogue.id);
        const settings = [...game.settings.settings.keys()].filter(k => k.startsWith("pf2e-toolbelt"));
        const values = Object.fromEntries(settings.map(k => { const [ns, ...rest] = k.split("."); try { const v = game.settings.get(ns, rest.join(".")); return [k, typeof v === "object" ? JSON.stringify(v).slice(0, 200) : v]; } catch { return [k, "?"]; } }));
        // Toolbelt only renders save buttons for damage with a save: give the fighter an innate Fireball.
        let entry = fighter.itemTypes.spellcastingEntry.find(e => e.name === "Spike Innate");
        if (!entry) [entry] = await fighter.createEmbeddedDocuments("Item", [{ name: "Spike Innate", type: "spellcastingEntry", system: { prepared: { value: "innate" }, tradition: { value: "arcane" }, ability: { value: "cha" }, showSlotlessLevels: { value: true } } }]);
        let fireball = fighter.itemTypes.spell.find(s => s.name === "Fireball");
        if (!fireball) {
          const pack = game.packs.get("pf2e.spells-srd"); const idx = await pack.getIndex(); const e = idx.find(x => x.name === "Fireball");
          const doc = await pack.getDocument(e._id); const data = doc.toObject(); data.system.location = { value: entry.id };
          [fireball] = await fighter.createEmbeddedDocuments("Item", [data]);
        }
        canvas.tokens.get(rogueToken.id).setTarget(true, { releaseOthers: true });
        const before = game.messages.size;
        let how = null;
        try { await fireball.rollDamage({}); how = "spell.rollDamage"; } catch (e) { errors.push("rollDamage: " + e.message); }
        await new Promise(r => setTimeout(r, 2500));
        if (game.messages.size === before) {
          try {
            await fireball.toMessage(); await new Promise(r => setTimeout(r, 1500));
            const card = document.querySelector('li.chat-message[data-message-id="' + game.messages.contents.at(-1).id + '"]');
            const btn = card?.querySelector('[data-action="spell-damage"], button[data-action*="damage"]');
            if (btn) { btn.click(); how = "card button " + btn.dataset.action; } else errors.push("no damage button on spell card");
            await new Promise(r => setTimeout(r, 3000));
          } catch (e) { errors.push("toMessage: " + e.message); }
        }
        const dmg = game.messages.contents.slice(before).map(m => m.toObject()).filter(m => m.flags?.pf2e?.context?.type === "damage-roll");
        const api = game.modules.get("pf2e-toolbelt")?.api ? Object.keys(game.modules.get("pf2e-toolbelt").api) : null;
        return { errors, how, settings: values, damage: dmg, toolbeltApi: api, rogueTokenId: rogueToken.id, spell: fireball?.name ?? null };
      })()`);
      show("S5 setup:", { errors: setup.errors, how: setup.how, spell: setup.spell });
      show("S5 toolbelt settings:", setup.settings);
      show("S5 toolbelt api keys:", setup.toolbeltApi);
      show("S5 damage message flags:", setup.damage.map((m) => ({ id: m._id, flags: m.flags })));
      save("s5-setup.json", setup);
      const dmgId = setup.damage.at(-1)?._id;
      if (dmgId) {
        await sleep(1500);
        const clicked = await evaluate(player.page, `(async () => {
          const li = document.querySelector('li.chat-message[data-message-id="${dmgId}"]');
          if (!li) return { found: false, chatCount: document.querySelectorAll("li.chat-message").length };
          const buttons = [...li.querySelectorAll("button, a, [data-action]")].map(b => ({ tag: b.tagName, action: b.dataset.action ?? null, cls: b.className, text: b.textContent.trim().slice(0, 40) }));
          const saveBtn = [...li.querySelectorAll("[data-action], button")].find(b => /save/i.test((b.dataset.action ?? "") + " " + b.className + " " + b.textContent));
          if (saveBtn) saveBtn.click();
          await new Promise(r => setTimeout(r, 3000));
          const m = game.messages.get("${dmgId}");
          return { found: true, buttons, clicked: !!saveBtn, flagsAfter: m.flags["pf2e-toolbelt"] ?? null, newMessages: game.messages.contents.slice(-2).map(x => ({ id: x.id, type: x.flags?.pf2e?.context?.type ?? null })) , html: li.outerHTML.slice(0, 4000) };
        })()`);
        show("S5 player card buttons:", clicked.buttons);
        show("S5 clicked/flags after:", { clicked: clicked.clicked, flagsAfter: clicked.flagsAfter, newMessages: clicked.newMessages });
        save("s5-click.json", clicked);
        await sleep(1000);
        const gmAfter = await evaluate(gm.page, `game.messages.get("${dmgId}")?.flags?.["pf2e-toolbelt"] ?? null`);
        show("S5 GM sees flags:", gmAfter);
        save("s5-after.json", gmAfter);
      }
    } finally { await gm.close(); await player.close(); }
  },
};

const name = process.argv[2];
if (!spikes[name]) { console.log("usage: node dev/e2e/spikes.mjs " + Object.keys(spikes).join("|")); process.exit(1); }
await spikes[name]();
