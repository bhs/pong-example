'use strict';

/**
 * __tests__/preferences.test.js
 *
 * Unit tests for the user style preferences feature:
 *   - preferences-logic.js  (pure validation / defaults / presets)
 *   - db.js                 (SQLite-backed persistence, using ':memory:')
 *   - server.js /api/preferences endpoints — the parts testable without a
 *     real Google OAuth round-trip (guest fallback + auth guard + input
 *     validation), mirroring the existing convention in auth.test.js.
 */

const {
  DEFAULT_PREFERENCES,
  PRESET_CLASSIC,
  PRESET_NEON,
  isValidHexColor,
  validatePreferencesPayload,
} = require('../preferences-logic');

const { createPreferencesStore } = require('../db');
const { createApp, createStore } = require('../server');

// ── preferences-logic.js ─────────────────────────────────────────────────────

describe('isValidHexColor', () => {
  test('accepts well-formed 6-digit hex colors', () => {
    expect(isValidHexColor('#ffffff')).toBe(true);
    expect(isValidHexColor('#000000')).toBe(true);
    expect(isValidHexColor('#39ff14')).toBe(true);
  });

  test('rejects malformed values', () => {
    expect(isValidHexColor('ffffff')).toBe(false);   // missing '#'
    expect(isValidHexColor('#fff')).toBe(false);      // 3-digit shorthand not accepted
    expect(isValidHexColor('#gggggg')).toBe(false);   // non-hex digits
    expect(isValidHexColor('red')).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
    expect(isValidHexColor(undefined)).toBe(false);
    expect(isValidHexColor(123456)).toBe(false);
  });
});

describe('validatePreferencesPayload', () => {
  test('accepts a fully valid payload', () => {
    const result = validatePreferencesPayload({
      paddleColor: '#ffffff',
      ballColor:   '#ff00ff',
      bgColor:     '#000000',
    });
    expect(result.valid).toBe(true);
    expect(result.preferences).toEqual({
      paddleColor: '#ffffff',
      ballColor:   '#ff00ff',
      bgColor:     '#000000',
    });
  });

  test('rejects a payload missing a field', () => {
    const result = validatePreferencesPayload({ paddleColor: '#ffffff', ballColor: '#ffffff' });
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('rejects a payload with an invalid color', () => {
    const result = validatePreferencesPayload({
      paddleColor: 'not-a-color',
      ballColor:   '#ffffff',
      bgColor:     '#000000',
    });
    expect(result.valid).toBe(false);
  });

  test('rejects null/undefined body', () => {
    expect(validatePreferencesPayload(null).valid).toBe(false);
    expect(validatePreferencesPayload(undefined).valid).toBe(false);
  });

  test('DEFAULT_PREFERENCES and presets are all internally valid colors', () => {
    [DEFAULT_PREFERENCES, PRESET_CLASSIC, PRESET_NEON].forEach((preset) => {
      expect(isValidHexColor(preset.paddleColor)).toBe(true);
      expect(isValidHexColor(preset.ballColor)).toBe(true);
      expect(isValidHexColor(preset.bgColor)).toBe(true);
    });
  });
});

// ── db.js (SQLite persistence) ───────────────────────────────────────────────

describe('createPreferencesStore', () => {
  let store;

  beforeEach(() => {
    store = createPreferencesStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  test('get() returns null for a user with no saved preferences', () => {
    expect(store.get('google-sub-unknown')).toBeNull();
  });

  test('set() persists and get() retrieves the same values', () => {
    const saved = store.set('google-sub-1', {
      paddleColor: '#39ff14',
      ballColor:   '#ff00ff',
      bgColor:     '#0d0221',
    });
    expect(saved.paddleColor).toBe('#39ff14');
    expect(typeof saved.updatedAt).toBe('number');

    const fetched = store.get('google-sub-1');
    expect(fetched).toEqual(saved);
  });

  test('set() upserts — a second call for the same user overwrites the first', () => {
    store.set('google-sub-2', { paddleColor: '#ffffff', ballColor: '#ffffff', bgColor: '#000000' });
    store.set('google-sub-2', { paddleColor: '#111111', ballColor: '#222222', bgColor: '#333333' });

    const fetched = store.get('google-sub-2');
    expect(fetched.paddleColor).toBe('#111111');
    expect(fetched.ballColor).toBe('#222222');
    expect(fetched.bgColor).toBe('#333333');
  });

  test('preferences are isolated per user', () => {
    store.set('google-sub-a', { paddleColor: '#aaaaaa', ballColor: '#aaaaaa', bgColor: '#aaaaaa' });
    store.set('google-sub-b', { paddleColor: '#bbbbbb', ballColor: '#bbbbbb', bgColor: '#bbbbbb' });

    expect(store.get('google-sub-a').paddleColor).toBe('#aaaaaa');
    expect(store.get('google-sub-b').paddleColor).toBe('#bbbbbb');
  });

  test('independent store instances do not share data', () => {
    const other = createPreferencesStore(':memory:');
    store.set('google-sub-1', { paddleColor: '#ffffff', ballColor: '#ffffff', bgColor: '#000000' });
    expect(other.get('google-sub-1')).toBeNull();
    other.close();
  });
});

// ── GET/PUT /api/preferences (HTTP layer, unauthenticated paths) ────────────
//
// Establishing a real authenticated Google session requires a live OAuth
// round-trip, which (as in auth.test.js) is intentionally out of scope for
// these self-contained unit tests. The guest-fallback and auth-guard
// behavior below is fully exercisable without one; SQLite read/write logic
// itself is covered directly above.

function makeRequest(app, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const http     = require('http');
    const server   = http.createServer(app);
    const bodyJson = body !== null ? JSON.stringify(body) : null;

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const options = {
        host:   '127.0.0.1',
        port,
        method: method.toUpperCase(),
        path:   url,
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': bodyJson ? Buffer.byteLength(bodyJson).toString() : '0',
        },
      };

      const clientReq = http.request(options, (clientRes) => {
        const chunks = [];
        clientRes.on('data', (chunk) => chunks.push(chunk));
        clientRes.on('end', () => {
          server.close();
          const raw = Buffer.concat(chunks).toString();
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
          resolve({ status: clientRes.statusCode, body: parsed });
        });
      });

      clientReq.on('error', (err) => { server.close(); reject(err); });
      if (bodyJson) clientReq.write(bodyJson);
      clientReq.end();
    });
  });
}

function get(app, url)        { return makeRequest(app, 'GET', url); }
function put(app, url, body)  { return makeRequest(app, 'PUT', url, body); }

describe('GET /api/preferences (guest)', () => {
  test('returns { preferences: null } with no session, without touching the DB', async () => {
    const app = createApp(createStore(), createPreferencesStore(':memory:'));
    const res = await get(app, '/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body.preferences).toBeNull();
  });
});

describe('PUT /api/preferences (guest)', () => {
  test('returns 401 without an authenticated session', async () => {
    const app = createApp(createStore(), createPreferencesStore(':memory:'));
    const res = await put(app, '/api/preferences', {
      paddleColor: '#ffffff',
      ballColor:   '#ffffff',
      bgColor:     '#000000',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });
});
