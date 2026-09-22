// End-to-end verification on the dev instance (1.1.1 hardening, kept current since): the Foundry-facing side of the hardening.
//   node dev/e2e/verify-hardening.mjs
// The pure-layer rules are unit-tested (test/hardening.test.js); this run checks what only a live world
// can show: report windows and links, every tab still rendering, a player's far-off timestamp being
// filed under the writer's clock, and a clean console. Cleans up after itself.
import { readFileSync } from "node:fs";
import { openSession, evaluate } from "./foundry.mjs";

const MODULE_ID = "pf2e-d20-session-tracker";
const EXPECTED_VERSION = JSON.parse(readFileSync(new URL("../../module.json", import.meta.url), "utf8")).version;
const API = `game.modules.get("${MODULE_ID}").api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const HELPERS = `
  const api = ${API}; const store = api.store;
  const layout = () => Object.fromEntries(store.listSessions().map(s => [s.key, s.n]).sort());
  const reports = () => [...document.querySelectorAll('[id^="pf2e-d20-report-"]')].map(e => e.id);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
`;
const moduleErrors = (log) => log.filter((l) => /^\[(error|pageerror)\]/.test(l) && /d20|pf2e-d20|session-tracker/i.test(l));

const gm = await openSession({ user: "Gamemaster" });
let player = null;
try {
  const initial = await evaluate(gm.page, `(async () => { ${HELPERS} await store.flush(); return { layout: layout(), version: game.modules.get("${MODULE_ID}").version, newest: store.listSessions().find(s => s.n > 0 && !s.unscheduled)?.key ?? null }; })()`);
  console.log("initial:", JSON.stringify(initial));
  check(`module version is ${EXPECTED_VERSION} (the repository's module.json)`, initial.version === EXPECTED_VERSION, initial.version);
  const key = initial.newest;

  // ---- report windows ---------------------------------------------------------------------------------
  const opened = await evaluate(gm.page, `(async () => { ${HELPERS}
    const stray = [api.openReport("not-a-session"), api.openReport("2030-01-01"), api.openReport("${key}\\" x=\\"")].map(r => typeof r?.render);
    const afterStray = reports();
    const app = api.openReport(${JSON.stringify(key)}); await wait(1500);
    return { stray, afterStray, ids: reports(), rendered: app?.rendered === true, text: document.querySelector('[id^="pf2e-d20-report-"] .report-body')?.innerText?.length ?? 0 };
  })()`);
  check("keys that are malformed or not stored open no window", opened.stray.every((t) => t !== "function") && opened.afterStray.length === 0, JSON.stringify({ stray: opened.stray, afterStray: opened.afterStray }));
  check("a stored session's report opens, with content", opened.rendered && opened.ids.length === 1 && opened.text > 50, JSON.stringify(opened.ids));

  // ---- every tab renders ------------------------------------------------------------------------------
  const tabs = await evaluate(gm.page, `(async () => { ${HELPERS}
    const app = api.open(); await wait(1200);
    const out = {};
    for (const tab of ["tonight", "fun", "history", "sessions"]) {
      app.changeTab(tab, "primary"); await wait(900);
      const el = document.querySelector('#pf2e-d20-session-tracker section.tab[data-tab="' + tab + '"]');
      out[tab] = el?.classList.contains("active") ? (el.innerText ?? "").trim().length : 0;
    }
    await app.close();
    return out;
  })()`);
  check("Tonight, Fun, History and Sessions all render", Object.values(tabs).every((n) => n > 20), JSON.stringify(tabs));

  // ---- report link: the GM's works for a player, a look-alike by a player does nothing -------------------
  const messagesBefore = await evaluate(gm.page, `game.messages.size`);
  await evaluate(gm.page, `(async () => { ${HELPERS} document.querySelector('[id^="pf2e-d20-report-"] [data-action="shareLink"]').click(); await wait(1500); for (const e of document.querySelectorAll('[id^="pf2e-d20-report-"]')) e.querySelector('[data-action="close"]')?.click(); })()`);
  const link = await evaluate(gm.page, `(() => { const m = game.messages.contents.findLast(m => m.flags["${MODULE_ID}"]?.reportLink); return m ? { id: m.id, key: m.flags["${MODULE_ID}"].sessionKey, count: game.messages.size } : null; })()`);
  check("posting a link adds exactly one chat message carrying the key", !!link && link.key === key && link.count === messagesBefore + 1, JSON.stringify(link));

  player = await openSession({ user: "PlayerA" });
  await sleep(1500);
  const clicked = await evaluate(player.page, `(async () => { ${HELPERS}
    const li = document.querySelector('[data-message-id="${link?.id}"]');
    li?.querySelector("[data-d20-report]")?.click(); await wait(1500);
    const ids = reports();
    for (const e of document.querySelectorAll('[id^="pf2e-d20-report-"]')) e.querySelector('[data-action="close"]')?.click();
    return { found: !!li, ids };
  })()`);
  check("a player clicking the GM's link gets the report window", clicked.found && clicked.ids.length === 1, JSON.stringify(clicked));

  const lookalike = await evaluate(player.page, `(async () => { ${HELPERS}
    await wait(800);
    const m = await ChatMessage.create({ content: '<div class="pf2e-d20-report-link"><button type="button" data-d20-report="${key}">Open</button></div>', flags: { "${MODULE_ID}": { reportLink: true, sessionKey: "${key}", e2e: true } } });
    return m.id;
  })()`);
  await sleep(1500);
  const inert = await evaluate(gm.page, `(async () => { ${HELPERS}
    const li = document.querySelector('[data-message-id="${lookalike}"]');
    const button = li?.querySelector("[data-d20-report]");
    button?.click(); await wait(1200);
    return { rendered: !!li, buttonSurvived: !!button, ids: reports() };
  })()`);
  check("the same markup in a player's own message opens nothing", inert.rendered && inert.ids.length === 0, JSON.stringify(inert));

  // ---- message time -----------------------------------------------------------------------------------
  const today = await evaluate(gm.page, `${API}.sessionKeyFor(Date.now())`);
  const dated = await evaluate(player.page, `(async () => {
    const make = async (ts) => { const roll = await new Roll("1d20").evaluate(); return (await ChatMessage.create({ rolls: [roll], timestamp: ts, speaker: { alias: "e2e-hardening" }, flags: { "${MODULE_ID}": { e2e: true } } })).id; };
    return [await make(Date.UTC(2020, 0, 5, 20)), await make(Date.now() + 400 * 86400000)];
  })()`);
  await sleep(2500);
  const filed = await evaluate(gm.page, `(async () => { ${HELPERS} await store.flush();
    const ids = ${JSON.stringify(dated)};
    const recs = store.listSessions().flatMap(s => store.getSession(s.key)).filter(r => ids.includes(r.msgId));
    return { keys: recs.map(r => r.sessionKey), skewMin: recs.map(r => Math.round(Math.abs(Date.now() - r.ts) / 60000)), sessions: Object.keys(layout()) };
  })()`);
  check("a player's rolls dated 2020 and next year are filed under today, by the GM's clock", filed.keys.length === 2 && filed.keys.every((k) => k === today) && filed.skewMin.every((m) => m <= 2) && !filed.sessions.some((k) => k.startsWith("2020") || k > today), JSON.stringify(filed));

  // ---- export -----------------------------------------------------------------------------------------
  const csv = await evaluate(gm.page, `(async () => { ${HELPERS}
    const { recordsToCsv } = await import("/modules/${MODULE_ID}/scripts/storage/csv.js");
    const lines = recordsToCsv(store.getSession(${JSON.stringify(key)}), { users: Object.fromEntries(game.users.map(u => [u.id, u.name])), actors: Object.fromEntries(game.actors.map(a => [a.id, a.name])) }).trim().split("\\r\\n");
    return { rows: lines.length - 1, header: lines[0].split(",").length, stored: store.getSession(${JSON.stringify(key)}).length };
  })()`);
  check("CSV export: header plus one row per stored die", csv.rows === csv.stored && csv.header === 19, JSON.stringify(csv));

  // ---- the shipped analyzer macro (built by dev/build-macro.mjs) runs in a live world ----------------------
  const macro = await evaluate(gm.page, `(async () => {
    const text = await (await fetch("/modules/${MODULE_ID}/macros/analyze.js")).text();
    delete globalThis.d20Analyze;
    await new (Object.getPrototypeOf(async function () {}).constructor)(text)();
    const r = await globalThis.d20Analyze({ days: 3650 });
    return { bytes: text.length, records: r.records.length, counted: r.counted, evenings: Object.keys(r.tables), kinds: Object.keys(r.coverage) };
  })()`);
  check("the shipped analyzer macro runs as a Script macro would and reads the chat log", macro.bytes > 20_000 && typeof macro.counted === "number" && macro.kinds.length > 0, JSON.stringify(macro));

  // ---- cleanup ----------------------------------------------------------------------------------------
  const cleanup = await evaluate(gm.page, `(async () => { ${HELPERS}
    const msgs = game.messages.contents.filter(m => m.flags["${MODULE_ID}"]?.e2e || m.id === ${JSON.stringify(link?.id ?? "")});
    const ids = new Set(msgs.map(m => m.id));
    await store.moveRecords(${JSON.stringify(today)}, "2020-01-01", (r) => ids.has(r.msgId));
    await store.deleteSession("2020-01-01");
    await ChatMessage.deleteDocuments([...ids]);
    await store.flush();
    return { deleted: ids.size, layout: layout() };
  })()`);
  check("cleanup: stored sessions are exactly as they started", JSON.stringify(cleanup.layout) === JSON.stringify(initial.layout), `${JSON.stringify(initial.layout)} vs ${JSON.stringify(cleanup.layout)}`);

  const errors = [...moduleErrors(gm.log), ...moduleErrors(player.log)];
  check("no module errors in the GM or player console", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await player?.close();
  await gm.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
