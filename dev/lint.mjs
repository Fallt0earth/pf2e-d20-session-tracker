// Static checks without a linter's dependency tree (docs/PLAN.md D11). The TypeScript compiler, one
// package with no dependencies, reads the JavaScript as it is and reports:
//   errors    names that are defined nowhere (typos, missing imports), imports and exports that do not
//             exist, redeclarations, use before declaration, syntax errors;
//   warnings  locals and imports that are never used.
// It also enforces the pure-layer rule BY CONSTRUCTION, which a deny-list could only approximate: the pure
// files are compiled in a program that has no Foundry globals and no DOM, so `game`, `ui`, `document`,
// `localStorage` … are simply undefined names there, and a Foundry-facing module must not be reachable
// from them at all (not even through a JSDoc type import).
//   npm run lint
import ts from "typescript";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (f) => relative(ROOT, f).split(sep).join("/");

/** The pure layer: runs under node, imports nothing from Foundry, uses no Foundry or DOM globals. */
const PURE = [
  "scripts/constants.js", "scripts/types.js", "scripts/stats/", "scripts/capture/normalize.js",
  "scripts/capture/extractors/", "scripts/capture/dice-walk.js", "scripts/capture/reroll-html.js",
  "scripts/capture/html-scan.js", "scripts/capture/sanitize.js", "scripts/sessions/bucket.js",
  "scripts/sessions/sessionizer.js", "scripts/ui/view-model.js", "scripts/ui/fun-model.js",
  "scripts/ui/history-model.js", "scripts/storage/codec.js", "scripts/storage/csv.js",
  "scripts/storage/merge.js", "scripts/util/queue.js", "scripts/backfill/plan.js",
];
const IGNORED = ["dev/reference/", "dev/lint/"];

// "Cannot find name" and its variants. TypeScript words it differently for names it recognises from a
// library that is not loaded ("document": 2584, "process": 2580/2591, "Promise": 2583, "describe": 2582 …).
const UNDEFINED = new Set([2304, 2552, 2662, 2663, 2693, 18004, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592, 2593, 2867, 2868]);
const ERRORS = new Set([...UNDEFINED, 2305, 2724, 2614, 2300, 2451, 2448, 2588, 2307]);
const WARNINGS = new Set([6133, 6138, 6192, 6196, 6198, 6199]);    // declared but never used

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (IGNORED.some((p) => `${path}/`.startsWith(p))) continue;
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

const isPure = (file) => PURE.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));
const scripts = walk("scripts", [".js"]);
const programs = [
  { name: "pure layer", files: scripts.filter(isPure), lib: ["lib.es2022.d.ts"], globals: "dev/lint/globals-pure.d.ts", closed: true },
  { name: "Foundry-facing", files: scripts.filter((f) => !isPure(f)), lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], globals: "dev/lint/globals-foundry.d.ts", own: (f) => !isPure(f) },
  { name: "node (tests, dev tools)", files: [...walk("test", [".js"]), ...walk("dev", [".mjs"])], lib: ["lib.es2022.d.ts"], globals: "dev/lint/globals-node.d.ts", own: (f) => !f.startsWith("scripts/") },
];

const problems = [];
const report = (level, file, line, message) => problems.push({ level, file, line, message });

for (const p of programs) {
  const program = ts.createProgram([...p.files, p.globals].map((f) => join(ROOT, f)), {
    allowJs: true, checkJs: true, noEmit: true, strict: false, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: p.lib, noUnusedLocals: true, allowUnreachableCode: true,
  });
  const inRepo = program.getSourceFiles().filter((s) => !s.fileName.includes("/node_modules/") && !s.isDeclarationFile).map((s) => rel(s.fileName));
  if (p.closed) {
    // Nothing outside the pure layer may be reachable from it.
    for (const leaked of inRepo.filter((f) => !isPure(f))) {
      const base = leaked.split("/").pop().replace(/\.js$/, "");
      const importer = p.files.find((f) => new RegExp(`["'][^"']*/${base}(\\.js)?["']`).test(readFileSync(join(ROOT, f), "utf8")));
      report("error", importer ?? leaked, 1, `the pure layer reaches ${leaked}, which is not part of it`);
    }
  }
  const mine = p.closed ? isPure : p.own;
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  for (const d of diagnostics) {
    if (!d.file || d.file.isDeclarationFile) continue;
    const file = rel(d.file.fileName);
    if (file.startsWith("..") || file.includes("node_modules/") || !mine(file)) continue;
    const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const syntax = d.code < 2000 || (d.code >= 8000 && d.code < 9000);
    // A finding on a module specifier ("node:fs", "typescript", "./x.js"): only relative paths have to
    // resolve here. Node's built-ins have no type package installed on purpose (one package less to trust).
    const start = d.start ?? 0;
    if (/["'`]/.test(d.file.text[start]) && !d.file.text.slice(start + 1, start + (d.length ?? 0) - 1).startsWith(".")) continue;
    const level = syntax || ERRORS.has(d.code) ? "error" : WARNINGS.has(d.code) ? "warning" : null;
    if (!level) continue; // type-level findings are out of scope: this is a name check, not a type check
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    const hint = p.closed && UNDEFINED.has(d.code) ? " (the pure layer has no Foundry or DOM globals)" : "";
    report(level, file, line + 1, `${text}${hint}`);
  }
  console.log(`${p.name}: ${p.files.length} files`);
}

const seen = new Set();
const unique = problems.filter((x) => { const k = `${x.file}:${x.line}:${x.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const x of unique) console.log(`${x.file}:${x.line}  ${x.level}  ${x.message}`);
const errors = unique.filter((x) => x.level === "error").length;
console.log(`${errors} error${errors === 1 ? "" : "s"}, ${unique.length - errors} warning${unique.length - errors === 1 ? "" : "s"} (TypeScript ${ts.version})`);
process.exit(errors ? 1 : 0);
