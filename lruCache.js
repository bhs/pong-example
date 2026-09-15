'use strict';

/**
 * lruCache.js — tiny in-process LRU cache with a per-entry TTL.
 *
 * Used to sit in front of the SQLite reads in preferencesRepo.js so repeat
 * fetches of the same user's preferences within a session don't have to hit
 * disk every time. Deliberately dependency-free (no npm package) since the
 * requirements are small: bounded size, expiry, and O(1) get/set.
 *
 * Eviction policy: least-recently-used, implemented via Map's insertion-order
 * iteration — re-inserting a key on access moves it to the "most recently
 * used" end, and the oldest entry (first key in iteration order) is dropped
 * once the cache exceeds maxSize.
 */

class LruCache {
  /**
   * @param {object}  [opts]
   * @param {number}  [opts.maxSize=500] - maximum number of entries kept.
   * @param {number}  [opts.ttlMs=30000] - entry lifetime in milliseconds.
   */
  constructor({ maxSize = 500, ttlMs = 30000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs   = ttlMs;
    this.map     = new Map(); // key -> { value, expiresAt }
  }

  /**
   * Returns the cached value for `key`, or undefined if missing/expired.
   * A hit refreshes the entry's recency (moves it to the "most recent" end).
   */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh recency: delete + re-insert so it lands at the end of the
    // Map's iteration order (most-recently-used).
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /**
   * Stores `value` under `key`, resetting its TTL. Evicts the least-recently
   * used entry if the cache is now over capacity.
   */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

module.exports = { LruCache };
