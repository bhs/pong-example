'use strict';

/**
 * __tests__/server.test.js
 *
 * Unit tests for the ephemeral-local-storage Express API.
 * Each test suite creates its own isolated store so tests don't share state.
 */

const { createApp, createStore } = require('../server');

// ── Minimal HTTP request helper ────────────────────────────────────────────
//
// We drive the Express app directly via its `handle` method rather than
// opening a real TCP port, keeping tests fast and self-contained.

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

// Convenience wrappers
function post(app, url, body)         { return makeRequest(app, 'POST',   url, body); }
function get(app, url, query = '')    { return makeRequest(app, 'GET',    url, null, query); }
function del(app, url)                { return makeRequest(app, 'DELETE', url); }

// ── POST /api/login ────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  let app;

  beforeEach(() => {
    app = createApp(createStore());
  });

  test('returns 200 with token and username for valid username', async () => {
    const res = await post(app, '/api/login', { username: 'Alice' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.username).toBe('alice');  // lowercased
  });

  test('lowercases the username', async () => {
    const res = await post(app, '/api/login', { username: 'BOB' });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('bob');
  });

  test('trims whitespace from username', async () => {
    const res = await post(app, '/api/login', { username: '  carol  ' });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('carol');
  });

  test('returns a different token each call', async () => {
    const res1 = await post(app, '/api/login', { username: 'dave' });
    const res2 = await post(app, '/api/login', { username: 'dave' });
    expect(res1.body.token).not.toBe(res2.body.token);
  });

  test('returns 400 when username is missing', async () => {
    const res = await post(app, '/api/login', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when username is an empty string', async () => {
    const res = await post(app, '/api/login', { username: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when username is whitespace-only', async () => {
    const res = await post(app, '/api/login', { username: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when username is not a string', async () => {
    const res = await post(app, '/api/login', { username: 42 });
    expect(res.status).toBe(400);
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
    store.scores.set('alice', { player: 'alice', score: 100, updatedAt: Date.now() });
    store.scores.set('bob',   { player: 'bob',   score: 200, updatedAt: Date.now() });

    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(2);
  });

  test('returns scores sorted by score descending', async () => {
    store.scores.set('alice', { player: 'alice', score: 50,  updatedAt: Date.now() });
    store.scores.set('bob',   { player: 'bob',   score: 200, updatedAt: Date.now() });
    store.scores.set('carol', { player: 'carol', score: 100, updatedAt: Date.now() });

    const res = await get(app, '/api/scores');
    const scores = res.body.scores.map((e) => e.score);
    expect(scores).toEqual([200, 100, 50]);
  });

  test('respects the ?limit query parameter', async () => {
    for (let i = 0; i < 10; i++) {
      store.scores.set(`player${i}`, { player: `player${i}`, score: i * 10, updatedAt: Date.now() });
    }

    const res = await get(app, '/api/scores', 'limit=3');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(3);
  });

  test('caps limit at 100', async () => {
    // Populate 5 entries; limit=200 → capped at 100, returns all 5
    for (let i = 0; i < 5; i++) {
      store.scores.set(`p${i}`, { player: `p${i}`, score: i, updatedAt: Date.now() });
    }

    const res = await get(app, '/api/scores', 'limit=200');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(5);
  });
});

// ── POST /api/scores ───────────────────────────────────────────────────────

describe('POST /api/scores', () => {
  let app, store;

  beforeEach(() => {
    store = createStore();
    app   = createApp(store);
  });

  test('creates a new score entry and returns updated:true', async () => {
    const res = await post(app, '/api/scores', { player: 'Alice', score: 150 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.player).toBe('alice');
    expect(res.body.entry.score).toBe(150);
  });

  test('stores the score in the Map', async () => {
    await post(app, '/api/scores', { player: 'alice', score: 99 });
    expect(store.scores.has('alice')).toBe(true);
    expect(store.scores.get('alice').score).toBe(99);
  });

  test('updates the score when new score is higher', async () => {
    await post(app, '/api/scores', { player: 'alice', score: 50 });
    const res = await post(app, '/api/scores', { player: 'alice', score: 150 });
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.score).toBe(150);
  });

  test('does NOT update when new score is lower', async () => {
    await post(app, '/api/scores', { player: 'alice', score: 200 });
    const res = await post(app, '/api/scores', { player: 'alice', score: 50 });
    expect(res.body.updated).toBe(false);
    expect(res.body.entry.score).toBe(200);
  });

  test('does NOT update when new score equals existing score', async () => {
    await post(app, '/api/scores', { player: 'alice', score: 100 });
    const res = await post(app, '/api/scores', { player: 'alice', score: 100 });
    expect(res.body.updated).toBe(false);
  });

  test('lowercases and trims player name', async () => {
    await post(app, '/api/scores', { player: '  BOB  ', score: 77 });
    expect(store.scores.has('bob')).toBe(true);
  });

  test('returns 400 when player is missing', async () => {
    const res = await post(app, '/api/scores', { score: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when player is an empty string', async () => {
    const res = await post(app, '/api/scores', { player: '', score: 100 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is missing', async () => {
    const res = await post(app, '/api/scores', { player: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when score is a string', async () => {
    const res = await post(app, '/api/scores', { player: 'alice', score: 'high' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is negative', async () => {
    const res = await post(app, '/api/scores', { player: 'alice', score: -1 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is Infinity', async () => {
    const res = await post(app, '/api/scores', { player: 'alice', score: Infinity });
    expect(res.status).toBe(400);
  });

  test('accepts score of 0', async () => {
    const res = await post(app, '/api/scores', { player: 'alice', score: 0 });
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
    store.scores.set('alice', { player: 'alice', score: 300, updatedAt: Date.now() });
    const res = await get(app, '/api/scores/alice');
    expect(res.status).toBe(200);
    expect(res.body.entry.player).toBe('alice');
    expect(res.body.entry.score).toBe(300);
  });

  test('is case-insensitive (player name is lowercased)', async () => {
    store.scores.set('alice', { player: 'alice', score: 300, updatedAt: Date.now() });
    const res = await get(app, '/api/scores/ALICE');
    expect(res.status).toBe(200);
    expect(res.body.entry.player).toBe('alice');
  });

  test('returns 404 for an unknown player', async () => {
    const res = await get(app, '/api/scores/nobody');
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
    store.scores.set('alice', { player: 'alice', score: 100, updatedAt: Date.now() });
    const res = await del(app, '/api/scores/alice');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.player).toBe('alice');
  });

  test('removes the entry from the Map', async () => {
    store.scores.set('alice', { player: 'alice', score: 100, updatedAt: Date.now() });
    await del(app, '/api/scores/alice');
    expect(store.scores.has('alice')).toBe(false);
  });

  test('returns 404 when player does not exist', async () => {
    const res = await del(app, '/api/scores/nobody');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  test('is case-insensitive', async () => {
    store.scores.set('bob', { player: 'bob', score: 50, updatedAt: Date.now() });
    const res = await del(app, '/api/scores/BOB');
    expect(res.status).toBe(200);
    expect(store.scores.has('bob')).toBe(false);
  });
});

// ── createStore isolation ──────────────────────────────────────────────────

describe('createStore', () => {
  test('creates independent store instances', () => {
    const s1 = createStore();
    const s2 = createStore();
    s1.scores.set('alice', { player: 'alice', score: 1, updatedAt: 0 });
    expect(s2.scores.has('alice')).toBe(false);
  });

  test('store has sessions and scores Maps', () => {
    const s = createStore();
    expect(s.sessions).toBeInstanceOf(Map);
    expect(s.scores).toBeInstanceOf(Map);
  });

  test('both Maps start empty', () => {
    const s = createStore();
    expect(s.sessions.size).toBe(0);
    expect(s.scores.size).toBe(0);
  });
});
