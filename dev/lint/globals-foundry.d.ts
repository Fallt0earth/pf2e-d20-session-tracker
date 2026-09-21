// Names Foundry VTT puts in the global scope of a client. Typed `any` on purpose: dev/lint.mjs checks
// that a name exists, not how it is used. Only the Foundry-facing program sees this file, so none of
// these names exists for the pure layer. The browser's own globals come from TypeScript's DOM library.
declare const game: any;
declare const foundry: any;
declare const Hooks: any;
declare const ui: any;
declare const canvas: any;
declare const CONFIG: any;
declare const CONST: any;
declare const ChatMessage: any;
declare const JournalEntry: any;
declare const JournalEntryPage: any;
declare const Roll: any;
declare const Handlebars: any;
