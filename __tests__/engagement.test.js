'use strict';

/**
 * __tests__/engagement.test.js
 *
 * Unit tests for lib/engagement.js (streak and yesterday/today bests) and
 * the two option functions of lib/engagement-traits.js, called directly.
 */

const { computeEngagement, parseTzOffset, localDay, DAY_MS } = require('../lib/engagement');
const traits = require('../lib/engagement-traits');

const NOW = Date.UTC(2024, 5, 15, 12, 0, 0); // Sat 15 Jun 2024, 12:00 UTC
const game = (daysAgo, score = 5, extraMs = 0) => ({ finishedAt: new Date(NOW - daysAgo * DAY_MS + extraMs), score });

describe('computeEngagement', () => {
  test('no games: no streak, nothing played', () => {
    expect(computeEngagement([], 0, NOW)).toEqual({
      streak: 0, playedToday: false, yesterdayBest: null, todayBest: null,
    });
    expect(computeEngagement(undefined, 0, NOW).streak).toBe(0);
  });

  test('counts consecutive days ending today', () => {
    const r = computeEngagement([game(0, 3), game(1, 7), game(2, 4)], 0, NOW);
    expect(r).toEqual({ streak: 3, playedToday: true, yesterdayBest: 7, todayBest: 3 });
  });

  test('stays alive through today when the player has not played yet', () => {
    const r = computeEngagement([game(1, 6), game(2, 2)], 0, NOW);
    expect(r).toEqual({ streak: 2, playedToday: false, yesterdayBest: 6, todayBest: null });
  });

  test('resets after a missed day', () => {
    const r = computeEngagement([game(2), game(3), game(4)], 0, NOW);
    expect(r.streak).toBe(0);
    expect(r.yesterdayBest).toBeNull();
  });

  test('a gap ends the run at the days after it', () => {
    expect(computeEngagement([game(0), game(1), game(3), game(4)], 0, NOW).streak).toBe(2);
  });

  test('several games on a day count once and the best score wins', () => {
    const r = computeEngagement([game(1, 2), game(1, 9, 1000), game(1, 4, 2000)], 0, NOW);
    expect(r.streak).toBe(1);
    expect(r.yesterdayBest).toBe(9);
  });

  test('a score of 0 is still a played day with a best of 0', () => {
    expect(computeEngagement([game(1, 0)], 0, NOW).yesterdayBest).toBe(0);
  });

  test('day boundary falls at local midnight, not UTC midnight', () => {
    const justAfterUtcMidnight = Date.UTC(2024, 5, 15, 0, 30, 0);
    const rows = [{ finishedAt: new Date(Date.UTC(2024, 5, 14, 23, 50, 0)), score: 5 }];
    // UTC: that game was yesterday.
    expect(computeEngagement(rows, 0, justAfterUtcMidnight).yesterdayBest).toBe(5);
    // UTC-5 (offset +300): both instants are still 14 Jun locally, so it's today.
    const west = computeEngagement(rows, 300, justAfterUtcMidnight);
    expect(west.playedToday).toBe(true);
    expect(west.yesterdayBest).toBeNull();
    // UTC+2 (offset -120): 01:50 and 02:30 on 15 Jun — also the same day.
    expect(computeEngagement(rows, -120, justAfterUtcMidnight).playedToday).toBe(true);
  });

  test('the same history reads differently in different timezones', () => {
    // 23:30 UTC on 14 Jun, viewed at 12:00 UTC on 15 Jun.
    const rows = [{ finishedAt: new Date(Date.UTC(2024, 5, 14, 23, 30, 0)), score: 8 }];
    expect(computeEngagement(rows, 0, NOW).yesterdayBest).toBe(8);
    // At UTC+10 (offset -600) the game happened at 09:30 on 15 Jun = today.
    expect(computeEngagement(rows, -600, NOW).todayBest).toBe(8);
  });

  test('rows dated in the future (clock skew) are ignored', () => {
    const r = computeEngagement([game(-1), game(-2), game(1)], 0, NOW);
    expect(r.streak).toBe(1);
    expect(r.playedToday).toBe(false);
  });

  test('accepts numeric timestamps and skips malformed rows', () => {
    const rows = [{ finishedAt: NOW, score: 4 }, { finishedAt: 'nope', score: 1 }, { finishedAt: NOW, score: NaN }, null];
    expect(computeEngagement(rows, 0, NOW)).toMatchObject({ streak: 1, todayBest: 4 });
  });
});

describe('localDay / parseTzOffset', () => {
  test('localDay follows getTimezoneOffset sign convention', () => {
    const t = Date.UTC(2024, 0, 2, 1, 0, 0); // 01:00 UTC on 2 Jan
    expect(localDay(t, 0)).toBe(localDay(t, -60) );
    expect(localDay(t, 120)).toBe(localDay(t, 0) - 1); // UTC-2: still 1 Jan
  });

  test('parseTzOffset defaults to 0 and rejects junk', () => {
    expect(parseTzOffset(undefined)).toBe(0);
    expect(parseTzOffset('')).toBe(0);
    expect(parseTzOffset('-330')).toBe(-330);
    expect(parseTzOffset('abc')).toBeNull();
    expect(parseTzOffset('1.5')).toBeNull();
    expect(parseTzOffset('99999')).toBeNull();
  });
});

describe('trait options', () => {
  test('toastOverTheScreen describes a timed toast', () => {
    expect(traits.toastOverTheScreen()).toEqual({ placement: 'toast-over-the-screen', durationMs: 5000 });
  });

  test('signedOutStreakOff turns the signed-out streak off with a sign-in line', () => {
    expect(traits.signedOutStreakOff()).toEqual({ enabled: false, line: 'Sign in to build a streak' });
  });
});
