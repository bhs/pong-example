'use strict';

/**
 * API integration tests for the Express/JWT/SQLite backend.
 *
 * Tests run against the real in-memory database (DB_PATH set to :memory:
 * equivalent via a temp file per test run) so they exercise the full stack
 * without mocking.
 */

const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const request = require('supertest');

// Point the database at a fresh temp file for this test run so tests are
// fully isolated from any development database.
const tmpDb = path.join(os.tmpdir(), `pong-test-${process.pid}.db`);
process.env.DB_PATH    = tmpDb;
process.env.JWT_SECRET = 'test-secret-key-for-jest';

// Require server AFTER setting env vars so the module picks them up.
const { app, db } = require('../server');

// ── Helpers ────────────────────────────────────────────────────────────────

async function registerUser(email, password) {
  return request(app)
    .post('/api/auth/register')
    .send({ email, password });
}

async function loginUser(email, password) {
  return request(app)
    .post('/api/auth/login')
    .send({ email, password });
}

// ── Teardown ───────────────────────────────────────────────────────────────

afterAll(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  try {
    fs.unlinkSync(tmpDb);
  } catch { /* ignore */ }
});

// ── /health ────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── POST /api/auth/register ────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  test('registers a new user and returns a JWT + userId', async () => {
    const res = await registerUser('alice@example.com', 'password123');
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.split('.').length).toBe(3); // valid JWT structure
    expect(typeof res.body.userId).toBe('number');
  });

  test('normalises email to lowercase', async () => {
    const res = await registerUser('BOB@EXAMPLE.COM', 'securePass1');
    expect(res.status).toBe(201);
    // Login with lowercase should work
    const login = await loginUser('bob@example.com', 'securePass1');
    expect(login.status).toBe(200);
  });

  test('returns 409 when email is already registered', async () => {
    await registerUser('carol@example.com', 'pass1234');
    const res = await registerUser('carol@example.com', 'differentpass');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'pass1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('returns 400 when email is invalid (no @)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'notanemail', password: 'pass1234' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when password is too short (< 6 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/i);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nopass@example.com' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await registerUser('dave@example.com', 'davepass99');
  });

  test('returns 200 with token and userId on valid credentials', async () => {
    const res = await loginUser('dave@example.com', 'davepass99');
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.split('.').length).toBe(3);
    expect(typeof res.body.userId).toBe('number');
  });

  test('returns 401 on wrong password', async () => {
    const res = await loginUser('dave@example.com', 'wrongpass');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test('returns 401 for unknown email', async () => {
    const res = await loginUser('nobody@example.com', 'somepass');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'pass' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dave@example.com' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/scores ───────────────────────────────────────────────────────

describe('POST /api/scores', () => {
  let token;
  let userId;

  beforeAll(async () => {
    const res = await registerUser('eve@example.com', 'evepass99');
    token  = res.body.token;
    userId = res.body.userId;
  });

  test('creates a score record and returns 201 with id/score/userId', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${token}`)
      .send({ score: 42 });
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(42);
    expect(res.body.userId).toBe(userId);
    expect(typeof res.body.id).toBe('number');
  });

  test('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/api/scores')
      .send({ score: 10 });
    expect(res.status).toBe(401);
  });

  test('returns 401 when token is invalid', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', 'Bearer this.is.invalid')
      .send({ score: 10 });
    expect(res.status).toBe(401);
  });

  test('returns 400 when score is not an integer', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${token}`)
      .send({ score: 3.7 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is negative', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${token}`)
      .send({ score: -5 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when score is missing', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('accepts score of 0', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${token}`)
      .send({ score: 0 });
    expect(res.status).toBe(201);
    expect(res.body.score).toBe(0);
  });
});

// ── GET /api/scores/leaderboard ────────────────────────────────────────────

describe('GET /api/scores/leaderboard', () => {
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    const a = await registerUser('frank@example.com', 'frankpass1');
    const b = await registerUser('grace@example.com', 'gracepass1');
    tokenA = a.body.token;
    tokenB = b.body.token;

    // Insert several scores
    await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ score: 100 });
    await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ score: 200 });
    await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ score: 150 });
  });

  test('returns 200 with an array', async () => {
    const res = await request(app).get('/api/scores/leaderboard');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns at most 10 entries', async () => {
    const res = await request(app).get('/api/scores/leaderboard');
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  test('entries are sorted by score descending', async () => {
    const res  = await request(app).get('/api/scores/leaderboard');
    const rows = res.body;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
  });

  test('each entry has email, score, id, and created_at fields', async () => {
    const res = await request(app).get('/api/scores/leaderboard');
    for (const row of res.body) {
      expect(typeof row.email).toBe('string');
      expect(typeof row.score).toBe('number');
      expect(typeof row.id).toBe('number');
      expect(typeof row.created_at).toBe('string');
    }
  });

  test('does not require authentication', async () => {
    // No Authorization header
    const res = await request(app).get('/api/scores/leaderboard');
    expect(res.status).toBe(200);
  });

  test('highest score appears first', async () => {
    const res = await request(app).get('/api/scores/leaderboard');
    expect(res.body[0].score).toBeGreaterThanOrEqual(200);
  });
});

