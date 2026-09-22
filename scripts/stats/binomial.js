// @ts-check
// Exact binomial pmf and one-sided tails. The tails are summed from the boundary term outwards with
// the ratio between neighbouring terms, so each is linear in the number of terms that matter and
// stops once the rest cannot change the double any more: the all-time tail over tens of thousands of
// dice (History tab) costs the same as a session's. Pure.

/** log C(n, k) via a running sum (exact enough for n ≤ 1e5). */
export function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  k = Math.min(k, n - k);
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X = k) for X ~ Binomial(n, p). */
export function binomialPmf(n, k, p) {
  if (k < 0 || k > n || n < 0) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(X ≥ k): the "excess" tail (e.g. "3 Nat 20s in 22 rolls, P ≈ 0.095"). */
export function binomialAtLeast(n, k, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // Below the mode the terms grow towards it, so the short, shrinking side is the complement.
  if (k <= mode(n, p)) return clamp(1 - sumOutwards(n, k - 1, p, -1));
  return clamp(sumOutwards(n, k, p, +1));
}

/** P(X ≤ k): the "drought" tail (e.g. "no Nat 20 in 60 rolls, P ≈ 0.046"). */
export function binomialAtMost(n, k, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  if (k >= mode(n, p)) return clamp(1 - sumOutwards(n, k + 1, p, +1));
  return clamp(sumOutwards(n, k, p, -1));
}

/** The most likely count, ⌊(n + 1)p⌋. */
function mode(n, p) {
  return Math.floor((n + 1) * p);
}

/**
 * Σ pmf(i) for i from k to the end of the distribution in `direction`, where the terms shrink all the
 * way (k at or beyond the mode on that side). pmf(k) is computed once; each next term is the previous
 * one times a ratio, and the sum stops when a term is below the double-precision floor of the total.
 * A starting term that underflows means the tail is below 1e-308: zero is the honest answer.
 */
function sumOutwards(n, k, p, direction) {
  let term = binomialPmf(n, k, p);
  if (term === 0) return 0;
  const q = 1 - p;
  let s = term;
  if (direction > 0) {
    for (let i = k; i < n; i++) {
      term *= ((n - i) / (i + 1)) * (p / q);
      s += term;
      if (term < s * 1e-17) break;
    }
  } else {
    for (let i = k; i > 0; i--) {
      term *= (i / (n - i + 1)) * (q / p);
      s += term;
      if (term < s * 1e-17) break;
    }
  }
  return s;
}

function clamp(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
