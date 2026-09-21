// Node's globals as used by the tests and the dev tools, typed `any` (dev/lint.mjs checks names, not
// types, and @types/node would be one more package to trust).
declare const process: any;
declare const console: any;
declare const URL: any;
declare const fetch: any;
declare const performance: any;
declare function setTimeout(handler: (...a: any[]) => void, ms?: number): any;
declare function clearTimeout(handle: any): void;
declare function setInterval(handler: (...a: any[]) => void, ms?: number): any;
declare function clearInterval(handle: any): void;
declare function structuredClone<T>(value: T): T;
