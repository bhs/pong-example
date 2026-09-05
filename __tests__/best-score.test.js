'use strict';

/**
 * __tests__/best-score.test.js
 *
 * Unit tests for the 'personal best badge' additions on top of the
 * high-score-persistence hop: POST /scores, GET /scores/me, and the
 * store.bestScores Map they read/write.
 *
 * Establishing a real authenticated Google session requires an actual OAuth
 * round-trip (network access to Google), which is intentionally out of
 * scope for a self-contained unit test — see __tests__/auth.test.js for the
 * same reasoning applied to /auth/google*. These tests therefore cover:
 *
 *   - the anonymous (401) behaviour of both new routes end-to-end over HTTP,
 *   - the createStore() bestScores Map itself, and
 *   - the pure computeBestScore() decision helper in isolation, which is
 *     exactly the logic the authenticated branch of POST /scores delegates
 *     to once req.user is available.
 */

const { createApp, createStore, computeBestScore } = require('../server');

// ── Minimal HTTP request helper (mirrors __tests__/server.test.js) ────────

function makeRequest(app, method, url, body = null) {
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
function post(app, url, body) { return makeRequest(app, 'POST', url, body); }

// ── POST /scores (anonymous) ─────────────────────────────────────────────

describe('POST /scores without a session', () => {
  test('returns 401 (sign-in required)', async () => {
    const app = createApp(createStore());
    const res = await post(app, '/scores', { score: 42 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('does not touch the store when unauthenticated', async () => {
    const store = createStore();
    const app   = createApp(store);
    await post(app, '/scores', { score: 42 });
    expect(store.bestScores.size).toBe(0);
  });
});

// ── GET /scores/me (anonymous) ───────────────────────────────────────────

describe('GET /scores/me without a session', () => {
  test('returns 401 (sign-in required)', async () => {
    const app = createApp(createStore());
    const res = await get(app, '/scores/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });
});

// ── createStore bestScores map ───────────────────────────────────────────

describe('createStore bestScores map', () => {
  test('store has an empty bestScores Map', () => {
    const s = createStore();
    expect(s.bestScores).toBeInstanceOf(Map);
    expect(s.bestScores.size).toBe(0);
  });

  test('independent stores do not share bestScores', () => {
    const s1 = createStore();
    const s2 = createStore();
    s1.bestScores.set('google-sub-1', { score: 100, updatedAt: Date.now() });
    expect(s2.bestScores.has('google-sub-1')).toBe(false);
  });
});

// ── computeBestScore (pure decision logic) ───────────────────────────────

describe('computeBestScore', () => {
  test('treats a missing entry as a new best', () => {
    const result = computeBestScore(null, 50);
    expect(result).toEqual({ updated: true, best: 50 });
  });

  test('treats undefined the same as null', () => {
    const result = computeBestScore(undefined, 10);
    expect(result).toEqual({ updated: true, best: 10 });
  });

  test('updates when the new score is strictly higher', () => {
    const existing = { score: 100, updatedAt: 1 };
    const result   = computeBestScore(existing, 150);
    expect(result).toEqual({ updated: true, best: 150 });
  });

  test('does NOT update when the new score is lower', () => {
    const existing = { score: 100, updatedAt: 1 };
    const result   = computeBestScore(existing, 50);
    expect(result).toEqual({ updated: false, best: 100 });
  });

  test('does NOT update when the new score equals the existing one', () => {
    const existing = { score: 100, updatedAt: 1 };
    const result   = computeBestScore(existing, 100);
    expect(result).toEqual({ updated: false, best: 100 });
  });

  test('accepts a new best of 0 when there is no existing entry', () => {
    const result = computeBestScore(null, 0);
    expect(result).toEqual({ updated: true, best: 0 });
  });
});
