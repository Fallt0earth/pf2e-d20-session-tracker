// Headless-browser harness for the dev Foundry instance (dev-only, not shipped).
// Joins the world as a named user (dev users have no passwords), runs JS inside the game, and
// captures the browser console so module init/ready lines and errors are visible from the CLI.
//
//   node dev/e2e/foundry.mjs smoke                 # version, system, users, active modules, console lines
//   node dev/e2e/foundry.mjs eval "game.version"   # evaluate an expression as the GM and print JSON
//   node dev/e2e/foundry.mjs eval --user PlayerA "game.user.name"
//   FOUNDRY_URL=http://your-docker-host:30000 overrides the target.
//
// Library use:  import { withFoundry } from "./foundry.mjs";
//               await withFoundry({ user: "Gamemaster" }, async (page, log) => { ... });

import { chromium } from "playwright";

export const FOUNDRY_URL = process.env.FOUNDRY_URL ?? "http://your-docker-host:30000";

/**
 * Launch a browser, join the world as `user`, run `fn(page, log)`, then close.
 * `log` is the array of console lines captured from page load onward.
 */
export async function withFoundry({ user = "Gamemaster", headless = true, timeout = 60_000 } = {}, fn) {
  const session = await openSession({ user, headless, timeout });
  try {
    return await fn(session.page, session.log);
  } finally {
    await session.close();
  }
}

/**
 * Open an independent browser session joined as `user`. Several can be open at once (GM + players).
 * Returns { page, log, user, joinMs, close() }.
 */
export async function openSession({ user = "Gamemaster", headless = true, timeout = 60_000 } = {}) {
  const browser = await launchBrowser(headless);
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const log = [];
  page.on("console", (msg) => log.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => log.push(`[pageerror] ${err.message}`));
  const t0 = Date.now();
  try {
    await join(page, user, timeout);
  } catch (e) {
    await browser.close();
    throw e;
  }
  return { page, log, user, joinMs: Date.now() - t0, close: () => browser.close() };
}

/**
 * Foundry v13 wants Chromium ≥ 132; Playwright 1.49 (the last line for Node 18) bundles 131.
 * Prefer the system Edge (always present on Windows 11, far newer); FOUNDRY_BROWSER=chromium forces the bundle.
 */
async function launchBrowser(headless) {
  const forced = process.env.FOUNDRY_BROWSER;
  if (forced !== "chromium") {
    try { return await chromium.launch({ headless, channel: forced ?? "msedge" }); } catch { /* fall back */ }
  }
  return chromium.launch({ headless });
}

async function join(page, user, timeout) {
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "domcontentloaded", timeout });
  const select = page.locator('select[name="userid"]');
  await select.waitFor({ timeout });
  const options = await select.locator("option").evaluateAll((els) => els.map((o) => ({ value: o.value, label: o.textContent.trim() })));
  const match = options.find((o) => o.label === user) ?? options.find((o) => o.label.toLowerCase() === user.toLowerCase());
  if (!match) throw new Error(`User "${user}" not on the join page. Available: ${options.map((o) => o.label).filter(Boolean).join(", ")}`);
  await select.selectOption(match.value);
  const button = page.locator('button[name="join"], button[type="submit"]').first();
  await button.click();
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout });
}

/** Run a JS expression string inside the game and return its JSON-safe result. */
export async function evaluate(page, expression) {
  return page.evaluate(async (src) => {
    const value = await new Function(`return (async () => (${src}))()`)();
    try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
  }, expression);
}

export async function listUsers() {
  const browser = await launchBrowser(true);
  const page = await browser.newPage();
  try {
    await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "domcontentloaded" });
    const select = page.locator('select[name="userid"]');
    await select.waitFor();
    return await select.locator("option").evaluateAll((els) => els.map((o) => o.textContent.trim()).filter(Boolean));
  } finally {
    await browser.close();
  }
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  let user = "Gamemaster";
  const ui = args.indexOf("--user");
  if (ui >= 0) { user = args[ui + 1]; args.splice(ui, 2); }

  if (cmd === "users") {
    console.log((await listUsers()).join("\n"));
  } else if (cmd === "smoke") {
    await withFoundry({ user }, async (page, log) => {
      const info = await evaluate(page, `({
        version: game.version, system: game.system.id + " " + game.system.version, world: game.world.id,
        user: game.user.name, isGM: game.user.isGM,
        users: game.users.contents.map(u => u.name + (u.isGM ? " (GM)" : "")),
        activeModules: game.modules.filter(m => m.active).map(m => m.id + "@" + m.version),
        tracker: game.modules.get("pf2e-d20-session-tracker")?.active ?? false,
        messages: game.messages.size,
      })`);
      console.log(JSON.stringify(info, null, 2));
      const ours = log.filter((l) => /d20 Session Tracker|pageerror|\[error\]/.test(l));
      console.log("--- console (module lines + errors) ---");
      console.log(ours.join("\n") || "(none)");
    });
  } else if (cmd === "eval") {
    const expr = args.join(" ");
    await withFoundry({ user }, async (page, log) => {
      const result = await evaluate(page, expr);
      console.log(JSON.stringify(result, null, 2));
      printErrors(log);
    });
  } else if (cmd === "screenshot") {
    // node dev/e2e/foundry.mjs screenshot out.png [--user NAME] "<expression to run first>"   (waits 2s, then shoots)
    const [file, ...rest] = args;
    await withFoundry({ user }, async (page, log) => {
      if (rest.length) console.log(JSON.stringify(await evaluate(page, rest.join(" ")), null, 2));
      await new Promise((r) => setTimeout(r, 2000));
      await page.screenshot({ path: file, fullPage: false });
      console.log(`screenshot saved: ${file}`);
      printErrors(log);
    });
  } else if (cmd === "run") {
    // Execute a script file (e.g. the bundled macros/analyze.js) inside the game, then optionally an expression.
    const [file, ...rest] = args;
    const src = (await import("node:fs")).readFileSync(file, "utf8");
    await withFoundry({ user }, async (page, log) => {
      await page.evaluate(new Function(src));
      if (rest.length) console.log(JSON.stringify(await evaluate(page, rest.join(" ")), null, 2));
      console.log("--- console ---");
      console.log(log.filter((l) => !/Chromium version/.test(l)).slice(-60).join("\n"));
    });
  } else {
    console.log("usage: node dev/e2e/foundry.mjs users | smoke [--user NAME] | eval [--user NAME] <expression> | run [--user NAME] <file.js> [expression]");
    process.exit(1);
  }
}

function printErrors(log) {
  const errs = log.filter((l) => /pageerror|\[error\]/.test(l) && !/Chromium version/.test(l));
  if (errs.length) { console.log("--- console errors ---"); console.log(errs.join("\n")); }
}
