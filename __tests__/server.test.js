'use strict';

/**
 * __tests__/server.test.js
 *
 * Unit tests for the Prisma/MySQL-backed Express API. Each test suite
 * creates its own isolated fake Prisma client (see __tests__/helpers/
 * fakePrisma.js) so tests don't share state and never touch a real MySQL
 * instance.
 */

const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');

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
function put(app, url, body)          { return makeRequest(app, 'PUT',    url, body); }
function get(app, url, query = '')    { return makeRequest(app, 'GET',    url, null, query); }
function del(app, url)                { return makeRequest(app, 'DELETE', url); }

// A testAuth middleware (see server.js's createApp docs) that logs every
// request in as the given fake user — used to exercise the login-gated
// routes without a real Google OAuth round-trip.
function loggedInAs(user) {
  return (req, res, next) => {
    req.user = user;
    req.isAuthenticated = () => true;
    next();
  };
}

const ALICE = { id: 'google-sub-alice', email: 'alice@example.com', name: 'Alice', avatar: null };
const BOB   = { id: 'google-sub-bob',   email: 'bob@example.com',   name: 'Bob',   avatar: null };

// ── GET /api/scores ────────────────────────────────────────────────────────

describe('GET /api/scores', () => {
  let app, prisma;

  beforeEach(() => {
    prisma = createFakePrisma();
    app    = createApp(prisma);
  });

  test('returns empty scores array when store is empty', async () => {
    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toEqual([]);
  });

  test('returns all scores when store has entries', async () => {
    prisma.__users.set(ALICE.id, ALICE);
    prisma.__users.set(BOB.id, BOB);
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 100, updatedAt: new Date() });
    prisma.__highScores.set(BOB.id,   { id: 2, userId: BOB.id,   score: 200, updatedAt: new Date() });

    const res = await get(app, '/api/scores');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(2);
  });

  test('returns scores sorted by score descending', async () => {
    prisma.__highScores.set('u1', { id: 1, userId: 'u1', score: 50,  updatedAt: new Date() });
    prisma.__highScores.set('u2', { id: 2, userId: 'u2', score: 200, updatedAt: new Date() });
    prisma.__highScores.set('u3', { id: 3, userId: 'u3', score: 100, updatedAt: new Date() });

    const res = await get(app, '/api/scores');
    const scores = res.body.scores.map((e) => e.score);
    expect(scores).toEqual([200, 100, 50]);
  });

  test('respects the ?limit query parameter', async () => {
    for (let i = 0; i < 10; i++) {
      prisma.__highScores.set(`p${i}`, { id: i, userId: `p${i}`, score: i * 10, updatedAt: new Date() });
    }

    const res = await get(app, '/api/scores', 'limit=3');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(3);
  });

  test('caps limit at 100', async () => {
    for (let i = 0; i < 5; i++) {
      prisma.__highScores.set(`p${i}`, { id: i, userId: `p${i}`, score: i, updatedAt: new Date() });
    }

    const res = await get(app, '/api/scores', 'limit=200');
    expect(res.status).toBe(200);
    expect(res.body.scores).toHaveLength(5);
  });

  test('derives the player name from the joined user, falling back to userId', async () => {
    prisma.__users.set(ALICE.id, ALICE);
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 10, updatedAt: new Date() });
    prisma.__highScores.set('unknown-user', { id: 2, userId: 'unknown-user', score: 5, updatedAt: new Date() });

    const res = await get(app, '/api/scores');
    const byUser = Object.fromEntries(res.body.scores.map((e) => [e.userId, e.player]));
    expect(byUser[ALICE.id]).toBe('Alice');
    expect(byUser['unknown-user']).toBe('unknown-user');
  });
});

// ── POST /api/scores ───────────────────────────────────────────────────────

