'use strict';

/**
 * Tests for the "google-sign-in" demo stub: with it enabled, /auth/google
 * offers a picker over the users and the callback logs the chosen one in.
 */

const http = require('http');
const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');
const { isStubEnabled } = require('../lib/stubs');

function get(app, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request(
        { host: '127.0.0.1', port: server.address().port, method: 'GET', path: url, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() });
          });
        },
      );
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
  });
}

describe('isStubEnabled', () => {
  test('is off when absent or empty', () => {
    expect(isStubEnabled('google-sign-in', {})).toBe(false);
    expect(isStubEnabled('google-sign-in', { ENABLED_STUBS: '' })).toBe(false);
  });

  test('finds a name in a comma-separated list', () => {
    expect(isStubEnabled('google-sign-in', { ENABLED_STUBS: 'other, google-sign-in' })).toBe(true);
  });
});

describe('google-sign-in stub', () => {
  const original = process.env.ENABLED_STUBS;

  beforeAll(() => { process.env.ENABLED_STUBS = 'google-sign-in'; });
  afterAll(() => {
    if (original === undefined) delete process.env.ENABLED_STUBS; else process.env.ENABLED_STUBS = original;
  });

  async function appWithUser() {
    const prisma = createFakePrisma();
    await prisma.user.upsert({
      where: { id: 'demo-player-01' },
      update: {},
      create: { id: 'demo-player-01', email: 'avery@example.com', name: 'Avery', avatar: null },
    });
    return createApp(prisma);
  }

  test('GET /auth/google lists the seeded users', async () => {
    const res = await get(await appWithUser(), '/auth/google');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/auth/google/callback?user=demo-player-01');
    expect(res.text).toContain('Avery');
  });

  test('callback with a known user signs in and redirects home', async () => {
    const res = await get(await appWithUser(), '/auth/google/callback?user=demo-player-01');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.headers['set-cookie'].join(';')).toContain('connect.sid');
  });

  test('callback with an unknown user fails the login', async () => {
    const res = await get(await appWithUser(), '/auth/google/callback?user=nobody');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?login=failed');
  });
});
