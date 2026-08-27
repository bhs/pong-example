'use strict';

/**
 * __tests__/auth.test.js
 *
 * Unit tests for the server-session-cookie auth endpoints:
 *   POST   /api/register
 *   POST   /api/login
 *   GET    /api/me
 *   DELETE /api/session
 *   POST   /api/scores  (auth-gated)
 */

const http = require('http');
const { createApp, createStore } = require('../server');

// ── Minimal HTTP request helper ────────────────────────────────────────────

function makeRequest(app, method, url, { body = null, cookies = '' } = {}) {
  return new Promise((resolve, reject) => {
    const bodyJson = body !== null ? JSON.stringify(body) : null;
    const server   = http.createServer(app);

    const options = {
      host:   '127.0.0.1',
      port:   0,
      method: method.toUpperCase(),
      path:   url,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyJson ? Buffer.byteLength(bodyJson).toString() : '0',
        ...(cookies ? { Cookie: cookies } : {}),
      },
    };

    server.listen(0, '127.0.0.1', () => {
      options.port = server.address().port;

      const clientReq = http.request(options, (clientRes) => {
        const chunks = [];
        clientRes.on('data', (c) => chunks.push(c));
        clientRes.on('end', () => {
          server.close();
          const raw = Buffer.concat(chunks).toString();
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
          resolve({
            status:  clientRes.statusCode,
            body:    parsed,
            headers: clientRes.headers,
          });
        });
      });

      clientReq.on('error', (err) => { server.close(); reject(err); });
      if (bodyJson) clientReq.write(bodyJson);
      clientReq.end();
    });
  });
}

// Convenience helpers
const post   = (app, url, body, opts)    => makeRequest(app, 'POST',   url, { body, ...opts });
const get    = (app, url, opts)          => makeRequest(app, 'GET',    url, opts || {});
const del    = (app, url, opts)          => makeRequest(app, 'DELETE', url, opts || {});

/**
 * Extract Set-Cookie value matching the cookie name prefix.
 */
function extractCookie(headers, name) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const found = arr.find((c) => c.startsWith(name + '='));
  if (!found) return null;
  // Return just the name=value pair (strip attributes)
  return found.split(';')[0];
}

// ── POST /api/register ─────────────────────────────────────────────────────