describe('POST /api/scores', () => {
  let app, prisma;

  beforeEach(() => {
    prisma = createFakePrisma();
    prisma.__users.set(ALICE.id, ALICE);
  });

  test('requires an authenticated session', async () => {
    app = createApp(prisma);
    const res = await post(app, '/api/scores', { score: 100 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('creates a new score entry for the logged-in user and returns updated:true', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 150 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.userId).toBe(ALICE.id);
    expect(res.body.entry.score).toBe(150);
  });

  test('stores the score keyed by userId', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 99 });
    expect(prisma.__highScores.has(ALICE.id)).toBe(true);
    expect(prisma.__highScores.get(ALICE.id).score).toBe(99);
  });

  test('updates the score when new score is higher', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 50 });
    const res = await post(app, '/api/scores', { score: 150 });
    expect(res.body.updated).toBe(true);
    expect(res.body.entry.score).toBe(150);
  });

  test('does NOT update when new score is lower', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 200 });
    const res = await post(app, '/api/scores', { score: 50 });
    expect(res.body.updated).toBe(false);
    expect(res.body.entry.score).toBe(200);
  });

  test('does NOT update when new score equals existing score', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 100 });
    const res = await post(app, '/api/scores', { score: 100 });
    expect(res.body.updated).toBe(false);
  });

  test('returns 400 when score is missing', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when score is a string', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 'high' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is negative', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: -1 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is Infinity', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: Infinity });
    expect(res.status).toBe(400);
  });

  test('accepts score of 0', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 0 });
    expect(res.status).toBe(200);
    expect(res.body.entry.score).toBe(0);
  });

  test('also records a GameHistory row, independent of the HighScore update', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 100, duration: 42 });
    expect(prisma.__gameHistory).toHaveLength(1);
    expect(prisma.__gameHistory[0]).toMatchObject({ userId: ALICE.id, score: 100, duration: 42 });
  });

  test('records a GameHistory row even when the score does not beat the high score', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 200 });
    const res = await post(app, '/api/scores', { score: 50, duration: 10 });
    expect(res.body.updated).toBe(false);
    expect(prisma.__gameHistory).toHaveLength(2);
    expect(prisma.__gameHistory[1]).toMatchObject({ userId: ALICE.id, score: 50, duration: 10 });
  });

  test('defaults duration to 0 when omitted', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 10 });
    expect(prisma.__gameHistory[0].duration).toBe(0);
  });

  test('returns 400 when duration is negative', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 10, duration: -5 });
    expect(res.status).toBe(400);
  });

  test('stores longestRally alongside score on first submission', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 10, longestRally: 7 });
    expect(res.status).toBe(200);
    expect(res.body.entry.longestRally).toBe(7);
    expect(prisma.__highScores.get(ALICE.id).longestRally).toBe(7);
  });

  test('defaults longestRally to 0 when omitted', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 10 });
    expect(prisma.__highScores.get(ALICE.id).longestRally).toBe(0);
  });

  test('bumps longestRally even when the score does not beat the high score', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 200, longestRally: 3 });
    const res = await post(app, '/api/scores', { score: 50, longestRally: 9 });
    expect(res.body.updated).toBe(false);            // score did not improve
    expect(res.body.entry.score).toBe(200);           // score untouched
    expect(res.body.entry.longestRally).toBe(9);       // rally still bumped
  });

  test('does NOT lower longestRally when a later game has a shorter rally', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    await post(app, '/api/scores', { score: 10, longestRally: 12 });
    const res = await post(app, '/api/scores', { score: 20, longestRally: 4 });
    expect(res.body.entry.longestRally).toBe(12);
  });

  test('returns 400 when longestRally is negative', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 10, longestRally: -1 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when longestRally is not an integer', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await post(app, '/api/scores', { score: 10, longestRally: 1.5 });
    expect(res.status).toBe(400);
  });

  test('bumps User.lastPlayedAt on every call, even when the score does not improve', async () => {
    app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    expect(prisma.__users.get(ALICE.id).lastPlayedAt).toBeUndefined();

    await post(app, '/api/scores', { score: 200 });
    const firstPlayedAt = prisma.__users.get(ALICE.id).lastPlayedAt;
    expect(firstPlayedAt).toBeInstanceOf(Date);

    // A later, lower-scoring game still bumps lastPlayedAt, independent of
    // whether the HighScore row itself changes.
    const res = await post(app, '/api/scores', { score: 50 });
    expect(res.body.updated).toBe(false);
    const secondPlayedAt = prisma.__users.get(ALICE.id).lastPlayedAt;
    expect(secondPlayedAt).toBeInstanceOf(Date);
    expect(secondPlayedAt.getTime()).toBeGreaterThanOrEqual(firstPlayedAt.getTime());
  });
});

