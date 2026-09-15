// @ts-check
// Standard normal helpers. erf via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) — plenty for
// "tonight was a 91st-percentile night". Pure.

/** @param {number} x */
export function erf(x) {
  if (x === 0) return 0; // the polynomial leaves a ~1e-9 residue at zero
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Φ(z): probability a standard normal is ≤ z. */
export function normalCdf(z) {
  if (!Number.isFinite(z)) return z > 0 ? 1 : z < 0 ? 0 : NaN;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Two-sided tail: probability of |Z| ≥ |z| under the null. */
export function twoSidedP(z) {
  return 2 * (1 - normalCdf(Math.abs(z)));
}
