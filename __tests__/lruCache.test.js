'use strict';

/**
 * __tests__/lruCache.test.js
 *
 * Unit tests for the tiny dependency-free LRU cache used to front Prisma
 * reads for GET /api/preferences (see server.js).
 */

const { LruCache } = require('../lruCache');

describe('LruCache', () => {
  test('returns undefined for a missing key', () => {
    const cache = new LruCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  test('stores and retrieves a value', () => {
    const cache = new LruCache();
    cache.set('a', { foo: 'bar' });
    expect(cache.get('a')).toEqual({ foo: 'bar' });
  });

  test('overwriting a key updates its value', () => {
    const cache = new LruCache();
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });

  test('expires entries after ttlMs', async () => {
    const cache = new LruCache({ ttlMs: 20 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get('a')).toBeUndefined();
  });

  test('evicts the least-recently-used entry once over maxSize', () => {
    const cache = new LruCache({ maxSize: 2, ttlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touch 'a' so 'b' becomes the least-recently-used entry.
    cache.get('a');
    cache.set('c', 3);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  test('delete removes a single entry', () => {
    const cache = new LruCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  test('clear empties the cache', () => {
    const cache = new LruCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
