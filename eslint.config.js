// ESLint flat config. Two jobs: catch undefined names in Foundry-facing code, and keep the
// pure layer (stats, normalizer, extractors, bucketing) free of Foundry and DOM globals so
// it stays runnable under `node --test`. See docs/PLAN.md §3.2.

const foundryGlobals = {
  game: "readonly", foundry: "readonly", Hooks: "readonly", ui: "readonly", canvas: "readonly",
  CONFIG: "readonly", CONST: "readonly", ChatMessage: "readonly", JournalEntry: "readonly",
  JournalEntryPage: "readonly", Roll: "readonly", Handlebars: "readonly",
  console: "readonly", window: "readonly", document: "readonly", setTimeout: "readonly",
  clearTimeout: "readonly", Intl: "readonly", URL: "readonly", fetch: "readonly", performance: "readonly",
};

const pureFiles = [
  "scripts/constants.js",
  "scripts/types.js",
  "scripts/stats/**/*.js",
  "scripts/capture/normalize.js",
  "scripts/capture/extractors/**/*.js",
  "scripts/capture/dice-walk.js",
  "scripts/capture/reroll-html.js",
  "scripts/sessions/bucket.js",
  "scripts/ui/view-model.js",
  "scripts/ui/fun-model.js",
  "scripts/storage/codec.js",
  "scripts/util/queue.js",
];

const foundryFacingGlobals = [
  "game", "foundry", "Hooks", "ui", "canvas", "CONFIG", "CONST", "ChatMessage",
  "JournalEntry", "JournalEntryPage", "Roll", "Handlebars", "document", "window",
];

export default [
  { ignores: ["node_modules/**", "dist/**", "macros/analyze.js", "dev/reference/**", "backups/**"] },
  {
    files: ["scripts/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: foundryGlobals },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: pureFiles,
    rules: {
      "no-restricted-globals": ["error", ...foundryFacingGlobals],
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/ui/*", "**/storage/*", "**/backfill/*", "**/capture/live*", "**/capture/roller-enrich*", "**/settings*", "**/main*", "**/api*"],
          message: "The pure layer must not import Foundry-facing modules.",
        }],
      }],
    },
  },
  {
    files: ["test/**/*.js", "dev/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024, sourceType: "module",
      globals: {
        console: "readonly", process: "readonly", URL: "readonly", Intl: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        performance: "readonly", globalThis: "readonly", Function: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
];
