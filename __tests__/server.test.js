'use strict';

/**
 * __tests__/server.test.js
 *
 * Unit tests for the Express API endpoints.
 * Each test suite creates its own isolated store so tests don't share state.
 */

const { createApp, createStore } = require('../server');

// ── Minimal HTTP request helper ────────────────────────────────────────────
//
// We drive the Express app directly via its `handle` method rather than
// opening a real TCP port, keeping tests fast and self-contained.

function makeRequest(app, method, url, { body = null, query = '', cookies = '' } = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl  = url + (query ? `?${query}` : '');
    const bodyJson = body !== null ? JSON.stringify(body) : null;

    const http   = require('http');
    const server = http.createServer(app);

    const options = {
      host:   '127.0.0.1',
      port:   0,
      method: method.toUpperCase(),
      path:   fullUrl,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyJson ? Buffer.byteLength(bodyJson).toString() : '0',
        ...(cookies ? { Cookie: cookies } : {}),
      },
    };

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      options.port = port;

      const clientReq = http.request(options, (clientRes) => {
        const data = [];
        clientRes.on('data', (chunk) => data.push(chunk));
        clientRes.on('end', () => {
          server.close();
          const raw  = Buffer.concat(data).toString();
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
          resolve({ status: clientRes.statusCode, body: parsed, headers: clientRes.headers });
        });
      });

      clientReq.on('error', (err) => { server.close(); reject(err); });

      if (bodyJson) {
        clientReq.write(bodyJson);
      }
      clientReq.end();
    });
  });
}

// Convenience wrappers
function post(app, url, body, opts)         { return makeRequest(app, 'POST',   url, { body, ...opts }); }
function get(app, url, query, opts)         { return makeRequest(app, 'GET',    url, { query, ...opts }); }
function del(app, url, opts)                { return makeRequest(app, 'DELETE', url, opts || {}); }

/**
 * Extract a Set-Cookie value from response headers.
 */
function extractCookie(headers, name) {
  const sc = headers['set-cookie'];
  if (!sc) return null;
  const arr = Array.isArray(sc) ? sc : [sc];
  const found = arr.find((c) => c.startsWith(name + '='));
  return found ? found.split(';')[0] : null;
}

// ── POST /api/register ─────────────────────────────────────────────────────

