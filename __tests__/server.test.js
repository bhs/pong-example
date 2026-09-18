'use strict';

/**
 * __tests__/server.test.js
 *
 * Unit tests for the MySQL-backed (Knex) Express API. Each test suite
 * creates its own isolated in-memory fake of db/queries.js (see
 * __tests__/helpers/fakeQueries.js) and injects it via createApp(queries),
 * so these tests never touch a real MySQL connection.
 */

const { createApp } = require('../server');
const { createFakeQueries } = require('./helpers/fakeQueries');

// ── Minimal HTTP request helper ────────────────────────────────────────────

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
    app = createApp(createFakeQueries());
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
  let app, queries;

  beforeEach(() => {
    queries = createFakeQueries();
    app     = createApp(queries);
  });

  test('returns empty scores array when store is empty', async () => {
    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toEqual([]);
  });

  test('returns all scores when store has entries', async () => {
    await queries.upsertHighScore('alice', 100);
    await queries.upsertHighScore('bob', 200);

    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(2);
  });

  test('returns scores sorted by score descending', async () => {
    await queries.upsertHighScore('alice', 50);
    await queries.upsertHighScore('bob', 200);
    await queries.upsertHighScore('carol', 100);

    const res = await get(app, '/api/scores');
    const scores = res.body.scores.map((e) => e.score);
    expect(scores).toEqual([200, 100, 50]);
  });

  test('respects the ?limit query parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await queries.upsertHighScore(`player${i}`, i * 10);
    }

    const res = await get(app, '/api/scores', 'limit=3');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(3);
  });

  test('caps limit at 100', async () => {
    // Populate 5 entries; limit=200 → capped at 100, returns all 5
    for (let i = 0; i < 5; i++) {
      await queries.upsertHighScore(`p${i}`, i);
    }

    const res = await get(app, '/api/scores', 'limit=200');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(5);
  });
});

// ── POST /api/scores ───────────────────────────────────────────────────────

describe('POST /api/scores', () => {
  let app, queries;

  beforeEach(() => {
    queries = createFakeQueries();
    app     = createApp(queries);
  });

  test('creates a new score entry and returns updated:true', async () => {
    const res = await post(app, '/api/scores', { player: 'Alice', score: 150 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.player).toBe('alice');
    expect(res.body.entry.score).toBe(150);
  });

  test('stores the score', async () => {
    await post(app, '/api/scores', { player: 'alice', score: 99 });
    const entry = await queries.getHighScore('alice');
    expect(entry).toBeTruthy();
    expect(entry.score).toBe(99);
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
    const entry = await queries.getHighScore('bob');
    expect(entry).toBeTruthy();
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
  let app, queries;

  beforeEach(() => {
    queries = createFakeQueries();
    app     = createApp(queries);
  });

  test('returns the entry for a known player', async () => {
    await queries.upsertHighScore('alice', 300);
    const res = await get(app, '/api/scores/alice');
    expect(res.status).toBe(200);
    expect(res.body.entry.player).toBe('alice');
    expect(res.body.entry.score).toBe(300);
  });

  test('is case-insensitive (player name is lowercased)', async () => {
    await queries.upsertHighScore('alice', 300);
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
  let app, queries;

  beforeEach(() => {
    queries = createFakeQueries();
    app     = createApp(queries);
  });

  test('deletes an existing entry and returns deleted:true', async () => {
    await queries.upsertHighScore('alice', 100);
    const res = await del(app, '/api/scores/alice');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.player).toBe('alice');
  });

  test('removes the entry', async () => {
    await queries.upsertHighScore('alice', 100);
    await del(app, '/api/scores/alice');
    const entry = await queries.getHighScore('alice');
    expect(entry).toBeNull();
  });

  test('returns 404 when player does not exist', async () => {
    const res = await del(app, '/api/scores/nobody');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  test('is case-insensitive', async () => {
    await queries.upsertHighScore('bob', 50);
    const res = await del(app, '/api/scores/BOB');
    expect(res.status).toBe(200);
    const entry = await queries.getHighScore('bob');
    expect(entry).toBeNull();
  });
});

// ── fakeQueries isolation ──────────────────────────────────────────────────

describe('createFakeQueries', () => {
  test('creates independent instances', async () => {
    const q1 = createFakeQueries();
    const q2 = createFakeQueries();
    await q1.upsertHighScore('alice', 1);
    expect(await q2.getHighScore('alice')).toBeNull();
  });

  test('starts with no scores', async () => {
    const q = createFakeQueries();
    expect(await q.listHighScores()).toEqual([]);
  });
});
