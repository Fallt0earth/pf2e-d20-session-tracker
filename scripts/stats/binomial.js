// @ts-check
// Exact binomial pmf and one-sided tails by direct summation in log space. n is at most a few
// thousand dice per session, so this is cheap and avoids any approximation. Pure.

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
  let s = 0;
  for (let i = k; i <= n; i++) s += binomialPmf(n, i, p);
  return Math.min(1, s);
}

/** P(X ≤ k): the "drought" tail (e.g. "no Nat 20 in 60 rolls, P ≈ 0.046"). */
export function binomialAtMost(n, k, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomialPmf(n, i, p);
  return Math.min(1, s);
}