// ── GET /api/scores/:userId ────────────────────────────────────────────────

describe('GET /api/scores/:userId', () => {
  let app, prisma;

  beforeEach(() => {
    prisma = createFakePrisma();
    app    = createApp(prisma);
  });

  test('returns the entry for a known user', async () => {
    prisma.__users.set(ALICE.id, ALICE);
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 300, updatedAt: new Date() });

    const res = await get(app, `/api/scores/${ALICE.id}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.userId).toBe(ALICE.id);
    expect(res.body.entry.score).toBe(300);
    expect(res.body.entry.player).toBe('Alice');
  });

  test('returns 404 for an unknown user id', async () => {
    const res = await get(app, '/api/scores/nobody');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  test('includes the attached user\'s lastPlayedAt', async () => {
    const playedAt = new Date('2024-05-01T12:00:00.000Z');
    prisma.__users.set(ALICE.id, { ...ALICE, lastPlayedAt: playedAt });
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 300, updatedAt: new Date() });

    const res = await get(app, `/api/scores/${ALICE.id}`);
    expect(res.status).toBe(200);
    expect(res.body.entry.lastPlayedAt).toBe(playedAt.getTime());
  });

  test('lastPlayedAt is null when the user has never played', async () => {
    prisma.__users.set(ALICE.id, ALICE);
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 300, updatedAt: new Date() });

    const res = await get(app, `/api/scores/${ALICE.id}`);
    expect(res.body.entry.lastPlayedAt).toBeNull();
  });
});

// ── DELETE /api/scores/:userId ─────────────────────────────────────────────

describe('DELETE /api/scores/:userId', () => {
  let app, prisma;

  beforeEach(() => {
    prisma = createFakePrisma();
    app    = createApp(prisma);
  });

  test('deletes an existing entry and returns deleted:true', async () => {
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 100, updatedAt: new Date() });
    const res = await del(app, `/api/scores/${ALICE.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.userId).toBe(ALICE.id);
  });

  test('removes the entry from the store', async () => {
    prisma.__highScores.set(ALICE.id, { id: 1, userId: ALICE.id, score: 100, updatedAt: new Date() });
    await del(app, `/api/scores/${ALICE.id}`);
    expect(prisma.__highScores.has(ALICE.id)).toBe(false);
  });

  test('returns 404 when the user has no high score', async () => {
    const res = await del(app, '/api/scores/nobody');
    expect(res.status).toBe(404);
  });
});

// ── GET /api/preferences ────────────────────────────────────────────────────

