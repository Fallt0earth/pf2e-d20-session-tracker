// Everything the pure layer may use beyond the language itself (ES2022 and Intl). It runs under node
// and in the browser, so only what both provide is listed. Deliberately short: no Foundry, no DOM.
declare const console: { log(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void; debug(...a: any[]): void };
declare function setTimeout(handler: (...a: any[]) => void, ms?: number): any;
declare function clearTimeout(handle: any): void;
