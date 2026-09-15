// @ts-check
// Streaks and runs over dice in time order. Input is an array of naturals (1–20) with optional
// parallel timestamps; output carries indices and timestamps so the UI can say when it happened.

export const HOT_MIN = 16;
export const COLD_MAX = 5;

/**
 * Longest run of consecutive values satisfying `predicate`.
 * @param {number[]} values
 * @param {(v: number, i: number) => boolean} predicate
 * @returns {{ length: number, start: number, end: number }}  indices inclusive; length 0 → start/end −1
 */
export function longestRun(values, predicate) {
  let best = { length: 0, start: -1, end: -1 };
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const ok = i < values.length && predicate(values[i], i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const length = i - start;
      if (length > best.length) best = { length, start, end: i - 1 };
      start = -1;
    }
  }
  return best;
}

/** Longest run of one repeated value; reports which value. */
export function longestSameFace(values) {
  let best = { length: 0, start: -1, end: -1, face: null };
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    if (i === values.length || values[i] !== values[start]) {
      const length = i - start;
      if (length > best.length) best = { length, start, end: i - 1, face: values[start] };
      start = i;
    }
  }
  return best;
}

/**
 * All streak stats for one group's dice.
 * @param {number[]} naturals   time-ordered
 * @param {(number|null)[]} [timestamps]   parallel array of ms epochs
 */
export function streakSummary(naturals, timestamps = []) {
  const withTs = (run) => ({
    ...run,
    startTs: run.start >= 0 ? timestamps[run.start] ?? null : null,
    endTs: run.end >= 0 ? timestamps[run.end] ?? null : null,
  });
  const hot = longestRun(naturals, (v) => v >= HOT_MIN);
  const cold = longestRun(naturals, (v) => v <= COLD_MAX);
  const without20 = longestRun(naturals, (v) => v !== 20);
  const same = longestSameFace(naturals);
  const first20 = naturals.indexOf(20);
  const last20 = naturals.lastIndexOf(20);
  const first1 = naturals.indexOf(1);
  const last1 = naturals.lastIndexOf(1);
  return {
    hot: withTs(hot),
    cold: withTs(cold),
    without20: withTs(without20),
    sameFace: withTs(same),
    nat20: { first: first20, last: last20, firstTs: first20 >= 0 ? timestamps[first20] ?? null : null, lastTs: last20 >= 0 ? timestamps[last20] ?? null : null },
    nat1: { first: first1, last: last1, firstTs: first1 >= 0 ? timestamps[first1] ?? null : null, lastTs: last1 >= 0 ? timestamps[last1] ?? null : null },
  };
}
