'use strict';

/**
 * __tests__/server.test.js
 *
 * Unit tests for the Express API routes in server.js.
 *
 * Uses an in-memory mock database (no real PostgreSQL required).
 * All DB calls are intercepted via a mock pool object.
 */

const { createApp, isValidUsername, isValidPassword, isValidScore } = require('../server');
const { signToken } = require('../auth');
const request = require('supertest');

// ── Validation helpers ────────────────────────────────────────────────────────

describe('isValidUsername', () => {
  test('accepts valid alphanumeric username', () => {
    expect(isValidUsername('alice')).toBe(true);
    expect(isValidUsername('Bob_123')).toBe(true);
  });

  test('rejects username shorter than 3 chars', () => {
    expect(isValidUsername('ab')).toBe(false);
  });

  test('rejects username longer than 64 chars', () => {
    expect(isValidUsername('a'.repeat(65))).toBe(false);
  });

  test('rejects usernames with special characters', () => {
    expect(isValidUsername('bad user')).toBe(false);
    expect(isValidUsername('bad@user')).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isValidUsername(null)).toBe(false);
    expect(isValidUsername(123)).toBe(false);
  });
});

describe('isValidPassword', () => {
  test('accepts password of valid length', () => {
    expect(isValidPassword('secret123')).toBe(true);
  });

  test('rejects password shorter than 6 chars', () => {
    expect(isValidPassword('abc')).toBe(false);
  });

  test('rejects password longer than 128 chars', () => {
    expect(isValidPassword('x'.repeat(129))).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isValidPassword(null)).toBe(false);
    expect(isValidPassword(12345678)).toBe(false);
  });

  test('accepts exactly 6-char password', () => {
    expect(isValidPassword('123456')).toBe(true);
  });
});

describe('isValidScore', () => {
  test('accepts zero', () => {
    expect(isValidScore(0)).toBe(true);
  });

  test('accepts positive integers', () => {
    expect(isValidScore(100)).toBe(true);
    expect(isValidScore(999999)).toBe(true);
  });

  test('rejects negative numbers', () => {
    expect(isValidScore(-1)).toBe(false);
  });

  test('rejects floats', () => {
    expect(isValidScore(3.14)).toBe(false);
  });

  test('rejects strings', () => {
    expect(isValidScore('100')).toBe(false);
  });

  test('rejects null / undefined', () => {
    expect(isValidScore(null)).toBe(false);
    expect(isValidScore(undefined)).toBe(false);
  });
});

// ── Mock database factory ─────────────────────────────────────────────────────

/**
 * Build a lightweight mock pool that delegates to a user-supplied query fn.
 */
