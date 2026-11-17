'use strict';

/**
 * lib/engagement.js — daily-play streak and "beat your yesterday" numbers.
 *
 * A pure function over a player's GameHistory rows. Nothing is stored: the
 * streak is derived from the history every time, so it can never drift from
 * the games actually finished (and a double-submitted game can't count twice).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// How much history GET /api/engagement reads — also the longest streak it can report.
const HISTORY_DAYS = 400;

// Real-world UTC offsets run from -12:00 to +14:00; the client sends
// Date.prototype.getTimezoneOffset() (minutes, positive west of UTC).
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

/**
 * The local calendar day a UTC instant falls on, as a whole number of days
 * since the local epoch. `tzOffsetMinutes` is JavaScript's getTimezoneOffset():
 * UTC minus local time, so UTC-5 is +300 and UTC+2 is -120.
 */
function localDay(ms, tzOffsetMinutes) {
  return Math.floor((ms - tzOffsetMinutes * 60 * 1000) / DAY_MS);
}

/**
 * @param {Array<{finishedAt: Date|number|string, score: number}>} rows
 * @param {number} tzOffsetMinutes  client's getTimezoneOffset()
 * @param {number} [now]            current time in ms (injectable for tests)
 * @returns {{streak: number, playedToday: boolean,
 *            yesterdayBest: number|null, todayBest: number|null}}
 *
 * A streak is the run of consecutive local days, ending today, with at least
 * one finished game. If the player has not played yet today it ends yesterday
 * instead (still alive); once a whole day is missed it is 0. Rows dated after
 * today (a skewed clock) are ignored rather than extending the streak.
 */
function computeEngagement(rows, tzOffsetMinutes = 0, now = Date.now()) {
  const today = localDay(now, tzOffsetMinutes);
  const bestByDay = new Map();

  for (const row of rows || []) {
    const finished = row && row.finishedAt instanceof Date
      ? row.finishedAt.getTime()
      : new Date(row && row.finishedAt).getTime();
    const score = Number(row && row.score);
    if (!Number.isFinite(finished) || !Number.isFinite(score)) continue;

    const day = localDay(finished, tzOffsetMinutes);
    if (day > today) continue;

    const best = bestByDay.get(day);
    if (best === undefined || score > best) bestByDay.set(day, score);
  }

  const playedToday = bestByDay.has(today);
  let streak = 0;
  for (let day = playedToday ? today : today - 1; bestByDay.has(day); day -= 1) {
    streak += 1;
  }

  return {
    streak,
    playedToday,
    yesterdayBest: bestByDay.has(today - 1) ? bestByDay.get(today - 1) : null,
    todayBest: playedToday ? bestByDay.get(today) : null,
  };
}

/**
 * Parses the ?tzOffset= query value. Missing means UTC (0); anything that is
 * not a whole number of minutes within real-world bounds returns null.
 */
function parseTzOffset(value) {
  if (value === undefined || value === '') return 0;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || Math.abs(minutes) > MAX_TZ_OFFSET_MINUTES) return null;
  return minutes;
}

module.exports = { computeEngagement, parseTzOffset, localDay, DAY_MS, HISTORY_DAYS };
