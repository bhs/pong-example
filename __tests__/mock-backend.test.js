'use strict';

// ── MockBackend (extracted for testing) ──────────────────────────────────────
//
// The MockBackend class is defined inline in index.html (a single-file app
// with no build step).  We duplicate it here verbatim so Jest can exercise it
// in Node 20, which ships globalThis.crypto with crypto.subtle support.
//
// If you ever extract MockBackend to its own module, replace this block with:
//   const { MockBackend } = require('../mock-backend');

class MockBackend {
  constructor() {
    this._users  = new Map();
    this._scores = [];
    this._nextId = 1;
  }

  async _hashPassword(password) {
    const encoded = new TextEncoder().encode(password);
    return crypto.subtle.digest('SHA-256', encoded);
  }

  _buffersEqual(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) {
      diff |= va[i] ^ vb[i];
    }
    return diff === 0;
  }

  _makeToken(userId, email) {
    const raw = `${userId}:${email}`;
    return btoa(raw);
  }

  _decodeToken(token) {
    try {
      const raw   = atob(token);
      const colon = raw.indexOf(':');
      if (colon === -1) return null;
      const userId = parseInt(raw.slice(0, colon), 10);
      const email  = raw.slice(colon + 1);
      return { userId, email };
    } catch (_) {
      return null;
    }
  }

  async register(email, password) {
    if (!email || !password) {
      return { ok: false, error: 'Email and password are required.' };
    }
    if (this._users.has(email)) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    const passwordHash = await this._hashPassword(password);
    const id = this._nextId++;
    this._users.set(email, { id, email, passwordHash });
    return { ok: true };
  }

  async login(email, password) {
    if (!email || !password) {
      return { ok: false, error: 'Email and password are required.' };
    }
    const user = this._users.get(email);
    if (!user) {
      return { ok: false, error: 'Invalid email or password.' };
    }
    const hash = await this._hashPassword(password);
    if (!this._buffersEqual(hash, user.passwordHash)) {
      return { ok: false, error: 'Invalid email or password.' };
    }
    const token = this._makeToken(user.id, user.email);
    return { ok: true, token };
  }

  async getScores() {
    const sorted = this._scores
      .slice()
      .sort((a, b) => b.score - a.score || new Date(b.date) - new Date(a.date))
      .slice(0, 10)
      .map(({ email, score, date }) => ({ email, score, date }));
    return { ok: true, scores: sorted };
  }

  async postScore(token, score) {
    if (!token) {
      return { ok: false, error: 'Not authenticated.' };
    }
    const decoded = this._decodeToken(token);
    if (!decoded) {
      return { ok: false, error: 'Invalid token.' };
    }
    const { email } = decoded;
    if (!this._users.has(email)) {
      return { ok: false, error: 'User not found.' };
    }
    this._scores.push({
      userId: decoded.userId,
      email,
      score: Number(score),
      date: new Date().toISOString(),
    });
    return { ok: true };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a fresh backend and a registered+logged-in user with their token. */
async function makeAuthenticatedBackend(email = 'test@example.com', password = 'hunter2') {
  const b = new MockBackend();
  await b.register(email, password);
  const { token } = await b.login(email, password);
  return { b, token, email, password };
}

// ── register ──────────────────────────────────────────────────────────────────

describe('MockBackend.register', () => {
  test('returns ok:true for a valid new user', async () => {
    const b = new MockBackend();
    const result = await b.register('alice@example.com', 'password123');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('returns ok:false when email is missing', async () => {
    const b = new MockBackend();
    const result = await b.register('', 'password123');
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('returns ok:false when password is missing', async () => {
    const b = new MockBackend();
    const result = await b.register('alice@example.com', '');
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('returns ok:false for duplicate email', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'password123');
    const result = await b.register('alice@example.com', 'different');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  test('allows two different users to register', async () => {
    const b = new MockBackend();
    const r1 = await b.register('alice@example.com', 'pass1');
    const r2 = await b.register('bob@example.com',   'pass2');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  test('stores passwords as hashes (not plaintext)', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'password123');
    const user = b._users.get('alice@example.com');
    // passwordHash must be an ArrayBuffer, not the raw string
    expect(user.passwordHash).toBeInstanceOf(ArrayBuffer);
    expect(user.passwordHash).not.toBe('password123');
  });
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('MockBackend.login', () => {
  test('returns ok:true and a token on correct credentials', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'password123');
    const result = await b.login('alice@example.com', 'password123');
    expect(result.ok).toBe(true);
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
  });

  test('returns ok:false for unknown email', async () => {
    const b = new MockBackend();
    const result = await b.login('nobody@example.com', 'password');
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('returns ok:false for wrong password', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'correcthorsebatterystaple');
    const result = await b.login('alice@example.com', 'wrongpassword');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });

  test('returns ok:false when email is missing', async () => {
    const b = new MockBackend();
    const result = await b.login('', 'password123');
    expect(result.ok).toBe(false);
  });

  test('returns ok:false when password is missing', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'password123');
    const result = await b.login('alice@example.com', '');
    expect(result.ok).toBe(false);
  });

  test('token is different for different users', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'pass1');
    await b.register('bob@example.com',   'pass2');
    const r1 = await b.login('alice@example.com', 'pass1');
    const r2 = await b.login('bob@example.com',   'pass2');
    expect(r1.token).not.toBe(r2.token);
  });

  test('token is base64-decodable and encodes user identity', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'pass');
    const { token } = await b.login('alice@example.com', 'pass');
    const decoded = atob(token);
    expect(decoded).toContain('alice@example.com');
  });

  test('error message does not reveal whether email or password is wrong', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'correctPassword');
    const badEmail = await b.login('unknown@example.com', 'somepassword');
    const badPass  = await b.login('alice@example.com',   'wrongpassword');
    // Both errors should be the same generic message
    expect(badEmail.error).toBe(badPass.error);
  });

  test('same user can log in multiple times (each login returns a valid token)', async () => {
    const b = new MockBackend();
    await b.register('alice@example.com', 'pass');
    const r1 = await b.login('alice@example.com', 'pass');
    const r2 = await b.login('alice@example.com', 'pass');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.token).toBe(r2.token); // deterministic token generation
  });
});

