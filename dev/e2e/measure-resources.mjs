// Resource measurement on the dev instance: what one roll costs the GM's client (capture, upsert, the
// journal write), what it costs every other client (the update broadcast on the wire, decoding it,
// re-rendering an open window), and how the tracker window and the report behave while rolls arrive.
//   node dev/e2e/measure-resources.mjs [rolls]
// Read-only apart from the test rolls it makes, which it deletes; stored sessions end as they started.
import { openSession, evaluate } from "./foundry.mjs";

const MODULE_ID = "pf2e-d20-session-tracker";
const API = `game.modules.get("${MODULE_ID}").api`;
const ROLLS = Math.max(3, Number(process.argv[2]) || 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]; return s.length ? { n: s.length, min: s[0], median: at(0.5), p90: at(0.9), max: s.at(-1), mean: s.reduce((a, b) => a + b, 0) / s.length } : { n: 0 }; };
const fmt = (o, unit = "ms", d = 1) => (o.n ? `n=${o.n} median ${o.median.toFixed(d)} p90 ${o.p90.toFixed(d)} max ${o.max.toFixed(d)} ${unit}` : "n=0");

// Wrap a method and collect its wall-clock cost (async-aware).
const PROBE = `
  globalThis.__m = globalThis.__m ?? { append: [], flush: [], reload: [], render: [], payload: [], pageBytes: [], funMs: [] };
  const api = ${API}; const store = api.store;
  if (!store.__probed) {
    store.__probed = true;
    const wrap = (obj, name, bucket) => { const orig = obj[name].bind(obj); obj[name] = async function (...a) { const t = performance.now(); try { return await orig(...a); } finally { globalThis.__m[bucket].push(performance.now() - t); } }; };
    wrap(store, "append", "append");
    wrap(store, "_flush", "flush");
    const origReload = store.reloadPage.bind(store);
    store.reloadPage = function (page) { const t = performance.now(); try { return origReload(page); } finally { globalThis.__m.reload.push(performance.now() - t); } };
    Hooks.on("updateJournalEntryPage", (page, changes) => { if (page.parent?.id === store.journal?.id) { globalThis.__m.payload.push(JSON.stringify(changes).length); globalThis.__m.pageBytes.push(JSON.stringify(page.flags?.["${MODULE_ID}"]?.data ?? null).length); } });
  }
`;