function makeMockPool(queryFn) {
  return { query: queryFn };
}

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  let app;
  beforeAll(() => {
    app = createApp(makeMockPool(() => { throw new Error('should not be called'); }));
  });

  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── POST /api/auth/register ───────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  let app;

  beforeAll(() => {
    // Simulate a successful INSERT
    app = createApp(
      makeMockPool(async (sql, params) => {
        if (sql.includes('INSERT INTO users')) {
          return { rows: [{ id: 1, username: params[0] }] };
        }
        return { rows: [] };
      })
    );
  });

  test('returns 201 and a token for a valid registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: 'password123' });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.username).toBe('newuser');
  });

  test('returns 400 for a short username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', password: 'password123' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for a short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', password: 'abc' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for missing body', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 409 when username is already taken', async () => {
    const conflictApp = createApp(
      makeMockPool(async () => {
        const err = new Error('duplicate key');
        err.code  = '23505';
        throw err;
      })
    );
    const res = await request(conflictApp)
      .post('/api/auth/register')
      .send({ username: 'taken', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/i);
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const bcrypt = require('bcrypt');

  test('returns 200 and a token for valid credentials', async () => {
    const hash = await bcrypt.hash('correctpass', 10);
    const loginApp = createApp(
      makeMockPool(async () => ({
        rows: [{ id: 5, username: 'tester', password: hash }],
      }))
    );
    const res = await request(loginApp)
      .post('/api/auth/login')
      .send({ username: 'tester', password: 'correctpass' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  test('returns 401 for wrong password', async () => {
    const hash = await bcrypt.hash('correctpass', 10);
    const loginApp = createApp(
      makeMockPool(async () => ({
        rows: [{ id: 5, username: 'tester', password: hash }],
      }))
    );
    const res = await request(loginApp)
      .post('/api/auth/login')
      .send({ username: 'tester', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  test('returns 401 for unknown user', async () => {
    const loginApp = createApp(
      makeMockPool(async () => ({ rows: [] }))
    );
    const res = await request(loginApp)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'somepass' });
    expect(res.status).toBe(401);
  });

  test('returns 400 when username or password is missing', async () => {
    const loginApp = createApp(
      makeMockPool(async () => ({ rows: [] }))
    );
    const res = await request(loginApp)
      .post('/api/auth/login')
      .send({ username: 'someone' }); // no password
    expect(res.status).toBe(400);
  });
});

// ── POST /api/scores ──────────────────────────────────────────────────────────

describe('POST /api/scores', () => {
  const validToken = signToken({ id: 3, username: 'scorer' });

  let scoreApp;
  beforeAll(() => {
    scoreApp = createApp(
      makeMockPool(async (sql, params) => {
        if (sql.includes('INSERT INTO high_scores')) {
          return {
            rows: [{
              id: 1,
              user_id: params[0],
              score:   params[1],
              submitted_at: new Date().toISOString(),
            }],
          };
        }
        return { rows: [] };
      })
    );
  });

  test('returns 201 with saved score for authenticated user', async () => {
    const res = await request(scoreApp)
      .post('/api/scores')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ score: 42 });
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(42);
  });

  test('returns 401 without a token', async () => {
    const res = await request(scoreApp)
      .post('/api/scores')
      .send({ score: 10 });
    expect(res.status).toBe(401);
  });

  test('returns 400 for a negative score', async () => {
    const res = await request(scoreApp)
      .post('/api/scores')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ score: -5 });
    expect(res.status).toBe(400);
  });

  test('returns 400 for a non-integer score', async () => {
    const res = await request(scoreApp)
      .post('/api/scores')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ score: 3.7 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is missing', async () => {
    const res = await request(scoreApp)
      .post('/api/scores')
      .set('Authorization', `Bearer ${validToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('accepts score of 0', async () => {
    const res = await request(scoreApp)
      .post('/api/scores')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ score: 0 });
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(0);
  });
});

// ── GET /api/scores ───────────────────────────────────────────────────────────

describe('GET /api/scores', () => {
  const leaderboard = [
    { username: 'alice', best_score: '99', total_games: '5', last_played: new Date().toISOString() },
    { username: 'bob',   best_score: '50', total_games: '2', last_played: new Date().toISOString() },
  ];

  let boardApp;
  beforeAll(() => {
    boardApp = createApp(
      makeMockPool(async () => ({ rows: leaderboard }))
    );
  });

  test('returns 200 with an array', async () => {
    const res = await request(boardApp).get('/api/scores');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('leaderboard entries include username and best_score', async () => {
    const res = await request(boardApp).get('/api/scores');
    expect(res.body[0]).toHaveProperty('username');
    expect(res.body[0]).toHaveProperty('best_score');
  });

  test('returns 200 for an empty leaderboard', async () => {
    const emptyApp = createApp(makeMockPool(async () => ({ rows: [] })));
    const res = await request(emptyApp).get('/api/scores');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── GET /api/scores/me ────────────────────────────────────────────────────────

describe('GET /api/scores/me', () => {
  const validToken = signToken({ id: 3, username: 'scorer' });
  const myScores   = [
    { id: 10, score: 75, submitted_at: new Date().toISOString() },
    { id:  9, score: 60, submitted_at: new Date().toISOString() },
  ];

  let meApp;
  beforeAll(() => {
    meApp = createApp(
      makeMockPool(async () => ({ rows: myScores }))
    );
  });

  test('returns 200 with user scores for authenticated user', async () => {
    const res = await request(meApp)
      .get('/api/scores/me')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].score).toBe(75);
  });

  test('returns 401 without a token', async () => {
    const res = await request(meApp).get('/api/scores/me');
    expect(res.status).toBe(401);
  });
});
