'use strict';

/**
 * lib/preferencesCache.js — a tiny in-process LRU cache with a short TTL,
 * keyed by user id, sitting in front of Prisma reads of the Preference row.
 *
 * Only reads are cached. Every write still goes through Prisma to MySQL; the
 * cache entry is then replaced with the freshly written row. The short TTL
 * bounds staleness when another device (or another process) changes the row.
 */

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS      = 30 * 1000;

function createPreferencesCache({ maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  // Map preserves insertion order, so the first key is the least recently used.
  const entries = new Map(); // userId -> { value, expiresAt }

  return {
    get(userId) {
      const hit = entries.get(userId);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(userId);
        return undefined;
      }
      entries.delete(userId);
      entries.set(userId, hit); // mark as most recently used
      return hit.value;
    },
    set(userId, value) {
      entries.delete(userId);
      entries.set(userId, { value, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
    },
    delete(userId) {
      entries.delete(userId);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

module.exports = { createPreferencesCache, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS };
