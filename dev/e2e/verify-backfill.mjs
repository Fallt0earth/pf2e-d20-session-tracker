// Whole-history backfill on the dev instance (1.3.0). Plants a small "campaign history" of raw d20
// messages with simulated timestamps in February 2026 (three Saturday evenings with the GM, a sheet-
// testing Tuesday, a players-only evening), then checks the plan, the junk-evening knobs, the write, its
// idempotence, and the dialog itself. Cleans up: test sessions, test messages; stored sessions end as
// they started.
import { openSession, evaluate } from "./foundry.mjs";

const MODULE_ID = "pf2e-d20-session-tracker";
const API = `game.modules.get("${MODULE_ID}").api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const EVENINGS = [7, 14, 21];       // Saturdays 19:00, GM + PlayerA + PlayerB
const SHEET_DAY = 10;               // Tuesday, PlayerA alone, 4 rolls
const NO_GM_DAY = 28;               // Saturday, players only, 34 rolls

const gm = await openSession({ user: "Gamemaster" });
try {
  const initial = await evaluate(gm.page, `(async () => { const store = ${API}.store; await store.flush(); return { mode: ${API}.sessionConfig().mode, all: Object.fromEntries(store.listSessions().map(s => [s.key, s.n]).sort()), users: Object.fromEntries(game.users.map(u => [u.name, u.id])) }; })()`);
  console.log("initial:", JSON.stringify(initial));
  const uid = (name) => initial.users[name];

  // ---- plant the history (as the GM, with explicit authors and timestamps) ------------------------------
  // Live capture would record the planted messages as they are created; the backfill has to find them itself.
  await evaluate(gm.page, `game.settings.set("${MODULE_ID}", "captureEnabled", false)`);
  const planted = await evaluate(gm.page, `(async () => {
    const cst = (d, h, mi = 0) => Date.UTC(2026, 1, d, h + 6, mi); // Chicago in February is CST = UTC−6
    const mk = async (ts, author) => { const roll = await new Roll("1d20").evaluate(); return { rolls: [roll], timestamp: ts, author, speaker: { alias: "e2e-backfill" }, flags: { "${MODULE_ID}": { e2e: true } } }; };
    const docs = [];
    for (const day of ${JSON.stringify(EVENINGS)}) {
      docs.push({ content: "<p>Welcome back, everyone.</p>", timestamp: cst(day, 19), author: ${JSON.stringify(uid("Gamemaster"))}, flags: { "${MODULE_ID}": { e2e: true } } });
      for (let i = 0; i < 36; i++) docs.push(await mk(cst(day, 19, 5 + i * 6), [${JSON.stringify(uid("Gamemaster"))}, ${JSON.stringify(uid("PlayerA"))}, ${JSON.stringify(uid("PlayerB"))}][i % 3]));
    }
    for (let i = 0; i < 4; i++) docs.push(await mk(cst(${SHEET_DAY}, 15, i * 10), ${JSON.stringify(uid("PlayerA"))}));
    for (let i = 0; i < 34; i++) docs.push(await mk(cst(${NO_GM_DAY}, 19, i * 6), [${JSON.stringify(uid("PlayerA"))}, ${JSON.stringify(uid("PlayerB"))}][i % 2]));
    const created = await ChatMessage.createDocuments(docs, { keepId: false });
    return { created: created.length, authors: [...new Set(created.map(m => m.author?.id))].length };
  })()`);
  await evaluate(gm.page, `game.settings.set("${MODULE_ID}", "captureEnabled", true)`);
  check("planted 3 evenings + a sheet-testing day + a players-only evening as dated messages", planted.created === 3 * 37 + 4 + 34 && planted.authors === 3, JSON.stringify(planted));
  await sleep(1500);

  // ---- plan (dry run) ------------------------------------------------------------------------------------
  const plan = await evaluate(gm.page, `${API}.backfill({ from: "2026-02-01", to: "2026-02-28", dryRun: true })`);
  const keys = plan.sessions.map((s) => s.key);
  const bySel = Object.fromEntries(plan.sessions.map((s) => [s.key, [s.n, s.players, s.gmPresent, s.selected, s.existing]]));
  check("dry run lists every evening in the range, in order, and writes nothing", JSON.stringify(keys) === JSON.stringify(["2026-02-07", "2026-02-10", "2026-02-14", "2026-02-21", "2026-02-28"]) && plan.added === undefined, JSON.stringify(keys));
  check("real evenings: 36 rolls, 3 players, GM present, ticked", ["2026-02-07", "2026-02-14", "2026-02-21"].every((k) => JSON.stringify(bySel[k]) === JSON.stringify([36, 3, true, true, 0])), JSON.stringify(bySel));
  check("sheet testing (4 rolls, no GM) and the players-only evening (34 rolls, no GM) are listed but unticked", JSON.stringify(bySel["2026-02-10"]) === JSON.stringify([4, 1, false, false, 0]) && JSON.stringify(bySel["2026-02-28"]) === JSON.stringify([34, 2, false, false, 0]), JSON.stringify([bySel["2026-02-10"], bySel["2026-02-28"]]));
  const stillNothing = await evaluate(gm.page, `${API}.store.listSessions().some(s => s.key.startsWith("2026-02"))`);
  check("nothing was stored by the dry run", stillNothing === false);
  const knobs = await evaluate(gm.page, `${API}.backfill({ from: "2026-02-01", to: "2026-02-28", dryRun: true, minRolls: 0, requireGM: false })`);
  check("with both knobs off every evening is ticked", knobs.sessions.every((s) => s.selected), knobs.sessions.map((s) => `${s.key}:${s.selected}`).join(" "));
  const narrow = await evaluate(gm.page, `${API}.backfill({ from: "2026-02-14", to: "2026-02-14", dryRun: true })`);
  check("a one-day range finds that evening only", narrow.sessions.length === 1 && narrow.sessions[0].key === "2026-02-14" && narrow.scanned === 37, JSON.stringify({ keys: narrow.sessions.map((s) => s.key), scanned: narrow.scanned }));

  // ---- run with the defaults: the three real evenings ----------------------------------------------------
  const run = await evaluate(gm.page, `${API}.backfill({ from: "2026-02-01", to: "2026-02-28" })`);
  const stored = await evaluate(gm.page, `(async () => { const store = ${API}.store; await store.flush(); return { feb: Object.fromEntries(store.listSessions().filter(s => s.key.startsWith("2026-02")).map(s => [s.key, s.n])), pages: store.journal.pages.filter(p => (p.flags["${MODULE_ID}"]?.key ?? "").startsWith("2026-02")).map(p => p.flags["${MODULE_ID}"].key).sort(), sample: store.getSession("2026-02-14").slice(0, 3).map(r => ({ user: game.users.get(r.userId)?.name, natural: r.natural, source: r.source, type: r.type, key: r.sessionKey })) }; })()`);
  check("the run added the three ticked evenings (108 rolls) and left the unticked ones out", run.added === 108 && JSON.stringify(run.written) === JSON.stringify(["2026-02-07", "2026-02-14", "2026-02-21"]) && JSON.stringify(Object.entries(stored.feb).sort()) === JSON.stringify([["2026-02-07", 36], ["2026-02-14", 36], ["2026-02-21", 36]]), JSON.stringify({ added: run.added, written: run.written, feb: stored.feb }));
  check("one journal page per added evening; records carry the right user, die and key", JSON.stringify(stored.pages) === JSON.stringify(["2026-02-07", "2026-02-14", "2026-02-21"]) && stored.sample.every((r) => r.key === "2026-02-14" && r.source === "raw" && r.natural >= 1 && r.natural <= 20 && r.user), JSON.stringify(stored.sample));

  // ---- idempotence and the explicit-keys path --------------------------------------------------------------
  const again = await evaluate(gm.page, `${API}.backfill({ from: "2026-02-01", to: "2026-02-28" })`);
  check("running it again adds nothing: the stored evenings are skipped, only the unticked ones are listed", again.added === 0 && again.skipped === 108 && JSON.stringify(again.sessions.map((s) => s.key)) === JSON.stringify(["2026-02-10", "2026-02-28"]), JSON.stringify({ added: again.added, skipped: again.skipped, listed: again.sessions.map((s) => s.key) }));
  const forced = await evaluate(gm.page, `${API}.backfill({ from: "2026-02-01", to: "2026-02-28", keys: ["2026-02-28"] })`);
  const febNow = await evaluate(gm.page, `Object.fromEntries(${API}.store.listSessions().filter(s => s.key.startsWith("2026-02")).map(s => [s.key, s.n]))`);
  check("an unticked evening can be added by naming it", forced.added === 34 && febNow["2026-02-28"] === 34 && !("2026-02-10" in febNow), JSON.stringify(febNow));

  // ---- the dialog ------------------------------------------------------------------------------------------
  const dialog = await evaluate(gm.page, `(async () => {
    const app = ${API}.openBackfill(); await new Promise(r => setTimeout(r, 1200));
    const el = document.getElementById("pf2e-d20-backfill");
    const q = (s) => el.querySelector(s);
    const before = { open: !!el, from: q('[name="from"]')?.value, to: q('[name="to"]')?.value, minRolls: q('[name="minRolls"]')?.value, requireGM: q('[name="requireGM"]')?.checked };
    q('[name="from"]').value = "2026-02-01"; q('[name="to"]').value = "2026-02-28"; q('[name="minRolls"]').value = "0"; q('[name="requireGM"]').checked = false;
    q('[data-action="preview"]').click();
    for (let i = 0; i < 40 && app.phase !== "preview"; i++) await new Promise(r => setTimeout(r, 250));
    const rows = [...el.querySelectorAll('table.backfill-list tbody tr')].map(tr => ({ key: tr.querySelector('input[name="pick"]').value, ticked: tr.querySelector('input[name="pick"]').checked, stored: tr.children[5].textContent.trim() }));
    q('[data-action="tickAll"][data-value="0"]').click();
    const noneTicked = [...el.querySelectorAll('input[name="pick"]')].every(i => !i.checked);
    q('[data-action="tickAll"][data-value="1"]').click();
    q('[data-action="run"]').click();
    for (let i = 0; i < 60 && app.phase !== "done"; i++) await new Promise(r => setTimeout(r, 250));
    const done = { phase: app.phase, added: app.result?.added, text: q(".party-sentence")?.textContent?.trim() };
    q('[data-action="finish"]').click(); await new Promise(r => setTimeout(r, 500));
    return { before, rows, noneTicked, done, closed: !document.getElementById("pf2e-d20-backfill") };
  })()`);
  check("dialog opens with the world's range and the list threshold prefilled", dialog.before.open && /^\d{4}-\d{2}-\d{2}$/.test(dialog.before.from) && /^\d{4}-\d{2}-\d{2}$/.test(dialog.before.to) && Number(dialog.before.minRolls) >= 0 && dialog.before.requireGM === true, JSON.stringify(dialog.before));
  check("preview lists only what is left to add (the sheet-testing day) with the stored evenings gone from the list", JSON.stringify(dialog.rows.map((r) => r.key)) === JSON.stringify(["2026-02-10"]) && dialog.rows[0].ticked === true, JSON.stringify(dialog.rows));
  check("tick none / tick all / add: the dialog adds the sheet-testing day and reports it", dialog.noneTicked && dialog.done.phase === "done" && dialog.done.added === 4 && /4/.test(dialog.done.text ?? "") && dialog.closed, JSON.stringify(dialog.done));

  // ---- cleanup ---------------------------------------------------------------------------------------------
  const cleanup = await evaluate(gm.page, `(async () => { const store = ${API}.store;
    await game.settings.set("${MODULE_ID}", "captureEnabled", true);
    for (const s of store.listSessions()) if (s.key.startsWith("2026-02")) await store.deleteSession(s.key);
    const ids = game.messages.contents.filter(m => m.flags["${MODULE_ID}"]?.e2e).map(m => m.id);
    const set = new Set(ids);
    for (const s of store.listSessions()) if (store.getSession(s.key).some(r => set.has(r.msgId))) await store.moveRecords(s.key, "2020-01-01", r => set.has(r.msgId));
    if (store.sessions.has("2020-01-01")) await store.deleteSession("2020-01-01");
    if (ids.length) await ChatMessage.deleteDocuments(ids);
    await store.flush();
    return { deleted: ids.length, all: Object.fromEntries(store.listSessions().map(s => [s.key, s.n]).sort()) };
  })()`);
  check("cleanup: test messages and evenings removed; stored sessions identical to the start", cleanup.deleted === planted.created && JSON.stringify(cleanup.all) === JSON.stringify(initial.all), `${JSON.stringify(initial.all)} vs ${JSON.stringify(cleanup.all)} (${cleanup.deleted} messages deleted)`);
  const errors = gm.log.filter((l) => /^\[(error|pageerror)\]/.test(l) && /d20|session-tracker/i.test(l));
  check("no module errors in the GM console", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await gm.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
