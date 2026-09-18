'use strict';

/**
 * __tests__/auth.test.js
 *
 * Unit tests for the Google OAuth / session endpoints, backed by the
 * in-memory fake of db/queries.js (see __tests__/helpers/fakeQueries.js)
 * so no real MySQL connection is required. Google credentials are
 * intentionally left unset in this test run, so /auth/google* endpoints
 * exercise their "not configured" guard rather than performing a real
 * OAuth round-trip (which would require network access to Google and
 * cannot be part of a self-contained unit test).
 */

const { createApp } = require('../server');
const { createFakeQueries } = require('./helpers/fakeQueries');

// ── Minimal HTTP request helper (mirrors __tests__/server.test.js) ────────

function makeRequest(app, method, url, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyJson = body !== null ? JSON.stringify(body) : null;
    const http     = require('http');
    const server   = http.createServer(app);

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
          ...extraHeaders,
        },
      };

      const clientReq = require('http').request(options, (clientRes) => {
        const chunks = [];
        clientRes.on('data', (chunk) => chunks.push(chunk));
        clientRes.on('end', () => {
          server.close();
          const raw = Buffer.concat(chunks).toString();
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
          resolve({ status: clientRes.statusCode, headers: clientRes.headers, body: parsed });
        });
      });

      clientReq.on('error', (err) => { server.close(); reject(err); });

      if (bodyJson) clientReq.write(bodyJson);
      clientReq.end();
    });
  });
}

function get(app, url, headers)         { return makeRequest(app, 'GET', url, null, headers); }
function post(app, url, body)  { return makeRequest(app, 'POST', url, body); }

// ── GET /health ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── GET /me ──────────────────────────────────────────────────────────────────

describe('GET /me', () => {
  test('returns { user: null } when there is no session', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

// ── GET /auth/google ─────────────────────────────────────────────────────────

describe('GET /auth/google', () => {
  const originalId     = process.env.GOOGLE_CLIENT_ID;
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterAll(() => {
    if (originalId) process.env.GOOGLE_CLIENT_ID = originalId;
    if (originalSecret) process.env.GOOGLE_CLIENT_SECRET = originalSecret;
  });

  test('returns 503 when Google OAuth credentials are not configured', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/auth/google');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});

// ── GET /auth/google — redirect_uri honours X-Forwarded-Proto ───────────────
//
// Regression test for "Error 400: redirect_uri_mismatch": when the app runs
// behind a TLS-terminating proxy, Express must trust the proxy's
// X-Forwarded-Proto / X-Forwarded-Host headers so the redirect_uri
// passport sends to Google is "https://…" (matching what's registered in
// Google Cloud Console) instead of silently downgrading to "http://…".

describe('GET /auth/google behind a TLS-terminating proxy', () => {
  const originalId     = process.env.GOOGLE_CLIENT_ID;
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalUrl     = process.env.GOOGLE_CALLBACK_URL;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID     = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    delete process.env.GOOGLE_CALLBACK_URL;
  });

  afterAll(() => {
    if (originalId) process.env.GOOGLE_CLIENT_ID = originalId; else delete process.env.GOOGLE_CLIENT_ID;
    if (originalSecret) process.env.GOOGLE_CLIENT_SECRET = originalSecret; else delete process.env.GOOGLE_CLIENT_SECRET;
    if (originalUrl) process.env.GOOGLE_CALLBACK_URL = originalUrl; else delete process.env.GOOGLE_CALLBACK_URL;
  });

  test('builds an https:// redirect_uri when X-Forwarded-Proto is https', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/auth/google', {
      Host:               'pong-game-0e30d7df.fly.dev',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host':  'pong-game-0e30d7df.fly.dev',
    });

    expect(res.status).toBe(302);
    const location = res.headers.location || '';
    const redirectUriMatch = decodeURIComponent(location).match(/redirect_uri=([^&]+)/);
    expect(redirectUriMatch).toBeTruthy();
    expect(redirectUriMatch[1]).toBe('https://pong-game-0e30d7df.fly.dev/auth/google/callback');
  });
});

// ── GET /auth/google/callback ────────────────────────────────────────────────

describe('GET /auth/google/callback', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  test('returns 503 when Google OAuth credentials are not configured', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/auth/google/callback');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});

// ── GET /auth/logout ─────────────────────────────────────────────────────────

describe('GET /auth/logout', () => {
  test('redirects to / even without an active session', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

// ── POST /api/scores (unauthenticated fallback) ─────────────────────────────

describe('POST /api/scores without a Google session', () => {
  test('still requires an explicit player when not logged in', async () => {
    const app = createApp(createFakeQueries());
    const res = await post(app, '/api/scores', { score: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('accepts an explicit player as before (backward compatible)', async () => {
    const app = createApp(createFakeQueries());
    const res = await post(app, '/api/scores', { player: 'eve', score: 42 });
    expect(res.status).toBe(200);
    expect(res.body.entry.player).toBe('eve');
  });
});

// ── GET / POST /api/preferences (require authentication) ────────────────────

describe('GET /api/preferences/:key without a session', () => {
  test('returns 401 when not logged in', async () => {
    const app = createApp(createFakeQueries());
    const res = await get(app, '/api/preferences/theme');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });
});

describe('POST /api/preferences without a session', () => {
  test('returns 401 when not logged in', async () => {
    const app = createApp(createFakeQueries());
    const res = await post(app, '/api/preferences', { key: 'theme', value: 'dark' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });
});

// ── db/queries.js find-or-create semantics (via the fake) ───────────────────

describe('findOrCreateUserByGoogleId (fake queries)', () => {
  test('creates a user on first sign-in, keyed by Google sub id', async () => {
    const queries = createFakeQueries();
    const user = await queries.findOrCreateUserByGoogleId({
      googleId: 'google-sub-1',
      email:    'a@example.com',
      name:     'Alice',
      avatar:   'https://example.com/a.png',
    });

    expect(user.google_id).toBe('google-sub-1');
    expect(user.email).toBe('a@example.com');
    expect(user).not.toHaveProperty('password');
  });

  test('finds the same user on a repeat sign-in instead of creating a new one', async () => {
    const queries = createFakeQueries();
    const first  = await queries.findOrCreateUserByGoogleId({ googleId: 'google-sub-1', email: 'a@example.com' });
    const second = await queries.findOrCreateUserByGoogleId({ googleId: 'google-sub-1', email: 'a@example.com' });
    expect(second.id).toBe(first.id);
  });

  test('independent fakes do not share users', async () => {
    const q1 = createFakeQueries();
    const q2 = createFakeQueries();
    await q1.findOrCreateUserByGoogleId({ googleId: 'google-sub-1', email: 'a@example.com' });
    expect(await q2.getUserById(1)).toBeNull();
  });
});
