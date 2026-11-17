'use strict';

/**
 * __tests__/engagement-endpoint.test.js
 *
 * GET /api/engagement against the fake Prisma client and the testAuth seam,
 * plus the `engagement` config GET /me hands the browser.
 */

const http = require('http');
const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');

beforeAll(() => { delete process.env.ENABLED_STUBS; });

const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const ALICE = { id: 'alice', email: 'alice@example.com', name: 'Alice', avatar: null, nickname: null };

function loggedInAs(user) {
  return (req, res, next) => {
    req.user = user;
    req.isAuthenticated = () => true;
    next();
  };
}

function get(app, url) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
        });
      }).on('error', (err) => { server.close(); reject(err); });
    });
  });
}

function seedGame(prisma, userId, daysAgo, score) {
  prisma.__gameHistory.push({
    id: prisma.__gameHistory.length + 1, userId, score, duration: 30, finishedAt: new Date(NOW - daysAgo * DAY),
  });
}

describe('GET /api/engagement', () => {
  let prisma;
  const appFor = (user = ALICE) => createApp(prisma, { testAuth: loggedInAs(user), now: () => NOW });

  beforeEach(() => { prisma = createFakePrisma(); });

  test('requires login', async () => {
    const res = await get(createApp(prisma, { now: () => NOW }), '/api/engagement');
    expect(res.status).toBe(401);
  });

  test('returns the streak and yesterday/today bests for the player', async () => {
    seedGame(prisma, ALICE.id, 0, 4);
    seedGame(prisma, ALICE.id, 1, 9);
    seedGame(prisma, ALICE.id, 2, 3);
    seedGame(prisma, 'bob', 1, 11); // someone else's game is ignored
    const res = await get(appFor(), '/api/engagement?tzOffset=0');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ streak: 3, playedToday: true, yesterdayBest: 9, todayBest: 4 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('honours the client timezone offset', async () => {
    // 22:00 UTC on 14 Jun: yesterday in UTC, but today in UTC+10 (offset -600).
    prisma.__gameHistory.push({ id: 1, userId: ALICE.id, score: 6, duration: 1, finishedAt: new Date(Date.UTC(2024, 5, 14, 22, 0, 0)) });
    expect((await get(appFor(), '/api/engagement?tzOffset=0')).body.yesterdayBest).toBe(6);
    const east = await get(appFor(), '/api/engagement?tzOffset=-600');
    expect(east.body).toMatchObject({ playedToday: true, todayBest: 6, yesterdayBest: null });
  });

  test('only reads the last 400 days', async () => {
    seedGame(prisma, ALICE.id, 401, 5);
    const res = await get(appFor(), '/api/engagement');
    expect(res.body.streak).toBe(0);
  });

  test('a new player has no streak', async () => {
    const res = await get(appFor(), '/api/engagement?tzOffset=60');
    expect(res.body).toEqual({ streak: 0, playedToday: false, yesterdayBest: null, todayBest: null });
  });

  test('rejects a malformed tzOffset', async () => {
    const res = await get(appFor(), '/api/engagement?tzOffset=soon');
    expect(res.status).toBe(400);
  });
});

describe('GET /me engagement config', () => {
  test('is included for signed-out and signed-in players', async () => {
    const prisma = createFakePrisma();
    const out = await get(createApp(prisma), '/me');
    expect(out.body.engagement.signedOut).toEqual({ enabled: false, line: 'Sign in to build a streak' });
    expect(out.body.engagement.prompt.placement).toBe('toast-over-the-screen');
    const signedIn = await get(createApp(prisma, { testAuth: loggedInAs(ALICE) }), '/me');
    expect(signedIn.body.engagement.prompt.placement).toBe('toast-over-the-screen');
  });
});
