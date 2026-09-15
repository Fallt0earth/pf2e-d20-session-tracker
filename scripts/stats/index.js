// @ts-check
// Public surface of the pure stats layer.
export { erf, normalCdf, twoSidedP } from "./normal.js";
export { logChoose, binomialPmf, binomialAtLeast, binomialAtMost } from "./binomial.js";
export { histogram, missingFaces, extremeFaces, describe } from "./basic.js";
export { luckSummary, faceStats, zBand, DEFAULT_GUARDS } from "./luck.js";
