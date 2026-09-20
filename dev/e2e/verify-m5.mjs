// M5 end-to-end verification on the dev instance: configurable session definition + GM access control.
//   node dev/e2e/verify-m5.mjs
// Uses raw d20 messages with SIMULATED timestamps in January 2026 so nothing of today's data is touched,
// then re-buckets the whole store daily → gap → daily and checks the real sessions come back unchanged.
// Cleans up after itself (test sessions, test chat messages, settings).
import { openSession, evaluate } from "./foundry.mjs";

const MODULE_ID = "pf2e-d20-session-tracker";
const API = `game.modules.get("${MODULE_ID}").api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// Chicago in January is CST = UTC-6.
const cst = (d, h, mi = 0) => Date.UTC(2026, 0, d, h + 6, mi);
const OVERNIGHT = [cst(10, 22), cst(10, 23, 40), cst(11, 2), cst(11, 5, 30), cst(11, 7, 30)]; // Sat 22:00 → Sun 07:30
const SUNDAY_EVENING = [cst(11, 20), cst(11, 22)];
const TWO_GAMES = [cst(17, 13), cst(17, 15), cst(17, 21), cst(17, 23)];                      // 13:00–15:00 and 21:00–23:00

const HELPERS = `
  const api = ${API}; const store = api.store;
  const setS = (k, v) => game.settings.set("${MODULE_ID}", k, v);
  const rollAt = async (ts) => { const roll = await new Roll("1d20").evaluate(); return ChatMessage.create({ rolls: [roll], timestamp: ts, speaker: { alias: "e2e-m5" }, flags: { "${MODULE_ID}": { e2e: true } } }); };
  const layout = (prefix) => Object.fromEntries(store.listSessions().filter(s => !prefix || s.key.startsWith(prefix)).map(s => [s.key, s.n]).sort());
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
`;

const gm = await openSession({ user: "Gamemaster" });
try {
  const initial = await evaluate(gm.page, `(async () => { ${HELPERS}
    await store.flush();
    return { mode: api.sessionConfig().mode, gap: api.sessionConfig().gapHours, access: game.settings.get("${MODULE_ID}", "playerAccess"), all: layout("") };
  })()`);
  console.log("initial:", JSON.stringify(initial));

  // ---- gap mode with simulated timestamps -------------------------------------------------------
  const gap = await evaluate(gm.page, `(async () => { ${HELPERS}
    await setS("sessionMode", "gap"); await setS("sessionGapHours", 5);
    for (const ts of ${JSON.stringify([...OVERNIGHT, ...SUNDAY_EVENING, ...TWO_GAMES])}) await rollAt(ts);
    await wait(1500); await store.flush();
    const j = game.journal.get(game.settings.get("${MODULE_ID}", "logJournalId"));
    return { jan: layout("2026-01"), pages: j.pages.filter(p => (p.flags["${MODULE_ID}"]?.key ?? "").startsWith("2026-01")).map(p => p.flags["${MODULE_ID}"].key).sort(), current: api.currentKey(), config: api.sessionConfig() };
  })()`);
  check("gap mode: overnight game across midnight and 06:00 is ONE session", gap.jan["2026-01-10"] === 5, JSON.stringify(gap.jan));
  check("gap mode: next evening is its own session", gap.jan["2026-01-11"] === 2);
  check("gap mode: two games on one date → date and date~2", gap.jan["2026-01-17"] === 2 && gap.jan["2026-01-17~2"] === 2);
  check("gap mode: one journal page per session", JSON.stringify(gap.pages) === JSON.stringify(["2026-01-10", "2026-01-11", "2026-01-17", "2026-01-17~2"]), JSON.stringify(gap.pages));

  // ---- re-bucket: gap → daily → gap, and the real data round-trips ---------------------------------
  const toDaily = await evaluate(gm.page, `(async () => { ${HELPERS}
    await setS("sessionMode", "daily"); await setS("boundaryHour", 6);
    const plan = store.planRebucket();
    await store.applyRebucket(plan.after);
    return { diff: { moved: plan.diff.moved, created: plan.diff.created, removed: plan.diff.removed }, jan: layout("2026-01"), all: layout("") };
  })()`);
  check("re-bucket to daily: the 06:00 turnover splits the overnight game (4 + 3), ~2 disappears", toDaily.jan["2026-01-10"] === 4 && toDaily.jan["2026-01-11"] === 3 && toDaily.jan["2026-01-17"] === 4 && !("2026-01-17~2" in toDaily.jan), JSON.stringify(toDaily.jan));
  const realBefore = Object.fromEntries(Object.entries(initial.all).filter(([k]) => !k.startsWith("2026-01")));
  const realAfterDaily = Object.fromEntries(Object.entries(toDaily.all).filter(([k]) => !k.startsWith("2026-01")));
  check("re-bucket to daily leaves the real (already daily) sessions untouched", JSON.stringify(realBefore) === JSON.stringify(realAfterDaily), `${JSON.stringify(realBefore)} vs ${JSON.stringify(realAfterDaily)}`);

  const backToGap = await evaluate(gm.page, `(async () => { ${HELPERS}
    await setS("sessionMode", "gap");
    const plan = store.planRebucket(); await store.applyRebucket(plan.after);
    const jan = layout("2026-01");
    const again = store.planRebucket();
    return { jan, idempotentMoved: again.diff.moved };
  })()`);
  check("re-bucket back to gap restores the gap layout", JSON.stringify(backToGap.jan) === JSON.stringify(gap.jan), JSON.stringify(backToGap.jan));
  check("re-bucket is idempotent", backToGap.idempotentMoved === 0);

  // ---- split and merge ------------------------------------------------------------------------------
  const splitMerge = await evaluate(gm.page, `(async () => { ${HELPERS}
    const newKey = await store.splitSession("2026-01-10", ${OVERNIGHT[3]});
    const afterSplit = layout("2026-01-1");
    await store.mergeSessions(newKey, store.previousKey(newKey));
    return { newKey, afterSplit, afterMerge: layout("2026-01-1") };
  })()`);
  check("split at a pause creates a new session, merge folds it back", splitMerge.newKey === "2026-01-11~2" && splitMerge.afterSplit["2026-01-10"] === 3 && splitMerge.afterSplit["2026-01-11~2"] === 2 && splitMerge.afterMerge["2026-01-10"] === 5 && !("2026-01-11~2" in splitMerge.afterMerge), JSON.stringify(splitMerge));

  // ---- manual mode ---------------------------------------------------------------------------------
  const manual = await evaluate(gm.page, `(async () => { ${HELPERS}
    await setS("sessionMode", "manual");
    const before = layout("");
    await rollAt(Date.now()); await wait(1200);                       // no session running → unscheduled
    const key = await store.startManual();
    await rollAt(Date.now()); await rollAt(Date.now()); await wait(1200);
    const running = api.currentKey();
    await store.endManual();
    await rollAt(Date.now()); await wait(1200);                       // after End → unscheduled
    await store.flush();
    const after = layout("");
    const moved = await store.moveRecords("unscheduled", key);
    const assigned = layout("");
    await store.deleteSession(key);
    return { key, running, unscheduled: (after.unscheduled ?? 0) - (before.unscheduled ?? 0), inSession: after[key], moved, assignedInto: assigned[key], currentAfterEnd: api.currentKey() };
  })()`);
  check("manual: rolls between Start and End belong to the session; it is the running one", manual.inSession === 2 && manual.running === manual.key, JSON.stringify(manual));
  check("manual: rolls before Start and after End are kept as unscheduled", manual.unscheduled === 2);
  check("manual: unscheduled rolls can be moved into a session; nothing runs after End", manual.moved >= 2 && manual.assignedInto === 2 + manual.moved && manual.currentAfterEnd === null);

  // ---- GM access control, live on a player client -----------------------------------------------------
  const player = await openSession({ user: "PlayerA" });
  const toolVisible = `(() => { const t = ui.controls.controls?.tokens?.tools?.["pf2e-d20-tracker"]; return t ? t.visible !== false : false; })()`;
  await evaluate(player.page, `${API}.open() && true`);
  await sleep(1500);
  const before = await evaluate(player.page, `({ tool: ${toolVisible}, windowOpen: !!document.getElementById("pf2e-d20-session-tracker") })`);
  await evaluate(gm.page, `game.settings.set("${MODULE_ID}", "playerAccess", "none")`);
  await sleep(2500);
  const denied = await evaluate(player.page, `({ tool: ${toolVisible}, windowOpen: !!document.getElementById("pf2e-d20-session-tracker"), openResult: typeof ${API}.open()?.render })`);
  await evaluate(gm.page, `game.settings.set("${MODULE_ID}", "playerAccess", "all")`);
  await sleep(2500);
  const allowed = await evaluate(player.page, `({ tool: ${toolVisible}, canOpen: typeof ${API}.open()?.render === "function" })`);
  check("access: player starts with the button and an open window", before.tool && before.windowOpen, JSON.stringify(before));
  check("access: GM sets 'nothing' → player's window closes and the button disappears, no reload", !denied.tool && !denied.windowOpen && denied.openResult !== "function", JSON.stringify(denied));
  check("access: GM sets 'whole table' → the button is back and the window opens, no reload", allowed.tool && allowed.canOpen, JSON.stringify(allowed));
  await player.close();

  // ---- cleanup and restore ----------------------------------------------------------------------------
  const cleanup = await evaluate(gm.page, `(async () => { ${HELPERS}
    for (const s of store.listSessions()) if (s.key.startsWith("2026-01") || s.key === "unscheduled") await store.deleteSession(s.key);
    const ids = game.messages.contents.filter(m => m.flags["${MODULE_ID}"]?.e2e).map(m => m.id);
    if (ids.length) await ChatMessage.deleteDocuments(ids);
    await setS("sessionMode", "daily"); await setS("sessionGapHours", ${JSON.stringify(5)}); await setS("boundaryHour", 6); await setS("playerAccess", ${JSON.stringify("all")});
    const plan = store.planRebucket(); if (plan.diff.moved) await store.applyRebucket(plan.after);
    await store.flush();
    return { deletedMessages: ids.length, all: layout("") };
  })()`);
  check("round trip: after daily → gap → manual → daily the real sessions are exactly as they started", JSON.stringify(cleanup.all) === JSON.stringify(initial.all), `${JSON.stringify(initial.all)} vs ${JSON.stringify(cleanup.all)}`);
} finally {
  await gm.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
