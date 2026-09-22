// @ts-check
// Calendar helpers for session bucketing. The "daily" definition (decision D1): one session per
// real-world day in a fixed world timezone with a boundary hour (default 06:00 America/Chicago) —
// anything before the boundary belongs to the previous calendar day. The other definitions (gap,
// manual) live in sessionizer.js and use these helpers for local dates. Pure: Intl only, no Foundry.

export const DEFAULT_TIMEZONE = "America/Chicago";
export const DEFAULT_BOUNDARY_HOUR = 6;
/** Key of the bucket that holds rolls made outside any session (manual mode). */
export const UNSCHEDULED = "unscheduled";

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

/** True when the runtime knows this IANA timezone. */
export function isValidTimezone(timezone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return true; } catch { return false; }
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
 * The daily key for a timestamp: `YYYY-MM-DD` of the calendar day the session started on.
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
 * A cheap timestamp window that surely contains every message of a daily key, whatever the timezone
 * and boundary hour: filter on it before calling sessionKeyFor on each message (Intl is ~2 µs a call;
 * a comparison is nothing, and a world can hold tens of thousands of messages).
 * @param {string} key   `YYYY-MM-DD` (a `~N` suffix is ignored)
 * @returns {{ lo: number, hi: number }}
 */
export function dayWindow(key) {
  const [y, m, d] = parseKey(key).base.split("-").map(Number);
  const day = Date.UTC(y, m - 1, d);
  return { lo: day - 1.5 * DAY_MS, hi: day + 2.5 * DAY_MS };
}

/**
 * The instant a calendar date begins in `timezone` (00:00 local), for turning a date picked in a
 * form into a timestamp bound. Intl only converts instants to wall clocks, so the offset is read off
 * the wall clock at noon UTC of that date and applied; on a DST switch day the answer can be an hour
 * off, which is fine for a range bound.
 * @param {string} dateKey   `YYYY-MM-DD`
 * @param {string} [timezone]
 * @returns {number|null}   null when the key is not a date
 */
export function localMidnight(dateKey, timezone = DEFAULT_TIMEZONE) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  if (!y || !m || !d) return null;
  const noon = Date.UTC(y, m - 1, d, 12);
  const w = wallClock(noon, timezone);
  const offset = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - noon;
  return Date.UTC(y, m - 1, d) - offset;
}

/** Plain local calendar date of a timestamp (no boundary shift). */
export function localDateKey(ts, timezone = DEFAULT_TIMEZONE) {
  return sessionKeyFor(ts, { timezone, boundaryHour: 0 });
}

const KEY = /^\d{4}-\d{2}-\d{2}(?:~\d{1,3})?$/;

/** True for a well-formed session key: `YYYY-MM-DD`, `YYYY-MM-DD~N`, or the unscheduled bucket. */
export function isSessionKey(key) {
  return key === UNSCHEDULED || (typeof key === "string" && KEY.test(key));
}

/** Split a key into its date and its same-day sequence number: "2026-09-19~2" → { base, seq: 2 }. */
export function parseKey(key) {
  const [base, seq] = String(key).split("~");
  return { base, seq: seq ? Number(seq) : 1 };
}

/**
 * Human label for a key: `2026-09-15 Tue`, `2026-09-19 Sat (2)` for a second session that date.
 * @param {string} key
 * @param {string} [locale]
 */
export function sessionLabel(key, locale = "en-US") {
  if (key === UNSCHEDULED) return "Unscheduled";
  const { base, seq } = parseKey(key);
  const [y, m, d] = base.split("-").map(Number);
  if (!y || !m || !d) return String(key);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
  return `${base} ${weekday}${seq > 1 ? ` (${seq})` : ""}`;
}

/** Chronological order of keys; the unscheduled bucket sorts before everything (so it lands last in newest-first lists). */
export function compareKeys(a, b) {
  if (a === b) return 0;
  if (a === UNSCHEDULED) return -1;
  if (b === UNSCHEDULED) return 1;
  const pa = parseKey(a), pb = parseKey(b);
  if (pa.base !== pb.base) return pa.base < pb.base ? -1 : 1;
  return pa.seq - pb.seq;
}

function isoDate(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10);
}
