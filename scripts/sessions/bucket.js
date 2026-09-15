// @ts-check
// Session bucketing (decision D1): one session = one real-world evening. Bucket by the message's
// ms-epoch timestamp in a fixed world timezone with a boundary hour (default 06:00 America/Chicago):
// anything before the boundary belongs to the previous calendar day. Pure: Intl only, no Foundry.

export const DEFAULT_TIMEZONE = "America/Chicago";
export const DEFAULT_BOUNDARY_HOUR = 6;

const DAY_MS = 86_400_000;
/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

function formatterFor(timezone) {
  let fmt = formatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    formatters.set(timezone, fmt);
  }
  return fmt;
}

/**
 * Wall-clock components of `ts` in `timezone`.
 * @param {number} ts
 * @param {string} timezone
 * @returns {{year: number, month: number, day: number, hour: number, minute: number}}
 */
export function wallClock(ts, timezone = DEFAULT_TIMEZONE) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  for (const part of formatterFor(timezone).formatToParts(ts)) {
    if (part.type in out) out[part.type] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0; // defensive: some engines emit 24 at midnight despite h23
  return out;
}

/**
 * The evening key for a timestamp: `YYYY-MM-DD` of the calendar day the evening started on.
 * @param {number} ts ms epoch (message.timestamp)
 * @param {{timezone?: string, boundaryHour?: number}} [opts]
 * @returns {string}
 */
export function sessionKeyFor(ts, { timezone = DEFAULT_TIMEZONE, boundaryHour = DEFAULT_BOUNDARY_HOUR } = {}) {
  const w = wallClock(ts, timezone);
  let dayUtc = Date.UTC(w.year, w.month - 1, w.day);
  if (w.hour < boundaryHour) dayUtc -= DAY_MS; // calendar arithmetic in UTC: immune to DST shifts
  return isoDate(dayUtc);
}

/**
 * Human label for a key: `2026-09-15 Tue`.
 * @param {string} key
 * @param {string} [locale]
 */
export function sessionLabel(key, locale = "en-US") {
  const [y, m, d] = key.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
  return `${key} ${weekday}`;
}

/** Sort helper: keys are ISO dates, so lexical order is chronological. */
export function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isoDate(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10);
}
