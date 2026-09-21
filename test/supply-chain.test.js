// The dependency policy as assertions (docs/PLAN.md D11), so drift fails loudly instead of slipping in:
// a new package, a version range, an install script, a tarball from somewhere else, a third-party
// action or an `npm install` in CI all break this file until someone changes it on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const json = (p) => JSON.parse(read(p));

/** Every package that may exist in node_modules. Both are published by Microsoft and have no dependencies. */
const ALLOWED = ["playwright-core", "typescript"];
/** Actions a workflow may use. First-party only; releases are made with the gh CLI on the runner. */
const ALLOWED_ACTIONS = ["actions/checkout"];

test("package.json: dev tools only, exact versions, nothing that runs on install", () => {
  const pkg = json("package.json");
  assert.equal(pkg.private, true, "private: the repository can never be published to npm by accident");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies", "overrides"]) {
    assert.equal(pkg[field], undefined, `${field}: the module ships plain files and has no runtime packages`);
  }
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ALLOWED);
  for (const [name, range] of Object.entries(pkg.devDependencies)) assert.match(range, /^\d+\.\d+\.\d+$/, `${name}: "${range}" is not an exact version`);
  for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly", "prepack", "postpack"]) {
    assert.equal(pkg.scripts?.[hook], undefined, `scripts.${hook} would run on install or publish`);
  }
});

test("package-lock.json: only the allowed packages, from the npm registry, with sha512 integrity and no install scripts", () => {
  const lock = json("package-lock.json");
  assert.equal(lock.lockfileVersion, 3);
  const entries = Object.entries(lock.packages).filter(([key]) => key);
  assert.deepEqual(entries.map(([key]) => key.replace(/^.*node_modules\//, "")).sort(), ALLOWED, "a package appeared or disappeared: review it, then update ALLOWED");
  for (const [key, p] of entries) {
    assert.match(p.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${key}: resolved from ${p.resolved}`);
    assert.match(p.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/, `${key}: integrity`);
    assert.equal(p.hasInstallScript, undefined, `${key} runs code at install time`);
    assert.equal(p.dependencies, undefined, `${key} brings dependencies of its own`);
    assert.equal(p.inBundle, undefined);
    assert.equal(p.link, undefined);
  }
  assert.deepEqual(lock.packages[""].devDependencies, json("package.json").devDependencies, "lockfile and package.json disagree: run npm install and commit both");
});

test(".npmrc: install scripts off, exact saves, the public registry over TLS", () => {
  const settings = Object.fromEntries(read(".npmrc").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("=").map((s) => s.trim())));
  assert.equal(settings["ignore-scripts"], "true");
  assert.equal(settings["save-exact"], "true");
  assert.ok(Number(settings["min-release-age"]) >= 7, "a release-age cooldown of at least a week");
  assert.equal(settings.registry, "https://registry.npmjs.org/");
  assert.notEqual(settings["strict-ssl"], "false");
  assert.ok(!Object.keys(settings).some((k) => /_auth|token|password/i.test(k)), "no credentials in .npmrc");
});

test("the shipped module has no package imports and loads nothing remote", () => {
  const manifest = json("module.json");
  const shipped = ["scripts", "templates", "styles", "languages", "macros"];
  const walk = (dir) => readdirSync(new URL(`${dir}/`, ROOT)).flatMap((n) => (statSync(new URL(`${dir}/${n}`, ROOT)).isDirectory() ? walk(`${dir}/${n}`) : [`${dir}/${n}`]));
  const files = shipped.flatMap(walk);
  for (const rel of [...manifest.esmodules, ...(manifest.styles ?? []), ...(manifest.languages ?? []).map((l) => l.path)]) assert.ok(files.includes(rel), `module.json names ${rel}`);
  assert.deepEqual(manifest.relationships?.requires ?? [], [], "no module may be installed automatically alongside this one");
  for (const file of files.filter((f) => f.startsWith("scripts/"))) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']/g)) {
      assert.match(m[1] ?? m[2], /^\.{1,2}\//, `${file} imports "${m[1] ?? m[2]}": only relative imports ship`);
    }
  }
  for (const file of files) {
    if (file === "macros/analyze.js") continue; // generated; test/macro-bundle.test.js covers it
    const text = read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\{!--[\s\S]*?--\}\}/gm, "");
    assert.doesNotMatch(text, /https?:\/\/|<script\b|@import\b|\bimportScripts\b|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bfetch\s*\(|\beval\s*\(|new Function\b/, `${file} reaches outside the module or evaluates text`);
  }
});

test("workflows: first-party actions pinned to a commit, no package installs, least privilege", () => {
  const dir = ".github/workflows";
  assert.ok(existsSync(new URL(`${dir}/`, ROOT)));
  for (const name of readdirSync(new URL(`${dir}/`, ROOT))) {
    const text = read(`${dir}/${name}`);
    const code = text.replace(/^\s*#.*$/gm, "");
    const uses = [...code.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    for (const u of uses) {
      const [action, ref] = u.split("@");
      assert.ok(ALLOWED_ACTIONS.includes(action), `${name}: ${action} is not an allowed action`);
      assert.match(ref ?? "", /^[0-9a-f]{40}$/, `${name}: ${action} is not pinned to a commit`);
    }
    assert.doesNotMatch(code, /\b(npm|npx|yarn|pnpm|bun)\s+(ci|i|install|add|exec|dlx|x)\b|\bnpx\s/, `${name} installs or runs packages`);
    assert.doesNotMatch(code, /pull_request_target|workflow_run/, `${name}: triggers that run with secrets on outside code`);
    // Values reach a script through `env:`, never through ${{ }} inside the script text.
    const lines = code.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:-\s+)?run:(.*)$/.exec(lines[i]);
      if (!m) continue;
      const keyIndent = m[1].length + (lines[i].trimStart().startsWith("-") ? 2 : 0);
      let script = m[2];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > keyIndent); j++) script += `\n${lines[j]}`;
      assert.ok(!script.includes("${{"), `${name}: line ${i + 1}: \${{ }} inside a run script; pass it through env instead`);
    }
    assert.match(code, /^permissions:\s*\{\}\s*$/m, `${name}: the default token permission should be none`);
  }
});
