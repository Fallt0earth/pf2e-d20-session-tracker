// macros/analyze.js is the one build artifact that ships. These tests keep it honest: it is exactly what
// dev/build-macro.mjs produces from the sources today, it holds nothing but this repository's modules,
// and it behaves like the ES modules it was built from (run side by side over the fixture corpus).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const committed = readFileSync(new URL("macros/analyze.js", ROOT), "utf8");
const builder = await import("../dev/build-macro.mjs").catch(() => null); // needs the typescript dev dependency
const FIXTURE = new URL("test/fixtures/devworld/messages.json", ROOT);
const have = existsSync(FIXTURE);

test("the committed bundle is what the sources build to today", { skip: !builder && "typescript is not installed (npm ci)" }, () => {
  const { text } = builder.buildMacro();
  assert.equal(committed.replace(/\r\n/g, "\n"), text, "macros/analyze.js is stale: run `npm run build:macro` and commit the result");
});

test("the bundle holds only this repository's modules", () => {
  const ids = [...committed.matchAll(/^"([^"]+)": function \(require, module, exports\) \{$/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 10, `only ${ids.length} modules found`);
  for (const id of ids) {
    assert.match(id, /^scripts\/[A-Za-z0-9/_-]+\.js$/);
    assert.ok(existsSync(new URL(id, ROOT)), `${id} does not exist`);
  }
  const required = [...committed.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1]);
  for (const id of required) assert.ok(ids.includes(id), `require("${id}") has no module in the bundle`);
  assert.doesNotMatch(committed, /node_modules|https?:\/\/|\bimport\s*\(|\beval\s*\(|new Function/);
});

test("the bundle behaves like the modules it was built from", { skip: !have && "no fixture corpus" }, async () => {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const messages = Array.isArray(raw) ? raw : raw.messages;
  const world = () => ({
    game: {
      messages: { contents: messages.map((m) => ({ timestamp: m.timestamp, toObject: () => structuredClone(m) })) },
      users: { get: (id) => (id ? { id, name: `user:${id}`, isGM: false } : null), filter: () => [] },
      actors: { get: () => null },
    },
    ChatMessage: { create: async (data) => data },
  });
  const quiet = { log() {}, warn() {}, error() {}, group() {}, groupEnd() {}, table() {} };
  const options = [{ days: 100000 }, { days: 100000, countMode: "kept", groupBy: "actor", includeBlind: false }];
  const summarize = async (analyze) => JSON.stringify(await Promise.all(options.map(async (o) => { const r = await analyze(o); return { coverage: r.coverage, tables: r.tables, counted: r.counted, records: r.records }; })));

  // The ES modules, imported as they are (the entry runs once on import, so its globals exist first).
  const real = { console: globalThis.console };
  Object.assign(globalThis, world(), { console: quiet });
  let fromModules;
  try {
    await import("../scripts/analyze-entry.js");
    fromModules = await summarize(globalThis.d20Analyze);
  } finally {
    globalThis.console = real.console;
    for (const k of ["game", "ChatMessage", "d20Analyze"]) delete globalThis[k];
  }

  // The bundle, in a sandbox of its own.
  const sandbox = { ...world(), console: quiet };
  sandbox.globalThis = sandbox;
  vm.runInContext(committed, vm.createContext(sandbox), { filename: "macros/analyze.js" });
  const fromBundle = await summarize(sandbox.d20Analyze);

  assert.ok(JSON.parse(fromModules)[0].records.length > 50, "the fixture corpus should yield dozens of dice");
  assert.equal(fromBundle, fromModules);
});
