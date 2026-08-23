'use strict';

/**
 * __tests__/auth.test.js
 *
 * Unit tests for the auth helpers in auth.js.
 * No database or network required.
 */

const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
} = require('../auth');

// ── hashPassword / verifyPassword ─────────────────────────────────────────────

describe('hashPassword', () => {
  test('returns a string that starts with a bcrypt prefix', async () => {
    const hash = await hashPassword('mysecret');
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^\$2[ab]\$/);
  });

  test('hashes are not equal to the plain text', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).not.toBe('mypassword');
  });

  test('different calls produce different hashes (different salts)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  test('returns true for correct password', async () => {
    const hash = await hashPassword('correcthorse');
    const result = await verifyPassword('correcthorse', hash);
    expect(result).toBe(true);
  });

  test('returns false for wrong password', async () => {
    const hash = await hashPassword('correcthorse');
    const result = await verifyPassword('wrongbattery', hash);
    expect(result).toBe(false);
  });

  test('returns false for empty password', async () => {
    const hash = await hashPassword('somepassword');
    const result = await verifyPassword('', hash);
    expect(result).toBe(false);
  });
});

// ── signToken / verifyToken ───────────────────────────────────────────────────

describe('signToken + verifyToken', () => {
  test('round-trips the payload', () => {
    const payload = { id: 42, username: 'alice' };
    const token   = signToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(42);
    expect(decoded.username).toBe('alice');
  });

  test('signed token is a non-empty string', () => {
    const token = signToken({ id: 1, username: 'bob' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('token has three dot-separated parts (JWT structure)', () => {
    const token  = signToken({ id: 1, username: 'carol' });
    const parts  = token.split('.');
    expect(parts.length).toBe(3);
  });

  test('verifyToken throws on a tampered token', () => {
    const token  = signToken({ id: 1, username: 'dave' });
    const bad    = token.slice(0, -3) + 'xxx';
    expect(() => verifyToken(bad)).toThrow();
  });

  test('verifyToken throws on a garbage string', () => {
    expect(() => verifyToken('not.a.jwt')).toThrow();
  });
});

// ── requireAuth middleware ────────────────────────────────────────────────────

describe('requireAuth middleware', () => {
  function makeReqRes(authHeader) {
    const req = { headers: {} };
    if (authHeader !== undefined) req.headers['authorization'] = authHeader;

    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data)   { this.body = data; return this; },
    };
    return { req, res };
  }

  test('calls next() and attaches req.user for a valid token', () => {
    const token = signToken({ id: 7, username: 'eve' });
    const { req, res } = makeReqRes(`Bearer ${token}`);
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe(7);
    expect(req.user.username).toBe('eve');
  });

  test('responds 401 when Authorization header is missing', () => {
    const { req, res } = makeReqRes(undefined);
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  test('responds 401 when header has no Bearer prefix', () => {
    const token = signToken({ id: 1, username: 'frank' });
    const { req, res } = makeReqRes(token); // missing "Bearer "
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('responds 401 for an invalid token', () => {
    const { req, res } = makeReqRes('Bearer totally.invalid.token');
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('responds 401 for an empty Bearer value', () => {
    const { req, res } = makeReqRes('Bearer ');
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