describe('POST /api/register', () => {
  let app;

  beforeEach(() => {
    app = createApp(createStore());
  });

  test('returns 201 with user object for valid credentials', async () => {
    const res = await post(app, '/api/register', { email: 'alice@example.com', password: 'secret' });
    expect(res.status).toBe(201);
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.email).toBe('alice@example.com');
    expect(typeof res.body.user.id).toBe('string');
  });

  test('normalises email to lowercase', async () => {
    const res = await post(app, '/api/register', { email: 'BOB@EXAMPLE.COM', password: 'pw' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('bob@example.com');
  });

  test('sets an HttpOnly cookie on success', async () => {
    const res = await post(app, '/api/register', { email: 'c@d.com', password: 'pw' });
    const sc  = res.headers['set-cookie'];
    expect(sc).toBeTruthy();
    const str = Array.isArray(sc) ? sc.join('; ') : sc;
    expect(str.toLowerCase()).toMatch(/httponly/);
    expect(str).toMatch(/pong_sid/);
  });

  test('returns 409 when email already registered', async () => {
    await post(app, '/api/register', { email: 'dup@e.com', password: 'first' });
    const res = await post(app, '/api/register', { email: 'dup@e.com', password: 'second' });
    expect(res.status).toBe(409);
  });

  test('returns 400 when email is missing', async () => {
    const res = await post(app, '/api/register', { password: 'pw' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when password is missing', async () => {
    const res = await post(app, '/api/register', { email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when email is empty string', async () => {
    const res = await post(app, '/api/register', { email: '', password: 'x' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/login ────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  let app;

  beforeEach(async () => {
    app = createApp(createStore());
    // Pre-register a user
    await post(app, '/api/register', { email: 'alice@example.com', password: 'mypassword' });
  });

  test('returns 200 with user object for correct credentials', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com', password: 'mypassword' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@example.com');
    expect(typeof res.body.user.id).toBe('string');
  });

  test('sets an HttpOnly session cookie on success', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com', password: 'mypassword' });
    const sc  = res.headers['set-cookie'];
    expect(sc).toBeTruthy();
    const str = Array.isArray(sc) ? sc.join('; ') : sc;
    expect(str.toLowerCase()).toMatch(/httponly/);
  });

  test('is case-insensitive for email', async () => {
    const res = await post(app, '/api/login', { email: 'ALICE@EXAMPLE.COM', password: 'mypassword' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@example.com');
  });

  test('returns 401 for wrong password', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 401 for unknown email', async () => {
    const res = await post(app, '/api/login', { email: 'nobody@x.com', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('returns 400 when email is missing', async () => {
    const res = await post(app, '/api/login', { password: 'x' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when password is missing', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when email is empty string', async () => {
    const res = await post(app, '/api/login', { email: '', password: 'x' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/me ────────────────────────────────────────────────────────────

describe('GET /api/me', () => {
  let app;

  beforeEach(() => { app = createApp(createStore()); });

  test('returns 401 when no cookie is sent', async () => {
    const res = await get(app, '/api/me');
    expect(res.status).toBe(401);
  });

  test('returns 200 and user when valid session cookie is present', async () => {
    const regRes = await post(app, '/api/register', { email: 'me@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');
    expect(cookie).toBeTruthy();

    const res = await get(app, '/api/me', '', { cookies: cookie });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@x.com');
  });

  test('returns 401 for invalid session id', async () => {
    const res = await get(app, '/api/me', '', { cookies: 'pong_sid=not-a-real-session' });
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/session ────────────────────────────────────────────────────

describe('DELETE /api/session', () => {
  let app;

  beforeEach(() => { app = createApp(createStore()); });

  test('returns 200 even without a cookie', async () => {
    const res = await del(app, '/api/session');
    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
  });

  test('invalidates session so subsequent GET /me returns 401', async () => {
    const regRes = await post(app, '/api/register', { email: 'out@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    await del(app, '/api/session', { cookies: cookie });

    const res = await get(app, '/api/me', '', { cookies: cookie });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/scores ────────────────────────────────────────────────────────

describe('GET /api/scores', () => {
  let app, store;

  beforeEach(() => {
    store = createStore();
    app   = createApp(store);
  });

  test('returns empty scores array when store is empty', async () => {
    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toEqual([]);
  });

  test('returns all scores when store has entries', async () => {
    store.scores.set('alice@x.com', { player: 'alice@x.com', score: 100, updatedAt: Date.now() });
    store.scores.set('bob@x.com',   { player: 'bob@x.com',   score: 200, updatedAt: Date.now() });

    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(2);
  });

  test('returns scores sorted by score descending', async () => {
    store.scores.set('a@x.com', { player: 'a@x.com', score: 50,  updatedAt: Date.now() });
    store.scores.set('b@x.com', { player: 'b@x.com', score: 200, updatedAt: Date.now() });
    store.scores.set('c@x.com', { player: 'c@x.com', score: 100, updatedAt: Date.now() });

    const res = await get(app, '/api/scores');
    const scores = res.body.scores.map((e) => e.score);
    expect(scores).toEqual([200, 100, 50]);
  });

  test('respects the ?limit query parameter', async () => {
    for (let i = 0; i < 10; i++) {
      store.scores.set(`p${i}@x.com`, { player: `p${i}@x.com`, score: i * 10, updatedAt: Date.now() });
    }

    const res = await get(app, '/api/scores', 'limit=3');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(3);
  });

  test('caps limit at 100', async () => {
    for (let i = 0; i < 5; i++) {
      store.scores.set(`p${i}@x.com`, { player: `p${i}@x.com`, score: i, updatedAt: Date.now() });
    }

    const res = await get(app, '/api/scores', 'limit=200');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(5);
  });
});

// ── POST /api/scores (auth-gated) ─────────────────────────────────────────

describe('POST /api/scores', () => {
  let app, store;

  beforeEach(() => {
    store = createStore();
    app   = createApp(store);
  });

  test('returns 401 when no session cookie is provided', async () => {
    const res = await post(app, '/api/scores', { score: 100 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('creates a new score entry and returns updated:true when authenticated', async () => {
    const regRes = await post(app, '/api/register', { email: 'scorer@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: 150 }, { cookies: cookie });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.player).toBe('scorer@x.com');
    expect(res.body.entry.score).toBe(150);
  });

  test('stores the score in the Map keyed by email', async () => {
    const regRes = await post(app, '/api/register', { email: 'store@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    await post(app, '/api/scores', { score: 99 }, { cookies: cookie });
    expect(store.scores.has('store@x.com')).toBe(true);
    expect(store.scores.get('store@x.com').score).toBe(99);
  });

  test('updates the score when new score is higher', async () => {
    const regRes = await post(app, '/api/register', { email: 'up@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    await post(app, '/api/scores', { score: 50 }, { cookies: cookie });
    const res = await post(app, '/api/scores', { score: 150 }, { cookies: cookie });
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.score).toBe(150);
  });

  test('does NOT update when new score is lower', async () => {
    const regRes = await post(app, '/api/register', { email: 'down@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    await post(app, '/api/scores', { score: 200 }, { cookies: cookie });
    const res = await post(app, '/api/scores', { score: 50 }, { cookies: cookie });
    expect(res.body.updated).toBe(false);
    expect(res.body.entry.score).toBe(200);
  });

  test('does NOT update when new score equals existing score', async () => {
    const regRes = await post(app, '/api/register', { email: 'eq@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    await post(app, '/api/scores', { score: 100 }, { cookies: cookie });
    const res = await post(app, '/api/scores', { score: 100 }, { cookies: cookie });
    expect(res.body.updated).toBe(false);
  });

  test('returns 400 when score is missing', async () => {
    const regRes = await post(app, '/api/register', { email: 'miss@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', {}, { cookies: cookie });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when score is a string', async () => {
    const regRes = await post(app, '/api/register', { email: 'str@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: 'high' }, { cookies: cookie });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is negative', async () => {
    const regRes = await post(app, '/api/register', { email: 'neg@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: -1 }, { cookies: cookie });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is Infinity', async () => {
    const regRes = await post(app, '/api/register', { email: 'inf@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: Infinity }, { cookies: cookie });
    expect(res.status).toBe(400);
  });

  test('accepts score of 0', async () => {
    const regRes = await post(app, '/api/register', { email: 'zero@x.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: 0 }, { cookies: cookie });
    expect(res.status).toBe(200);
    expect(res.body.entry.score).toBe(0);
  });
});

// ── GET /api/scores/:player ────────────────────────────────────────────────

describe('GET /api/scores/:player', () => {
  let app, store;

  beforeEach(() => {
    store = createStore();
    app   = createApp(store);
  });

  test('returns the entry for a known player', async () => {
    store.scores.set('alice@x.com', { player: 'alice@x.com', score: 300, updatedAt: Date.now() });
    const res = await get(app, '/api/scores/alice@x.com');
    expect(res.status).toBe(200);
    expect(res.body.entry.player).toBe('alice@x.com');
    expect(res.body.entry.score).toBe(300);
  });

  test('returns 404 for an unknown player', async () => {
    const res = await get(app, '/api/scores/nobody@x.com');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

// ── DELETE /api/scores/:player ─────────────────────────────────────────────

describe('DELETE /api/scores/:player', () => {
  let app, store;

  beforeEach(() => {
    store = createStore();
    app   = createApp(store);
  });

  test('deletes an existing entry and returns deleted:true', async () => {
    store.scores.set('alice@x.com', { player: 'alice@x.com', score: 100, updatedAt: Date.now() });
    const res = await del(app, '/api/scores/alice@x.com');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.player).toBe('alice@x.com');
  });

  test('removes the entry from the Map', async () => {
    store.scores.set('alice@x.com', { player: 'alice@x.com', score: 100, updatedAt: Date.now() });
    await del(app, '/api/scores/alice@x.com');
    expect(store.scores.has('alice@x.com')).toBe(false);
  });

  test('returns 404 when player does not exist', async () => {
    const res = await del(app, '/api/scores/nobody@x.com');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

// ── createStore isolation ──────────────────────────────────────────────────

describe('createStore', () => {
  test('creates independent store instances', () => {
    const s1 = createStore();
    const s2 = createStore();
    s1.scores.set('alice@x.com', { player: 'alice@x.com', score: 1, updatedAt: 0 });
    expect(s2.scores.has('alice@x.com')).toBe(false);
  });

  test('store has users, sessions and scores Maps', () => {
    const s = createStore();
    expect(s.users).toBeInstanceOf(Map);
    expect(s.sessions).toBeInstanceOf(Map);
    expect(s.scores).toBeInstanceOf(Map);
  });

  test('all Maps start empty', () => {
    const s = createStore();
    expect(s.users.size).toBe(0);
    expect(s.sessions.size).toBe(0);
    expect(s.scores.size).toBe(0);
  });
});
