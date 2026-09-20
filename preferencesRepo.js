'use strict';

/**
 * preferencesRepo.js — repository for the user_preferences table.
 *
 * Wraps all MySQL access for style preferences behind get/upsert functions
 * using parameterized queries — no string-built SQL. An in-process LruCache
 * (keyed by user_id, short TTL) sits in front of reads to absorb repeat
 * fetches within a session; every write goes straight to MySQL first and
 * only then updates the cache (write-through), so restarts and multi-device
 * logins always see the latest saved values.
 */

const { LruCache } = require('./lruCache');

// Matches the game's current hardcoded look, so a user who has never saved
// preferences sees exactly what they'd see without this feature at all.
const DEFAULT_PREFERENCES = Object.freeze({
  paddleColor: '#ffffff',
  ballColor:   '#ffffff',
  bgColor:     '#000000',
  presetName:  null,
});

// The two one-click presets offered in the settings modal.
const PRESETS = Object.freeze({
  classic: Object.freeze({ paddleColor: '#ffffff', ballColor: '#ffffff', bgColor: '#000000' }),
  neon:    Object.freeze({ paddleColor: '#39ff14', ballColor: '#ff2ec4', bgColor: '#0d0221' }),
});

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const SELECT_SQL = `
  SELECT
    user_id      AS userId,
    paddle_color AS paddleColor,
    ball_color   AS ballColor,
    bg_color     AS bgColor,
    preset_name  AS presetName,
    updated_at   AS updatedAt
  FROM user_preferences
  WHERE user_id = ?
`;

const UPSERT_SQL = `
  INSERT INTO user_preferences
    (user_id, paddle_color, ball_color, bg_color, preset_name, updated_at)
  VALUES
    (?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    paddle_color = VALUES(paddle_color),
    ball_color   = VALUES(ball_color),
    bg_color     = VALUES(bg_color),
    preset_name  = VALUES(preset_name),
    updated_at   = VALUES(updated_at)
`;

/**
 * @param {import('mysql2/promise').Pool} db
 * @param {object}  [opts]
 * @param {number}  [opts.cacheTtlMs=30000]  - how long a cached row stays fresh.
 * @param {number}  [opts.cacheMaxSize=500]  - max distinct users cached at once.
 */
function createPreferencesRepo(db, { cacheTtlMs = 30000, cacheMaxSize = 500 } = {}) {
  const cache = new LruCache({ ttlMs: cacheTtlMs, maxSize: cacheMaxSize });

  /**
   * Returns the saved preferences row for `userId`, or null if the user has
   * never saved any (caller decides whether to fall back to defaults).
   * Reads are served from the LRU cache when possible; a miss falls through
   * to MySQL and populates the cache (including negative results, so a
   * user who has never saved anything doesn't cause a DB hit on every page
   * load either).
   */
  async function getPreferences(userId) {
    if (!userId) return null;

    const cached = cache.get(userId);
    if (cached !== undefined) return cached;

    const [rows] = await db.execute(SELECT_SQL, [userId]);
    const row    = rows[0];
    const result = row ? normalizeRow(row) : null;
    cache.set(userId, result);
    return result;
  }

  /**
   * Creates or updates the preferences row for `userId`. Any field omitted
   * from `patch` keeps its previous value (or the built-in default if the
   * user has no existing row yet — i.e. this call also auto-creates the row
   * on first save). Always writes to MySQL; the cache is updated in the
   * same call so subsequent reads are immediately consistent.
   *
   * @param {string} userId
   * @param {{paddleColor?:string, ballColor?:string, bgColor?:string, presetName?:?string}} patch
   */
  async function upsertPreferences(userId, patch = {}) {
    if (!userId) throw new Error('userId is required');

    for (const field of ['paddleColor', 'ballColor', 'bgColor']) {
      const value = patch[field];
      if (value !== undefined && !HEX_COLOR_RE.test(value)) {
        throw new Error(`${field} must be a hex color like #rrggbb`);
      }
    }

    const existing = (await getPreferences(userId)) || DEFAULT_PREFERENCES;

    const next = {
      userId,
      paddleColor: patch.paddleColor !== undefined ? patch.paddleColor : existing.paddleColor,
      ballColor:   patch.ballColor   !== undefined ? patch.ballColor   : existing.ballColor,
      bgColor:     patch.bgColor     !== undefined ? patch.bgColor     : existing.bgColor,
      presetName:  patch.presetName  !== undefined ? patch.presetName  : (existing.presetName || null),
      updatedAt:   Date.now(),
    };

    await db.execute(UPSERT_SQL, [
      next.userId,
      next.paddleColor,
      next.ballColor,
      next.bgColor,
      next.presetName,
      next.updatedAt,
    ]);
    cache.set(userId, next);

    return next;
  }

  /** Drops all cached rows (mainly useful for tests). */
  function clearCache() {
    cache.clear();
  }

  return { getPreferences, upsertPreferences, clearCache, _cache: cache };
}

/**
 * MySQL's mysql2 driver returns BIGINT columns as JS `bigint` values (or
 * strings, depending on driver config) rather than plain numbers — normalize
 * updated_at back to a plain number so callers/tests can keep treating it as
 * the epoch-millisecond number Date.now() produced when it was written.
 */
function normalizeRow(row) {
  return { ...row, updatedAt: Number(row.updatedAt) };
}

module.exports = { createPreferencesRepo, DEFAULT_PREFERENCES, PRESETS, HEX_COLOR_RE };
