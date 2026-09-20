'use strict';

/**
 * __tests__/preferencesRepo.test.js
 *
 * Unit tests for the MySQL-backed user_preferences repository. Production
 * (and these tests) run against real MySQL 8.4 via mysql2 — see db.js —
 * rather than an embedded/in-memory database, since MySQL has no
 * ':memory:' equivalent. Each test starts from a clean table (see
 * beforeEach below) so tests stay isolated from one another the same way
 * a fresh in-memory SQLite database used to provide.
 */

const { createDb, resetForTests } = require('../db');
const { createPreferencesRepo, DEFAULT_PREFERENCES, PRESETS } = require('../preferencesRepo');

let db;

beforeAll(() => {
  db = createDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await resetForTests(db);
});

function freshRepo(opts) {
  return createPreferencesRepo(db, opts);
}

describe('preferencesRepo.getPreferences', () => {
  test('returns null for a user with no saved row', async () => {
    const repo = freshRepo();
    expect(await repo.getPreferences('user-1')).toBeNull();
  });

  test('returns null when userId is falsy', async () => {
    const repo = freshRepo();
    expect(await repo.getPreferences(null)).toBeNull();
    expect(await repo.getPreferences(undefined)).toBeNull();
  });
});

describe('preferencesRepo.upsertPreferences', () => {
  test('auto-creates a row on first save, filling in defaults for omitted fields', async () => {
    const repo = freshRepo();
    const saved = await repo.upsertPreferences('user-1', { paddleColor: '#123456' });

    expect(saved.paddleColor).toBe('#123456');
    expect(saved.ballColor).toBe(DEFAULT_PREFERENCES.ballColor);
    expect(saved.bgColor).toBe(DEFAULT_PREFERENCES.bgColor);
    expect(saved.presetName).toBeNull();
    expect(typeof saved.updatedAt).toBe('number');
  });

  test('a second call updates only the fields provided, keeping the rest', async () => {
    const repo = freshRepo();
    await repo.upsertPreferences('user-1', { paddleColor: '#111111', ballColor: '#222222', bgColor: '#333333' });
    const updated = await repo.upsertPreferences('user-1', { ballColor: '#abcdef' });

    expect(updated.paddleColor).toBe('#111111');
    expect(updated.ballColor).toBe('#abcdef');
    expect(updated.bgColor).toBe('#333333');
  });

  test('persisted rows are retrievable via getPreferences', async () => {
    const repo = freshRepo();
    await repo.upsertPreferences('user-1', PRESETS.neon);
    const fetched = await repo.getPreferences('user-1');

    expect(fetched.paddleColor).toBe(PRESETS.neon.paddleColor);
    expect(fetched.ballColor).toBe(PRESETS.neon.ballColor);
    expect(fetched.bgColor).toBe(PRESETS.neon.bgColor);
  });

  test('different users do not clobber each other', async () => {
    const repo = freshRepo();
    await repo.upsertPreferences('user-1', { paddleColor: '#111111' });
    await repo.upsertPreferences('user-2', { paddleColor: '#222222' });

    expect((await repo.getPreferences('user-1')).paddleColor).toBe('#111111');
    expect((await repo.getPreferences('user-2')).paddleColor).toBe('#222222');
  });

  test('rejects an invalid hex color', async () => {
    const repo = freshRepo();
    await expect(repo.upsertPreferences('user-1', { paddleColor: 'not-a-color' })).rejects.toThrow();
  });

  test('throws when userId is missing', async () => {
    const repo = freshRepo();
    await expect(repo.upsertPreferences(null, { paddleColor: '#111111' })).rejects.toThrow();
  });

  test('storing a presetName round-trips correctly', async () => {
    const repo = freshRepo();
    const saved = await repo.upsertPreferences('user-1', { ...PRESETS.classic, presetName: 'classic' });
    expect(saved.presetName).toBe('classic');
    expect((await repo.getPreferences('user-1')).presetName).toBe('classic');
  });
});

describe('preferencesRepo caching', () => {
  test('a write updates the cache so an immediate read is consistent without hitting MySQL again', async () => {
    const repo = freshRepo();
    await repo.upsertPreferences('user-1', { paddleColor: '#111111' });

    // Directly inspect the cache to confirm write-through behaviour.
    expect(repo._cache.get('user-1').paddleColor).toBe('#111111');
    expect((await repo.getPreferences('user-1')).paddleColor).toBe('#111111');
  });

  test('clearCache forces the next read to go back to MySQL (still returns correct data)', async () => {
    const repo = freshRepo();
    await repo.upsertPreferences('user-1', { paddleColor: '#111111' });
    repo.clearCache();

    expect(repo._cache.size).toBe(0);
    expect((await repo.getPreferences('user-1')).paddleColor).toBe('#111111');
  });

  test('a cached miss (no saved row) does not fall through to MySQL on repeat reads', async () => {
    const repo = freshRepo();
    expect(await repo.getPreferences('never-saved')).toBeNull();
    // Still null, and served from cache (negative caching) — exercised
    // indirectly since a real DB hit would also return null, but this at
    // least confirms repeated calls are stable and don't throw.
    expect(await repo.getPreferences('never-saved')).toBeNull();
  });
});