const gm = await openSession({ user: "Gamemaster" });
const player = await openSession({ user: "PlayerA" });
try {
  const before = await evaluate(gm.page, `(async () => { ${PROBE} await store.flush(); return { sessions: Object.fromEntries(store.listSessions().map(s => [s.key, s.n])), key: store.currentKey() ?? api.sessionKeyFor(Date.now()), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; })()`);
  await evaluate(player.page, `(async () => { ${PROBE} return true; })()`);
  console.log("before:", JSON.stringify(before));

  // Player watches the tracker on the Tonight tab; render cost is measured through the app's own render().
  await evaluate(player.page, `(async () => { const app = ${API}.open(); await new Promise(r => setTimeout(r, 1200)); const orig = app.render.bind(app); app.render = async function (...a) { const t = performance.now(); try { return await orig(...a); } finally { globalThis.__m.render.push(performance.now() - t); } }; return true; })()`);

  const rollOnce = async () => evaluate(player.page, `(async () => { const roll = await new Roll("1d20").evaluate(); await ChatMessage.create({ rolls: [roll], speaker: { alias: "e2e-measure" }, flags: { "${MODULE_ID}": { e2e: true } } }); return true; })()`);
  for (let i = 0; i < ROLLS; i++) { await rollOnce(); await sleep(1100); } // > the 250 ms write debounce: every roll is its own write
  await sleep(1500);

  const gmM = await evaluate(gm.page, `(async () => { await ${API}.store.flush(); return globalThis.__m; })()`);
  const plM = await evaluate(player.page, `globalThis.__m`);
  const n = await evaluate(gm.page, `${API}.store.getSession(${JSON.stringify(before.key)}).length`);
  console.log(`\nsession ${before.key} now holds ${n} records; ${ROLLS} rolls made 1.1 s apart\n`);
  console.log(`GM   capture + upsert (store.append)      ${fmt(stats(gmM.append))}`);
  console.log(`GM   journal write (page.update round trip) ${fmt(stats(gmM.flush))}`);
  console.log(`wire update broadcast received by a player  ${fmt(stats(plM.payload), "bytes", 0)}`);
  console.log(`     the page's whole data blob             ${fmt(stats(plM.pageBytes), "bytes", 0)}`);
  console.log(`player decode + re-index (reloadPage)      ${fmt(stats(plM.reload), "ms", 2)}`);
  console.log(`player re-render of the open window        ${fmt(stats(plM.render))}`);

  // Fun tab open on the player: what a roll costs there.
  await evaluate(player.page, `(async () => { const app = ${API}.open(); app.changeTab("fun", "primary"); globalThis.__m.render = []; await new Promise(r => setTimeout(r, 1500)); return true; })()`);
  for (let i = 0; i < 3; i++) { await rollOnce(); await sleep(1100); }
  await sleep(1500);
  const funM = await evaluate(player.page, `globalThis.__m`);
  console.log(`player re-render with the Fun tab active   ${fmt(stats(funM.render))}`);

  // Report popup open on the GM: what a roll costs there.
  await evaluate(gm.page, `(async () => { const r = ${API}.openReport(${JSON.stringify(before.key)}); await new Promise(res => setTimeout(res, 1500)); const orig = r.render.bind(r); globalThis.__m.report = []; r.render = async function (...a) { const t = performance.now(); try { return await orig(...a); } finally { globalThis.__m.report.push(performance.now() - t); } }; return true; })()`);
  for (let i = 0; i < 3; i++) { await rollOnce(); await sleep(1100); }
  await sleep(1500);
  const repM = await evaluate(gm.page, `globalThis.__m`);
  console.log(`GM   re-render of an open report popup     ${fmt(stats(repM.report))}`);

  const after = await evaluate(gm.page, `(async () => { const api = ${API}; const store = api.store;
    for (const e of document.querySelectorAll('[id^="pf2e-d20-report-"]')) e.querySelector('[data-action="close"]')?.click();
    const ids = game.messages.contents.filter(m => m.flags["${MODULE_ID}"]?.e2e).map(m => m.id);
    const set = new Set(ids);
    for (const s of store.listSessions()) { if (store.getSession(s.key).some(r => set.has(r.msgId))) { await store.moveRecords(s.key, "2020-01-01", r => set.has(r.msgId)); } }
    if (store.sessions.has("2020-01-01")) await store.deleteSession("2020-01-01");
    if (ids.length) await ChatMessage.deleteDocuments(ids);
    await store.flush();
    return { deleted: ids.length, sessions: Object.fromEntries(store.listSessions().map(s => [s.key, s.n])), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  })()`);
  await evaluate(player.page, `(async () => { await ${API}.close?.(); return true; })()`);
  console.log(`\ncleanup: ${after.deleted} test messages deleted; sessions ${JSON.stringify(after.sessions)} (before: ${JSON.stringify(before.sessions)}); GM heap ${before.heapMB} → ${after.heapMB} MB`);
  const same = JSON.stringify(after.sessions) === JSON.stringify(before.sessions);
  console.log(same ? "stored sessions identical to the start" : "WARNING: stored sessions differ from the start");
  const errors = [...gm.log, ...player.log].filter((l) => /^\[(error|pageerror)\]/.test(l) && /d20|session-tracker/i.test(l));
  console.log(errors.length ? `module errors: ${errors.slice(0, 3).join(" | ")}` : "no module errors on either client");
} finally {
  await player.close();
  await gm.close();
}