describe('POST /api/register', () => {
  let app;

  beforeEach(() => { app = createApp(createStore()); });

  test('returns 201 with user object for valid credentials', async () => {
    const res = await post(app, '/api/register', { email: 'alice@example.com', password: 'secret' });
    expect(res.status).toBe(201);
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.email).toBe('alice@example.com');
    expect(typeof res.body.user.id).toBe('string');
  });

  test('normalises email to lowercase', async () => {
    const res = await post(app, '/api/register', { email: 'Bob@Example.COM', password: 'pass' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('bob@example.com');
  });

  test('sets an HttpOnly Set-Cookie header on success', async () => {
    const res = await post(app, '/api/register', { email: 'carol@example.com', password: 'x' });
    const sc  = res.headers['set-cookie'];
    expect(sc).toBeTruthy();
    const cookieStr = Array.isArray(sc) ? sc.join('; ') : sc;
    expect(cookieStr.toLowerCase()).toMatch(/httponly/);
    expect(cookieStr).toMatch(/pong_sid/);
  });

  test('does not expose password hash in response', async () => {
    const res = await post(app, '/api/register', { email: 'd@e.com', password: 'pass' });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash/);
  });

  test('returns 409 when email already registered', async () => {
    await post(app, '/api/register', { email: 'dup@example.com', password: 'first' });
    const res = await post(app, '/api/register', { email: 'dup@example.com', password: 'second' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when email is missing', async () => {
    const res = await post(app, '/api/register', { password: 'x' });
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
  let app, store;

  beforeEach(async () => {
    store = createStore();
    app   = createApp(store);
    // Pre-register a user
    await post(app, '/api/register', { email: 'alice@example.com', password: 'mypassword' });
  });

  test('returns 200 with user object for correct credentials', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com', password: 'mypassword' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@example.com');
  });

  test('sets an HttpOnly session cookie on success', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com', password: 'mypassword' });
    const sc  = res.headers['set-cookie'];
    expect(sc).toBeTruthy();
    const cookieStr = Array.isArray(sc) ? sc.join('; ') : sc;
    expect(cookieStr.toLowerCase()).toMatch(/httponly/);
  });

  test('returns 401 for wrong password', async () => {
    const res = await post(app, '/api/login', { email: 'alice@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 401 for unknown email', async () => {
    const res = await post(app, '/api/login', { email: 'nobody@example.com', password: 'x' });
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

  test('is case-insensitive for email', async () => {
    const res = await post(app, '/api/login', { email: 'ALICE@EXAMPLE.COM', password: 'mypassword' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@example.com');
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

  test('returns 401 for an invalid/unknown session id', async () => {
    const res = await get(app, '/api/me', { cookies: 'pong_sid=invalid-uuid-here' });
    expect(res.status).toBe(401);
  });

  test('returns 200 and user object when session cookie is valid', async () => {
    // Register to get the cookie
    const regRes = await post(app, '/api/register', { email: 'me@example.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');
    expect(cookie).toBeTruthy();

    const res = await get(app, '/api/me', { cookies: cookie });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@example.com');
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

  test('invalidates the session so GET /me returns 401 afterwards', async () => {
    // Register
    const regRes = await post(app, '/api/register', { email: 'logout@example.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    // Verify we're logged in
    const meRes1 = await get(app, '/api/me', { cookies: cookie });
    expect(meRes1.status).toBe(200);

    // Logout
    await del(app, '/api/session', { cookies: cookie });

    // Session should now be invalid
    const meRes2 = await get(app, '/api/me', { cookies: cookie });
    expect(meRes2.status).toBe(401);
  });

  test('clears the cookie (Set-Cookie header clears pong_sid)', async () => {
    const regRes = await post(app, '/api/register', { email: 'clr@example.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const delRes = await del(app, '/api/session', { cookies: cookie });
    const sc = delRes.headers['set-cookie'];
    // The cleared cookie should be set with an empty value or Max-Age=0
    const cookieStr = sc ? (Array.isArray(sc) ? sc.join('; ') : sc) : '';
    expect(cookieStr).toMatch(/pong_sid/);
  });
});

// ── POST /api/scores with auth ─────────────────────────────────────────────

describe('POST /api/scores (auth-gated)', () => {
  let app, store;

  beforeEach(async () => {
    store = createStore();
    app   = createApp(store);
  });

  test('returns 401 when no session cookie is provided', async () => {
    const res = await post(app, '/api/scores', { score: 100 });
    expect(res.status).toBe(401);
  });

  test('stores score keyed by session email on success', async () => {
    const regRes = await post(app, '/api/register', { email: 'scorer@example.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: 250 }, { cookies: cookie });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.score).toBe(250);
    expect(res.body.entry.player).toBe('scorer@example.com');
  });

  test('does not update when new score is lower', async () => {
    const regRes = await post(app, '/api/register', { email: 'best@example.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    await post(app, '/api/scores', { score: 500 }, { cookies: cookie });
    const res = await post(app, '/api/scores', { score: 100 }, { cookies: cookie });
    expect(res.body.updated).toBe(false);
    expect(res.body.entry.score).toBe(500);
  });

  test('returns 400 for invalid score', async () => {
    const regRes = await post(app, '/api/register', { email: 'bad@example.com', password: 'pw' });
    const cookie = extractCookie(regRes.headers, 'pong_sid');

    const res = await post(app, '/api/scores', { score: -1 }, { cookies: cookie });
    expect(res.status).toBe(400);
  });
});

// ── createStore isolation ──────────────────────────────────────────────────

describe('createStore (auth fields)', () => {
  test('has a users Map', () => {
    const s = createStore();
    expect(s.users).toBeInstanceOf(Map);
  });

  test('users and sessions start empty', () => {
    const s = createStore();
    expect(s.users.size).toBe(0);
    expect(s.sessions.size).toBe(0);
  });

  test('creates independent instances', () => {
    const s1 = createStore();
    const s2 = createStore();
    s1.users.set('a@b.com', { id: '1' });
    expect(s2.users.has('a@b.com')).toBe(false);
  });
});
