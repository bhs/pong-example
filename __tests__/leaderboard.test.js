'use strict';

/**
 * __tests__/leaderboard.test.js
 *
 * Unit tests for the top-ten leaderboard panel's backing endpoints:
 *   GET /scores/leaderboard
 *   GET /scores/me
 *
 * as well as the store.scoreEvents append-only log they read from.
 *
 * Authenticated (Google OAuth) request paths aren't exercised here for the
 * same reason __tests__/auth.test.js doesn't drive a real OAuth round-trip:
 * passport-google-oauth20 needs a live exchange with Google, which isn't
 * available in a self-contained unit test. Instead, `store.scoreEvents` is
 * seeded directly (mirroring how __tests__/server.test.js pre-seeds
 * `store.scores`) to exercise the read endpoints, and the write path is
 * covered by asserting that unauthenticated POSTs never populate the log.
 */

const { createApp, createStore } = require('../server');

// ── Minimal HTTP request helper (mirrors __tests__/server.test.js) ────────

function makeRequest(app, method, url, body = null, query = '') {
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
          resolve({ status: clientRes.statusCode, body: parsed });
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

function get(app, url, query = '') { return makeRequest(app, 'GET', url, null, query); }
function post(app, url, body)      { return makeRequest(app, 'POST', url, body); }

// ── createStore scoreEvents ────────────────────────────────────────────────

describe('createStore scoreEvents', () => {
  test('store has a scoreEvents array', () => {
    const s = createStore();
    expect(Array.isArray(s.scoreEvents)).toBe(true);
    expect(s.scoreEvents).toHaveLength(0);
  });

  test('independent stores do not share scoreEvents', () => {
    const s1 = createStore();
    const s2 = createStore();
    s1.scoreEvents.push({ id: '1', userId: 'u1', name: 'Alice', score: 10, createdAt: 0 });
    expect(s2.scoreEvents).toHaveLength(0);
  });
});

// ── GET /scores/leaderboard ────────────────────────────────────────────────

describe('GET /scores/leaderboard', () => {
  let app, store;

  beforeEach(() => {
    store = createStore();
    app   = createApp(store);
  });

  test('returns an empty leaderboard when no events have been recorded', async () => {
    const res = await get(app, '/scores/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
  });

  test('returns events sorted by score descending', async () => {
    store.scoreEvents.push({ id: '1', userId: 'u1', name: 'Alice', score: 50,  createdAt: Date.now() });
    store.scoreEvents.push({ id: '2', userId: 'u2', name: 'Bob',   score: 200, createdAt: Date.now() });
    store.scoreEvents.push({ id: '3', userId: 'u3', name: 'Carol', score: 100, createdAt: Date.now() });

    const res = await get(app, '/scores/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.leaderboard.map((e) => e.score)).toEqual([200, 100, 50]);
  });

  test('caps the leaderboard at 10 entries', async () => {
    for (let i = 0; i < 15; i++) {
      store.scoreEvents.push({ id: String(i), userId: `u${i}`, name: `Player${i}`, score: i, createdAt: Date.now() });
    }

    const res = await get(app, '/scores/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(10);
    expect(res.body.leaderboard[0].score).toBe(14);
    expect(res.body.leaderboard[9].score).toBe(5);
  });

  test('each entry exposes id, userId, name, score and createdAt', async () => {
    store.scoreEvents.push({ id: 'abc', userId: 'u1', name: 'Alice', score: 42, createdAt: 12345 });

    const res = await get(app, '/scores/leaderboard');
    expect(res.body.leaderboard[0]).toEqual({
      id: 'abc', userId: 'u1', name: 'Alice', score: 42, createdAt: 12345,
    });
  });
});

// ── GET /scores/me ─────────────────────────────────────────────────────────

describe('GET /scores/me', () => {
  test('returns { best: null } when there is no session', async () => {
    const app = createApp(createStore());
    const res = await get(app, '/scores/me');
    expect(res.status).toBe(200);
    expect(res.body.best).toBeNull();
  });

  test('returns { best: null } even when store.scoreEvents has entries, if unauthenticated', async () => {
    const store = createStore();
    store.scoreEvents.push({ id: '1', userId: 'u1', name: 'Alice', score: 999, createdAt: Date.now() });
    const app = createApp(store);

    const res = await get(app, '/scores/me');
    expect(res.status).toBe(200);
    expect(res.body.best).toBeNull();
  });
});

// ── POST /api/scores + scoreEvents interplay ───────────────────────────────

describe('POST /api/scores (unauthenticated) does not log a leaderboard event', () => {
  test('store.scoreEvents stays empty for an explicit-player request', async () => {
    const store = createStore();
    const app   = createApp(store);

    const res = await post(app, '/api/scores', { player: 'eve', score: 42 });
    expect(res.status).toBe(200);
    expect(store.scoreEvents).toHaveLength(0);
  });

  test('store.scores (legacy best-per-player map) is still updated as before', async () => {
    const store = createStore();
    const app   = createApp(store);

    await post(app, '/api/scores', { player: 'eve', score: 42 });
    expect(store.scores.has('eve')).toBe(true);
    expect(store.scores.get('eve').score).toBe(42);
  });
});
