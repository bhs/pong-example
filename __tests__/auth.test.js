'use strict';

/**
 * __tests__/auth.test.js
 *
 * Unit tests for the Google OAuth / session endpoints on top of the
 * Prisma/MySQL-backed Express API. Each suite creates its own isolated
 * fake Prisma client (see __tests__/helpers/fakePrisma.js). Google
 * credentials are intentionally left unset in this test run, so
 * /auth/google* endpoints exercise their "not configured" guard rather
 * than performing a real OAuth round-trip (which would require network
 * access to Google and cannot be part of a self-contained unit test).
 */

const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');

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

function get(app, url, headers)  { return makeRequest(app, 'GET', url, null, headers); }
function post(app, url, body)    { return makeRequest(app, 'POST', url, body); }

// ── GET /health ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const app = createApp(createFakePrisma());
    const res = await get(app, '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── GET /me ──────────────────────────────────────────────────────────────────

describe('GET /me', () => {
  test('returns { user: null } when there is no session', async () => {
    const app = createApp(createFakePrisma());
    const res = await get(app, '/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  test('returns bestRallyBucket: false when signed out', async () => {
    const app = createApp(createFakePrisma());
    const res = await get(app, '/me');
    expect(res.body.bestRallyBucket).toBe(false);
  });

  test('returns the logged-in user via the testAuth seam', async () => {
    const user = { id: 'google-sub-1', email: 'a@example.com', name: 'A', avatar: null };
    const app  = createApp(createFakePrisma(), {
      testAuth: (req, res, next) => { req.user = user; req.isAuthenticated = () => true; next(); },
    });
    const res = await get(app, '/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ ...user, nickname: null });
  });

  test('bestRallyBucket is a boolean, deterministic for the same signed-in user id', async () => {
    const user = { id: 'google-sub-deterministic', email: 'a@example.com', name: 'A', avatar: null };
    const app  = createApp(createFakePrisma(), {
      testAuth: (req, res, next) => { req.user = user; req.isAuthenticated = () => true; next(); },
    });
    const first  = await get(app, '/me');
    const second = await get(app, '/me');
    expect(typeof first.body.bestRallyBucket).toBe('boolean');
    expect(second.body.bestRallyBucket).toBe(first.body.bestRallyBucket);
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
    const app = createApp(createFakePrisma());
    const res = await get(app, '/auth/google');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});

// ── GET /auth/google — redirect_uri honours X-Forwarded-Proto ───────────────
//
// Regression test for "Error 400: redirect_uri_mismatch": when the app runs
// behind a TLS-terminating proxy (e.g. Fly.io), Express must trust the
// proxy's X-Forwarded-Proto / X-Forwarded-Host headers so the redirect_uri
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
    const app = createApp(createFakePrisma());
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
    const app = createApp(createFakePrisma());
    const res = await get(app, '/auth/google/callback');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});

// ── GET /auth/logout ─────────────────────────────────────────────────────────

describe('GET /auth/logout', () => {
  test('redirects to / even without an active session', async () => {
    const app = createApp(createFakePrisma());
    const res = await get(app, '/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

// ── POST /api/scores (unauthenticated) ──────────────────────────────────────

describe('POST /api/scores without a Google session', () => {
  test('requires an authenticated session (no anonymous high scores)', async () => {
    const app = createApp(createFakePrisma());
    const res = await post(app, '/api/scores', { score: 42 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });
});

// ── User upsert semantics (via the fake Prisma client) ──────────────────────

describe('Google user upsert', () => {
  test('fake Prisma keeps independent user maps per instance', () => {
    const p1 = createFakePrisma();
    const p2 = createFakePrisma();
    p1.__users.set('google-sub-1', { id: 'google-sub-1', email: 'a@example.com' });
    expect(p2.__users.has('google-sub-1')).toBe(false);
  });
});