// ── postScore ─────────────────────────────────────────────────────────────────

describe('MockBackend.postScore', () => {
  test('returns ok:true for authenticated user with valid score', async () => {
    const { b, token } = await makeAuthenticatedBackend();
    const result = await b.postScore(token, 7);
    expect(result.ok).toBe(true);
  });

  test('returns ok:false when token is null', async () => {
    const b = new MockBackend();
    const result = await b.postScore(null, 7);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('returns ok:false for malformed / garbage token', async () => {
    const b = new MockBackend();
    const result = await b.postScore('not-a-valid-token!!!!!', 7);
    expect(result.ok).toBe(false);
  });

  test('score is stored and retrievable via getScores', async () => {
    const { b, token, email } = await makeAuthenticatedBackend();
    await b.postScore(token, 5);
    const { scores } = await b.getScores();
    expect(scores.some((s) => s.email === email && s.score === 5)).toBe(true);
  });

  test('score is converted to a number', async () => {
    const { b, token, email } = await makeAuthenticatedBackend();
    await b.postScore(token, '7');  // string input
    const { scores } = await b.getScores();
    const entry = scores.find((s) => s.email === email);
    expect(typeof entry.score).toBe('number');
    expect(entry.score).toBe(7);
  });

  test('multiple scores from the same user are all stored', async () => {
    const { b, token, email } = await makeAuthenticatedBackend();
    await b.postScore(token, 3);
    await b.postScore(token, 6);
    const { scores } = await b.getScores();
    const userScores = scores.filter((s) => s.email === email);
    expect(userScores.length).toBe(2);
  });
});

// ── getScores ─────────────────────────────────────────────────────────────────

describe('MockBackend.getScores', () => {
  test('returns ok:true with an empty array when no scores exist', async () => {
    const b = new MockBackend();
    const result = await b.getScores();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.scores)).toBe(true);
    expect(result.scores).toHaveLength(0);
  });

  test('scores are sorted by score descending', async () => {
    const b = new MockBackend();
    await b.register('a@x.com', 'p');
    await b.register('b@x.com', 'p');
    await b.register('c@x.com', 'p');
    const ta = (await b.login('a@x.com', 'p')).token;
    const tb = (await b.login('b@x.com', 'p')).token;
    const tc = (await b.login('c@x.com', 'p')).token;
    await b.postScore(ta, 3);
    await b.postScore(tb, 7);
    await b.postScore(tc, 5);
    const { scores } = await b.getScores();
    expect(scores[0].score).toBe(7);
    expect(scores[1].score).toBe(5);
    expect(scores[2].score).toBe(3);
  });

  test('returns at most 10 scores', async () => {
    const b = new MockBackend();
    for (let i = 0; i < 15; i++) {
      const email = `user${i}@example.com`;
      await b.register(email, 'pass');
      const { token } = await b.login(email, 'pass');
      await b.postScore(token, i);
    }
    const { scores } = await b.getScores();
    expect(scores.length).toBeLessThanOrEqual(10);
  });

  test('each score entry has email, score, and date fields', async () => {
    const { b, token } = await makeAuthenticatedBackend();
    await b.postScore(token, 4);
    const { scores } = await b.getScores();
    const [entry] = scores;
    expect(typeof entry.email).toBe('string');
    expect(typeof entry.score).toBe('number');
    expect(typeof entry.date).toBe('string');
  });

  test('scores do not expose internal userId', async () => {
    const { b, token } = await makeAuthenticatedBackend();
    await b.postScore(token, 4);
    const { scores } = await b.getScores();
    expect(scores[0].userId).toBeUndefined();
  });
});

