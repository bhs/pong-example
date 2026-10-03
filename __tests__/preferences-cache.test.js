'use strict';

const { createPreferencesCache } = require('../lib/preferencesCache');

describe('preferences cache', () => {
  test('returns stored values and undefined for misses', () => {
    const cache = createPreferencesCache();
    cache.set('a', { ballColor: '#fff000' });
    expect(cache.get('a')).toEqual({ ballColor: '#fff000' });
    expect(cache.get('b')).toBeUndefined();
  });

  test('expires entries after the TTL', () => {
    let t = 1000;
    const cache = createPreferencesCache({ ttlMs: 100, now: () => t });
    cache.set('a', 1);
    t += 99;
    expect(cache.get('a')).toBe(1);
    t += 2;
    expect(cache.get('a')).toBeUndefined();
  });

  test('evicts the least recently used entry beyond max size', () => {
    const cache = createPreferencesCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});