// ── Static file serving ────────────────────────────────────────────────────

describe('Static file serving', () => {
  test('GET / serves index.html with status 200', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toMatch(/<!DOCTYPE html>/i);
  });

  test('GET / response contains the game canvas element', async () => {
    const res = await request(app).get('/');
    expect(res.text).toMatch(/id="gameCanvas"/);
  });

  test('GET /nonexistent falls back to index.html', async () => {
    const res = await request(app).get('/some/unknown/route');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
  });
});

// ── JWT authentication middleware ──────────────────────────────────────────

describe('JWT authentication middleware', () => {
  test('Bearer prefix is required', async () => {
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', 'some-token-without-bearer')
      .send({ score: 1 });
    expect(res.status).toBe(401);
  });

  test('expired / tampered token returns 401', async () => {
    // Craft a token signed with a different secret
    const jwt = require('jsonwebtoken');
    const badToken = jwt.sign({ sub: 1, email: 'x@x.com' }, 'wrong-secret');
    const res = await request(app)
      .post('/api/scores')
      .set('Authorization', `Bearer ${badToken}`)
      .send({ score: 5 });
    expect(res.status).toBe(401);
  });
});

// ── Database schema / migration tests ─────────────────────────────────────

describe('Database schema', () => {
  test('users table exists with expected columns', () => {
    const info = db.prepare("PRAGMA table_info(users)").all();
    const cols  = info.map((c) => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('email');
    expect(cols).toContain('password_hash');
    expect(cols).toContain('created_at');
  });

  test('high_scores table exists with expected columns', () => {
    const info = db.prepare("PRAGMA table_info(high_scores)").all();
    const cols  = info.map((c) => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('score');
    expect(cols).toContain('created_at');
  });

  test('foreign key from high_scores.user_id → users.id is enforced', () => {
    expect(() => {
      db.prepare('INSERT INTO high_scores (user_id, score) VALUES (?, ?)').run(999999, 10);
    }).toThrow();
  });

  test('email column in users has a UNIQUE constraint', () => {
    const info = db.prepare("PRAGMA index_list(users)").all();
    const hasUnique = info.some((idx) => idx.unique === 1);
    expect(hasUnique).toBe(true);
  });

  test('password_hash is stored (not plain text)', async () => {
    await registerUser('hash-test@example.com', 'plainpassword');
    const row = db.prepare("SELECT password_hash FROM users WHERE email = ?")
                  .get('hash-test@example.com');
    expect(row).toBeTruthy();
    expect(row.password_hash).not.toBe('plainpassword');
    expect(row.password_hash).toMatch(/^\$2b\$/);  // bcrypt prefix
  });
});