describe('GET /api/preferences', () => {
  test('requires an authenticated session', async () => {
    const app = createApp(createFakePrisma());
    const res = await get(app, '/api/preferences');
    expect(res.status).toBe(401);
  });

  test('returns schema defaults when nothing has been saved', async () => {
    const app = createApp(createFakePrisma(), { testAuth: loggedInAs(ALICE) });
    const res = await get(app, '/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({ theme: 'dark', soundEnabled: true, paddleColor: '#ffffff' });
  });

  test('returns previously saved preferences', async () => {
    const prisma = createFakePrisma();
    prisma.__preferences.set(ALICE.id, {
      id: 1, userId: ALICE.id, theme: 'light', soundEnabled: false, paddleColor: '#ff0000',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await get(app, '/api/preferences');
    expect(res.body.preferences.theme).toBe('light');
    expect(res.body.preferences.soundEnabled).toBe(false);
  });
});

// ── PUT /api/preferences ─────────────────────────────────────────────────────

describe('PUT /api/preferences', () => {
  test('requires an authenticated session', async () => {
    const app = createApp(createFakePrisma());
    const res = await put(app, '/api/preferences', { theme: 'light' });
    expect(res.status).toBe(401);
  });

  test('creates preferences for the logged-in user', async () => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await put(app, '/api/preferences', { theme: 'light', soundEnabled: false, paddleColor: '#00ff00' });
    expect(res.status).toBe(200);
    expect(res.body.preferences.theme).toBe('light');
    expect(prisma.__preferences.get(ALICE.id).paddleColor).toBe('#00ff00');
  });

  test('partially updates existing preferences', async () => {
    const prisma = createFakePrisma();
    prisma.__preferences.set(ALICE.id, {
      id: 1, userId: ALICE.id, theme: 'dark', soundEnabled: true, paddleColor: '#ffffff',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const app = createApp(prisma, { testAuth: loggedInAs(ALICE) });
    const res = await put(app, '/api/preferences', { soundEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.preferences.soundEnabled).toBe(false);
    expect(res.body.preferences.theme).toBe('dark');
  });

  test('returns 400 for an invalid theme', async () => {
    const app = createApp(createFakePrisma(), { testAuth: loggedInAs(ALICE) });
    const res = await put(app, '/api/preferences', { theme: '' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for a non-boolean soundEnabled', async () => {
    const app = createApp(createFakePrisma(), { testAuth: loggedInAs(ALICE) });
    const res = await put(app, '/api/preferences', { soundEnabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid paddleColor', async () => {
    const app = createApp(createFakePrisma(), { testAuth: loggedInAs(ALICE) });
    const res = await put(app, '/api/preferences', { paddleColor: 42 });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/game-history ───────────────────────────────────────────────────

describe('GET /api/game-history', () => {
  test('requires an authenticated session', async () => {
    const app = createApp(createFakePrisma());
    const res = await get(app, '/api/game-history');
    expect(res.status).toBe(401);
  });

  test('returns an empty list when the player has no history', async () => {
    const app = createApp(createFakePrisma(), { testAuth: loggedInAs(ALICE) });
    const res = await get(app, '/api/game-history');
    expect(res.status).toBe(200);
    expect(res.body.games).toEqual([]);
  });

  test('returns only the logged-in player\'s games, newest first', async () => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma, { testAuth: loggedInAs(ALICE) });

    prisma.__gameHistory.push(
      { id: 1, userId: ALICE.id, score: 5,  duration: 30, finishedAt: new Date(Date.now() - 3000) },
      { id: 2, userId: BOB.id,   score: 9,  duration: 20, finishedAt: new Date(Date.now() - 2000) },
      { id: 3, userId: ALICE.id, score: 7,  duration: 45, finishedAt: new Date(Date.now() - 1000) },
    );

    const res = await get(app, '/api/game-history');
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(2);
    expect(res.body.games.map((g) => g.score)).toEqual([7, 5]);
  });

  test('caps results at 10 most recent games', async () => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma, { testAuth: loggedInAs(ALICE) });

    for (let i = 0; i < 15; i++) {
      prisma.__gameHistory.push({
        id: i, userId: ALICE.id, score: i, duration: i,
        finishedAt: new Date(Date.now() - i * 1000),
      });
    }

    const res = await get(app, '/api/game-history');
    expect(res.body.games).toHaveLength(10);
    // Newest first: i=0 was "just now", i=14 was 14s ago.
    expect(res.body.games[0].score).toBe(0);
  });
});
