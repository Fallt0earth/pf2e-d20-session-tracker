// @ts-check
// Chi-square goodness of fit against a uniform d20, with the bin count chosen from n (textbook rule:
// expected ≥ 5 per bin → 20 bins need n ≥ 100, 4 coarse bins need n ≥ 20). p from the regularized
// lower incomplete gamma function (series + continued fraction, Numerical Recipes style). Pure.

/** Regularized lower incomplete gamma P(a, x). */
export function regularizedGammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // series
    let sum = 1 / a, term = 1 / a, ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      term *= x / ap;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction for Q, then P = 1 − Q
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return 1 - q;
}

/** Lanczos log-gamma. */
export function logGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Upper-tail p-value of a chi-square statistic with `df` degrees of freedom. */
export function chiSquareP(stat, df) {
  if (!(stat > 0) || !(df > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - regularizedGammaP(df / 2, stat / 2)));
}

/**
 * Goodness of fit of a 20-face histogram against uniform.
 * @param {number[]} hist   counts per face, index 0 = face 1
 * @returns {{ n: number, bins: 20|4|null, stat: number|null, df: number|null, p: number|null, observed: number[], expected: number|null }}
 */
export function chiSquareUniform(hist) {
  const n = hist.reduce((s, v) => s + v, 0);
  let observed, bins;
  if (n >= 100) { observed = [...hist]; bins = 20; }
  else if (n >= 20) { observed = [0, 1, 2, 3].map((b) => hist.slice(b * 5, b * 5 + 5).reduce((s, v) => s + v, 0)); bins = 4; }
  else return { n, bins: null, stat: null, df: null, p: null, observed: [...hist], expected: null };
  const expected = n / bins;
  const stat = observed.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  const df = bins - 1;
  return { n, bins, stat, df, p: chiSquareP(stat, df), observed, expected };
}
