'use strict';

/**
 * __tests__/preferences-game-settings.test.js
 *
 * GET/PUT /api/preferences for the game-customization fields (ballSpeed,
 * difficulty, paddleColor) saved by the pause/settings modal, driven against
 * the fake Prisma client.
 */

const http = require('http');
const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');

function request(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const json   = body === undefined ? null : JSON.stringify(body);
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, method, path: url,
        headers: { 'Content-Type': 'application/json', 'Content-Length': json ? Buffer.byteLength(json) : 0 },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (json) req.write(json);
      req.end();
    });
  });
}

const ALICE = { id: 'alice', email: 'alice@example.com', name: 'Alice', avatar: null, nickname: null };
const loggedIn = (user) => (req, res, next) => {
  req.user = user;
  req.isAuthenticated = () => true;
  next();
};

describe('game customization preferences', () => {
  test('GET returns normal speed and difficulty by default', async () => {
    const app = createApp(createFakePrisma(), { testAuth: loggedIn(ALICE) });
    const res = await request(app, 'GET', '/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body.preferences).toMatchObject({ paddleColor: '#ffffff', ballSpeed: 'normal', difficulty: 'normal' });
  });

  test('PUT saves ballSpeed, difficulty and paddleColor, and GET returns them', async () => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma, { testAuth: loggedIn(ALICE) });
    const put = await request(app, 'PUT', '/api/preferences', {
      paddleColor: '#FF6B6B', ballSpeed: 'fast', difficulty: 'hard',
    });
    expect(put.status).toBe(200);
    expect(prisma.__preferences.get(ALICE.id)).toMatchObject({
      paddleColor: '#ff6b6b', ballSpeed: 'fast', difficulty: 'hard',
    });
    const got = await request(app, 'GET', '/api/preferences');
    expect(got.body.preferences).toMatchObject({ paddleColor: '#ff6b6b', ballSpeed: 'fast', difficulty: 'hard' });
  });

  test('PUT with only one field leaves the others untouched', async () => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma, { testAuth: loggedIn(ALICE) });
    await request(app, 'PUT', '/api/preferences', { ballSpeed: 'slow', difficulty: 'easy' });
    await request(app, 'PUT', '/api/preferences', { difficulty: 'hard' });
    expect(prisma.__preferences.get(ALICE.id)).toMatchObject({ ballSpeed: 'slow', difficulty: 'hard' });
  });

  test.each([
    [{ ballSpeed: 'turbo' }],
    [{ ballSpeed: 3 }],
    [{ difficulty: 'impossible' }],
    [{ difficulty: null }],
    [{ paddleColor: 'red' }],
    [{ paddleColor: '#fff' }],
  ])('PUT rejects invalid body %j', async (body) => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma, { testAuth: loggedIn(ALICE) });
    const res = await request(app, 'PUT', '/api/preferences', body);
    expect(res.status).toBe(400);
    expect(prisma.__preferences.size).toBe(0);
  });

  test('guests (no session) get 401 and nothing is written', async () => {
    const prisma = createFakePrisma();
    const app    = createApp(prisma);
    expect((await request(app, 'GET', '/api/preferences')).status).toBe(401);
    expect((await request(app, 'PUT', '/api/preferences', { ballSpeed: 'fast' })).status).toBe(401);
    expect(prisma.__preferences.size).toBe(0);
  });
});
