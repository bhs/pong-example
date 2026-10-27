'use strict';

/**
 * __tests__/request-log.test.js
 *
 * Structured logging: one JSON line per completed request, and one error
 * line (same request_id, with message and stack) per unhandled error.
 */

const http = require('http');
const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');

function request(app, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request(
        { host: '127.0.0.1', port: server.address().port, path: urlPath, method: 'GET', headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            // Give the 'finish' listener a tick to flush its log line.
            setImmediate(() => {
              server.close();
              resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() });
            });
          });
        }
      );
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
  });
}

describe('request logging', () => {
  test('writes one JSON access line per request, path without query', async () => {
    const lines = [];
    const app = createApp(createFakePrisma(), { logWrite: (l) => lines.push(l) });

    const res = await request(app, '/health?x=1');
    expect(res.status).toBe(200);

    const entries = lines.map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.level).toBe('info');
    expect(typeof e.msg).toBe('string');
    expect(e.method).toBe('GET');
    expect(e.path).toBe('/health');
    expect(e.status).toBe(200);
    expect(typeof e.duration_ms).toBe('number');
    expect(typeof e.request_id).toBe('string');
    expect(e.request_id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(e.time))).toBe(false);
    expect(res.headers['x-request-id']).toBe(e.request_id);
  });

  test('takes the request id from an incoming X-Request-Id', async () => {
    const lines = [];
    const app = createApp(createFakePrisma(), { logWrite: (l) => lines.push(l) });

    await request(app, '/health', { 'X-Request-Id': 'abc-123' });
    expect(JSON.parse(lines[0]).request_id).toBe('abc-123');
  });

  test('an unhandled error writes an error line with request_id and stack', async () => {
    const lines = [];
    const prisma = createFakePrisma();
    prisma.highScore.findMany = async () => { throw new Error('boom from test'); };
    const app = createApp(prisma, { logWrite: (l) => lines.push(l) });

    const res = await request(app, '/api/scores', { 'X-Request-Id': 'req-err-1' });
    expect(res.status).toBe(500);

    const entries = lines.map((l) => JSON.parse(l));
    const errLine = entries.find((e) => e.level === 'error');
    expect(errLine).toBeDefined();
    expect(errLine.request_id).toBe('req-err-1');
    expect(errLine.error).toBe('boom from test');
    expect(errLine.stack).toContain('boom from test');
    expect(errLine.stack).toContain('at ');

    const access = entries.find((e) => e.level === 'info');
    expect(access.request_id).toBe('req-err-1');
    expect(access.status).toBe(500);
  });
});
