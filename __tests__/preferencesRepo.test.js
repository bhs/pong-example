'use strict';

/**
 * __tests__/preferencesRepo.test.js
 *
 * Unit tests for the SQLite-backed user_preferences repository. Each test
 * opens a fresh in-memory database (':memory:') so tests never touch disk
 * and are fully isolated from one another.
 */

const { createDb } = require('../db');
const { createPreferencesRepo, DEFAULT_PREFERENCES, PRESETS } = require('../preferencesRepo');

function freshRepo(opts) {
  const db = createDb(':memory:');
  return createPreferencesRepo(db, opts);
}

describe('preferencesRepo.getPreferences', () => {
  test('returns null for a user with no saved row', () => {
    const repo = freshRepo();
    expect(repo.getPreferences('user-1')).toBeNull();
  });

  test('returns null when userId is falsy', () => {
    const repo = freshRepo();
    expect(repo.getPreferences(null)).toBeNull();
    expect(repo.getPreferences(undefined)).toBeNull();
  });
});

describe('preferencesRepo.upsertPreferences', () => {
  test('auto-creates a row on first save, filling in defaults for omitted fields', () => {
    const repo = freshRepo();
    const saved = repo.upsertPreferences('user-1', { paddleColor: '#123456' });

    expect(saved.paddleColor).toBe('#123456');
    expect(saved.ballColor).toBe(DEFAULT_PREFERENCES.ballColor);
    expect(saved.bgColor).toBe(DEFAULT_PREFERENCES.bgColor);
    expect(saved.presetName).toBeNull();
    expect(typeof saved.updatedAt).toBe('number');
  });

  test('a second call updates only the fields provided, keeping the rest', () => {
    const repo = freshRepo();
    repo.upsertPreferences('user-1', { paddleColor: '#111111', ballColor: '#222222', bgColor: '#333333' });
    const updated = repo.upsertPreferences('user-1', { ballColor: '#abcdef' });

    expect(updated.paddleColor).toBe('#111111');
    expect(updated.ballColor).toBe('#abcdef');
    expect(updated.bgColor).toBe('#333333');
  });

  test('persisted rows are retrievable via getPreferences', () => {
    const repo = freshRepo();
    repo.upsertPreferences('user-1', PRESETS.neon);
    const fetched = repo.getPreferences('user-1');

    expect(fetched.paddleColor).toBe(PRESETS.neon.paddleColor);
    expect(fetched.ballColor).toBe(PRESETS.neon.ballColor);
    expect(fetched.bgColor).toBe(PRESETS.neon.bgColor);
  });

  test('different users do not clobber each other', () => {
    const repo = freshRepo();
    repo.upsertPreferences('user-1', { paddleColor: '#111111' });
    repo.upsertPreferences('user-2', { paddleColor: '#222222' });

    expect(repo.getPreferences('user-1').paddleColor).toBe('#111111');
    expect(repo.getPreferences('user-2').paddleColor).toBe('#222222');
  });

  test('rejects an invalid hex color', () => {
    const repo = freshRepo();
    expect(() => repo.upsertPreferences('user-1', { paddleColor: 'not-a-color' })).toThrow();
  });

  test('throws when userId is missing', () => {
    const repo = freshRepo();
    expect(() => repo.upsertPreferences(null, { paddleColor: '#111111' })).toThrow();
  });

  test('storing a presetName round-trips correctly', () => {
    const repo = freshRepo();
    const saved = repo.upsertPreferences('user-1', { ...PRESETS.classic, presetName: 'classic' });
    expect(saved.presetName).toBe('classic');
    expect(repo.getPreferences('user-1').presetName).toBe('classic');
  });
});

describe('preferencesRepo caching', () => {
  test('a write updates the cache so an immediate read is consistent without hitting SQLite again', () => {
    const repo = freshRepo();
    repo.upsertPreferences('user-1', { paddleColor: '#111111' });

    // Directly inspect the cache to confirm write-through behaviour.
    expect(repo._cache.get('user-1').paddleColor).toBe('#111111');
    expect(repo.getPreferences('user-1').paddleColor).toBe('#111111');
  });

  test('clearCache forces the next read to go back to SQLite (still returns correct data)', () => {
    const repo = freshRepo();
    repo.upsertPreferences('user-1', { paddleColor: '#111111' });
    repo.clearCache();

    expect(repo._cache.size).toBe(0);
    expect(repo.getPreferences('user-1').paddleColor).toBe('#111111');
  });

  test('a cached miss (no saved row) does not fall through to SQLite on repeat reads', () => {
    const repo = freshRepo();
    expect(repo.getPreferences('never-saved')).toBeNull();
    // Still null, and served from cache (negative caching) — exercised
    // indirectly since a real DB hit would also return null, but this at
    // least confirms repeated calls are stable and don't throw.
    expect(repo.getPreferences('never-saved')).toBeNull();
  });
});
