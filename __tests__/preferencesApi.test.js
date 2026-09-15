'use strict';

/**
 * __tests__/preferencesApi.test.js
 *
 * Endpoint tests for GET/PUT /api/preferences. Authenticated requests are
 * exercised via the legacy stub login (POST /api/login → Bearer token)
 * rather than a real Google OAuth round-trip, since resolveUserId() in
 * server.js accepts either — this keeps the tests self-contained (no
 * network access needed) while still covering the authenticated path.
 *
 * Each test creates its own isolated store + in-memory SQLite database
 * (via createApp's default deps) so tests never share state or touch disk.
 */

const http = require('http');
const { createApp, createStore } = require('../server');

function makeRequest(app, method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyJson = body !== null ? JSON.stringify(body) : null;
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
          ...headers,
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

function get(app, url, headers)        { return makeRequest(app, 'GET', url, null, headers); }
function put(app, url, body, headers)  { return makeRequest(app, 'PUT', url, body, headers); }
function post(app, url, body)          { return makeRequest(app, 'POST', url, body); }

/** Logs in via the legacy stub endpoint and returns a Bearer auth header. */
async function loginAndGetAuthHeader(app, username) {
  const res = await post(app, '/api/login', { username });
  return { Authorization: `Bearer ${res.body.token}` };
}

describe('GET /api/preferences', () => {
  test('returns 401 when not authenticated', async () => {
    const app = createApp(createStore());
    const res = await get(app, '/api/preferences');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  test('returns built-in defaults (isDefault: true) for a user who never saved any', async () => {
    const app    = createApp(createStore());
    const auth   = await loginAndGetAuthHeader(app, 'alice');
    const res    = await get(app, '/api/preferences', auth);

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.preferences.paddleColor).toBe('#ffffff');
    expect(res.body.preferences.ballColor).toBe('#ffffff');
    expect(res.body.preferences.bgColor).toBe('#000000');
  });
});

describe('PUT /api/preferences', () => {
  test('returns 401 when not authenticated', async () => {
    const app = createApp(createStore());
    const res = await put(app, '/api/preferences', { paddleColor: '#ff0000' });
    expect(res.status).toBe(401);
  });

  test('saves preferences and echoes them back', async () => {
    const app  = createApp(createStore());
    const auth = await loginAndGetAuthHeader(app, 'bob');

    const putRes = await put(app, '/api/preferences', {
      paddleColor: '#111111',
      ballColor:   '#222222',
      bgColor:     '#333333',
      presetName:  null,
    }, auth);

    expect(putRes.status).toBe(200);
    expect(putRes.body.preferences.paddleColor).toBe('#111111');
    expect(putRes.body.preferences.ballColor).toBe('#222222');
    expect(putRes.body.preferences.bgColor).toBe('#333333');
  });

  test('a later GET reflects the saved preferences (isDefault: false)', async () => {
    const app  = createApp(createStore());
    const auth = await loginAndGetAuthHeader(app, 'carol');

    await put(app, '/api/preferences', { paddleColor: '#abcdef' }, auth);
    const getRes = await get(app, '/api/preferences', auth);

    expect(getRes.status).toBe(200);
    expect(getRes.body.isDefault).toBe(false);
    expect(getRes.body.preferences.paddleColor).toBe('#abcdef');
  });

  test('rejects an invalid hex color with 400', async () => {
    const app  = createApp(createStore());
    const auth = await loginAndGetAuthHeader(app, 'dave');

    const res = await put(app, '/api/preferences', { paddleColor: 'not-a-color' }, auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('two different users get independent preferences', async () => {
    const app   = createApp(createStore());
    const auth1 = await loginAndGetAuthHeader(app, 'erin');
    const auth2 = await loginAndGetAuthHeader(app, 'frank');

    await put(app, '/api/preferences', { paddleColor: '#111111' }, auth1);
    await put(app, '/api/preferences', { paddleColor: '#999999' }, auth2);

    const res1 = await get(app, '/api/preferences', auth1);
    const res2 = await get(app, '/api/preferences', auth2);

    expect(res1.body.preferences.paddleColor).toBe('#111111');
    expect(res2.body.preferences.paddleColor).toBe('#999999');
  });

  test('preferences persist across a new createApp instance sharing the same db/prefsRepo', async () => {
    const { createDb }              = require('../db');
    const { createPreferencesRepo } = require('../preferencesRepo');

    const db        = createDb(':memory:');
    const prefsRepo = createPreferencesRepo(db);
    const store      = createStore();

    const app1 = createApp(store, { db, prefsRepo });
    const auth = await loginAndGetAuthHeader(app1, 'grace');
    await put(app1, '/api/preferences', { paddleColor: '#654321' }, auth);

    // A second app instance wired to the *same* db/prefsRepo (simulating a
    // fresh request handled by the same long-running server process) sees
    // the persisted value.
    const app2 = createApp(store, { db, prefsRepo });
    const res  = await get(app2, '/api/preferences', auth);

    expect(res.body.preferences.paddleColor).toBe('#654321');
  });
});