// ── _makeToken / _decodeToken ─────────────────────────────────────────────────

describe('MockBackend token helpers', () => {
  test('_makeToken returns a non-empty string', () => {
    const b = new MockBackend();
    const token = b._makeToken(1, 'alice@example.com');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('_decodeToken round-trips _makeToken', () => {
    const b = new MockBackend();
    const token   = b._makeToken(42, 'bob@example.com');
    const decoded = b._decodeToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.userId).toBe(42);
    expect(decoded.email).toBe('bob@example.com');
  });

  test('_decodeToken returns null for a garbage string', () => {
    const b = new MockBackend();
    // atob will throw on invalid base64 → should catch and return null
    expect(b._decodeToken('not!!base64@@@')).toBeNull();
  });

  test('_decodeToken returns null when colon separator is absent', () => {
    const b = new MockBackend();
    // Valid base64 but no colon inside
    const token = btoa('nocolonseparator');
    expect(b._decodeToken(token)).toBeNull();
  });
});

// ── _buffersEqual ─────────────────────────────────────────────────────────────

describe('MockBackend._buffersEqual', () => {
  function makeBuffer(...bytes) {
    return new Uint8Array(bytes).buffer;
  }

  test('returns true for identical buffers', () => {
    const b  = new MockBackend();
    const a1 = makeBuffer(1, 2, 3);
    const a2 = makeBuffer(1, 2, 3);
    expect(b._buffersEqual(a1, a2)).toBe(true);
  });

  test('returns false for buffers with different content', () => {
    const b  = new MockBackend();
    const a1 = makeBuffer(1, 2, 3);
    const a2 = makeBuffer(1, 2, 4);
    expect(b._buffersEqual(a1, a2)).toBe(false);
  });

  test('returns false for buffers of different lengths', () => {
    const b  = new MockBackend();
    const a1 = makeBuffer(1, 2, 3);
    const a2 = makeBuffer(1, 2);
    expect(b._buffersEqual(a1, a2)).toBe(false);
  });

  test('returns true for two empty buffers', () => {
    const b  = new MockBackend();
    expect(b._buffersEqual(makeBuffer(), makeBuffer())).toBe(true);
  });
});

// ── Full register → login → postScore → getScores flow ───────────────────────

describe('full auth + score flow', () => {
  test('register, login, post a score, and retrieve it from the leaderboard', async () => {
    const b = new MockBackend();

    const regResult = await b.register('player@game.com', 'supersecret');
    expect(regResult.ok).toBe(true);

    const loginResult = await b.login('player@game.com', 'supersecret');
    expect(loginResult.ok).toBe(true);
    const { token } = loginResult;

    const postResult = await b.postScore(token, 7);
    expect(postResult.ok).toBe(true);

    const { ok, scores } = await b.getScores();
    expect(ok).toBe(true);
    expect(scores).toHaveLength(1);
    expect(scores[0].email).toBe('player@game.com');
    expect(scores[0].score).toBe(7);
  });

  test('two players compete; leaderboard shows highest score first', async () => {
    const b = new MockBackend();

    await b.register('winner@game.com', 'win');
    await b.register('loser@game.com',  'lose');

    const { token: winnerToken } = await b.login('winner@game.com', 'win');
    const { token: loserToken  } = await b.login('loser@game.com',  'lose');

    await b.postScore(loserToken,  3);
    await b.postScore(winnerToken, 7);

    const { scores } = await b.getScores();
    expect(scores[0].email).toBe('winner@game.com');
    expect(scores[1].email).toBe('loser@game.com');
  });

  test('postScore with a used-then-cleared token still validates user via stored record', async () => {
    // Tokens are stateless — derived only from userId + email.
    // As long as the user record exists in _users, the token stays valid.
    const { b, token, email } = await makeAuthenticatedBackend('p@x.com', 'abc');
    const result = await b.postScore(token, 4);
    expect(result.ok).toBe(true);
    const { scores } = await b.getScores();
    expect(scores[0].email).toBe(email);
  });
});

// ── index.html MockBackend presence checks ────────────────────────────────────

describe('index.html MockBackend integration', () => {
  const fs   = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  test('defines a MockBackend class', () => {
    expect(html).toMatch(/class MockBackend/);
  });

  test('MockBackend has a register method', () => {
    expect(html).toMatch(/async register\s*\(/);
  });

  test('MockBackend has a login method', () => {
    expect(html).toMatch(/async login\s*\(/);
  });

  test('MockBackend has a getScores method', () => {
    expect(html).toMatch(/async getScores\s*\(/);
  });

  test('MockBackend has a postScore method', () => {
    expect(html).toMatch(/async postScore\s*\(/);
  });

  test('uses Web Crypto API (crypto.subtle) for password hashing', () => {
    expect(html).toMatch(/crypto\.subtle\.digest/);
  });

  test('creates a module-level backend instance', () => {
    expect(html).toMatch(/const backend = new MockBackend\(\)/);
  });

  test('shows an auth overlay on load', () => {
    expect(html).toMatch(/showAuthOverlay/);
  });

  test('auth overlay has email and password inputs', () => {
    expect(html).toMatch(/type.*email|email.*type/);
    expect(html).toMatch(/type.*password|password.*type/);
  });

  test('auth overlay has a Log In button', () => {
    expect(html).toMatch(/Log In/);
  });

  test('auth overlay has a Register button', () => {
    expect(html).toMatch(/Register/);
  });

  test('supports guest play (skip / play as guest)', () => {
    expect(html).toMatch(/Guest|guest/);
  });

  test('calls backend.postScore in the game-over overlay', () => {
    expect(html).toMatch(/backend\.postScore/);
  });

  test('calls backend.getScores to render a leaderboard', () => {
    expect(html).toMatch(/backend\.getScores/);
  });

  test('calls backend.login in the auth flow', () => {
    expect(html).toMatch(/backend\.login/);
  });

  test('calls backend.register in the auth flow', () => {
    expect(html).toMatch(/backend\.register/);
  });

  test('has an auth state object (auth.token)', () => {
    expect(html).toMatch(/auth\.token/);
  });

  test('renders a leaderboard in the game-over overlay', () => {
    expect(html).toMatch(/leaderboard/i);
  });

  test('starts the game loop after auth overlay is dismissed', () => {
    expect(html).toMatch(/showAuthOverlay\(\)\.then/);
  });
});
