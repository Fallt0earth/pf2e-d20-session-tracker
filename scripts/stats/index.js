// @ts-check
// Public surface of the pure stats layer.
export { erf, normalCdf, twoSidedP } from "./normal.js";
export { logChoose, binomialPmf, binomialAtLeast, binomialAtMost } from "./binomial.js";
export { histogram, missingFaces, extremeFaces, describe } from "./basic.js";
export { luckSummary, faceStats, zBand, DEFAULT_GUARDS } from "./luck.js";
export { mulberry32, hashSeed, d20 } from "./rng.js";
export { longestRun, longestSameFace, streakSummary, HOT_MIN, COLD_MAX } from "./streaks.js";
export { dosSplit, moments } from "./dos.js";
export { heroPointStats, fortuneStats } from "./rerolls.js";
export { regularizedGammaP, logGamma, chiSquareP, chiSquareUniform } from "./chisq.js";
export { observedStats, simulate, locate, oneIn, mcSummary, MC_STATS } from "./montecarlo.js";
export { awards } from "./awards.js";
export { groupSummary, campaignTrend } from "./summarize.js";
