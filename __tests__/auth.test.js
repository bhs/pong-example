'use strict';

// ── Stubs for browser globals not available in Node/Jest ─────────────────
//
// auth.js uses localStorage and crypto.subtle.digest.  We stub both here so
// the module can be tested without a real browser.

// Minimal synchronous localStorage stub backed by a plain Map.
const store = new Map();
const localStorageStub = {
  getItem:    (k)    => (store.has(k) ? store.get(k) : null),
  setItem:    (k, v) => store.set(k, String(v)),
  removeItem: (k)    => store.delete(k),
  clear:      ()     => store.clear(),
};
global.localStorage = localStorageStub;

// crypto.subtle.digest stub: returns a deterministic fake hash buffer whose
// hex representation is the UTF-8 bytes of `text` XOR'd with 0xA5.
// This lets us produce different "hashes" for different inputs without real SHA-256.
global.crypto = {
  subtle: {
    digest: async (_algorithm, data) => {
      // data is a Uint8Array (from TextEncoder).  Produce a fake 32-byte digest.
      const bytes = Array.from(data).map((b) => (b ^ 0xa5) & 0xff);
      // Pad or truncate to 32 bytes so the hex string always has 64 chars.
      while (bytes.length < 32) bytes.push(0);
      return new Uint8Array(bytes.slice(0, 32)).buffer;
    },
  },
};

// TextEncoder is available in modern Node but guard just in case.
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = require('util').TextEncoder;
}
if (typeof global.Uint8Array === 'undefined') {
  global.Uint8Array = require('util').types;
}

// ── Load module after stubs are in place ─────────────────────────────────
const {
  STORAGE_USERS,
  STORAGE_SCORES,
  STORAGE_SESS,
  sha256,
  generateId,
  register,
  login,
  logout,
  getCurrentUser,
  saveScore,
  getLeaderboard,
  readList,
  writeList,
} = require('../auth');

// ── Helpers ───────────────────────────────────────────────────────────────

/** Reset localStorage between tests. */
beforeEach(() => {
  store.clear();
});

// ── readList / writeList ──────────────────────────────────────────────────

describe('readList', () => {
  test('returns empty array when key is absent', () => {
    expect(readList('missing')).toEqual([]);
  });

  test('returns parsed array when key exists', () => {
    localStorage.setItem('test_key', JSON.stringify([1, 2, 3]));
    expect(readList('test_key')).toEqual([1, 2, 3]);
  });

  test('returns empty array on malformed JSON', () => {
    localStorage.setItem('bad_key', 'not json {{{');
    expect(readList('bad_key')).toEqual([]);
  });

  test('returns empty array when stored value is not an array', () => {
    localStorage.setItem('obj_key', JSON.stringify({ a: 1 }));
    expect(readList('obj_key')).toEqual([]);
  });
});

describe('writeList', () => {
  test('stores value as JSON string', () => {
    writeList('wl_key', [{ x: 1 }]);
    expect(localStorage.getItem('wl_key')).toBe(JSON.stringify([{ x: 1 }]));
  });

  test('stored value can be read back via readList', () => {
    const data = [{ id: 'abc', email: 'a@b.com' }];
    writeList('rw_key', data);
    expect(readList('rw_key')).toEqual(data);
  });
});

// ── sha256 ────────────────────────────────────────────────────────────────

describe('sha256', () => {
  test('returns a string', async () => {
    const result = await sha256('hello');
    expect(typeof result).toBe('string');
  });

  test('returns 64 hex characters (32 bytes)', async () => {
    const result = await sha256('test');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same input always produces same output', async () => {
    const a = await sha256('password123');
    const b = await sha256('password123');
    expect(a).toBe(b);
  });

  test('different inputs produce different outputs', async () => {
    const a = await sha256('password1');
    const b = await sha256('password2');
    expect(a).not.toBe(b);
  });
});

// ── generateId ────────────────────────────────────────────────────────────

describe('generateId', () => {
  test('returns a non-empty string', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });

  test('successive calls return different values', () => {
    const ids = new Set(Array.from({ length: 50 }, generateId));
    expect(ids.size).toBe(50);
  });
});

// ── register ──────────────────────────────────────────────────────────────

describe('register', () => {
  test('registers a new user and returns id + email', async () => {
    const user = await register('alice@example.com', 'pass1234');
    expect(user.email).toBe('alice@example.com');
    expect(typeof user.id).toBe('string');
  });

  test('stores user in localStorage users list', async () => {
    await register('bob@example.com', 'pass1234');
    const users = readList(STORAGE_USERS);
    expect(users.some((u) => u.email === 'bob@example.com')).toBe(true);
  });

  test('does not store plaintext password', async () => {
    await register('charlie@example.com', 'secret99');
    const raw = localStorage.getItem(STORAGE_USERS) || '';
    expect(raw).not.toContain('secret99');
  });

  test('stores a passwordHash, not the password', async () => {
    await register('dana@example.com', 'mypassword');
    const users = readList(STORAGE_USERS);
    const user  = users.find((u) => u.email === 'dana@example.com');
    expect(user).toBeDefined();
    expect(user.passwordHash).toBeDefined();
    expect(user.passwordHash).not.toBe('mypassword');
  });

  test('auto-logs in after registration (sets session)', async () => {
    const user = await register('erin@example.com', 'pass1234');
    expect(localStorage.getItem(STORAGE_SESS)).toBe(user.id);
  });

  test('normalises email to lowercase', async () => {
    const user = await register('FRANK@EXAMPLE.COM', 'pass1234');
    expect(user.email).toBe('frank@example.com');
  });

  test('trims whitespace from email', async () => {
    const user = await register('  grace@example.com  ', 'pass1234');
    expect(user.email).toBe('grace@example.com');
  });

  test('throws when email is invalid (no @)', async () => {
    await expect(register('notanemail', 'pass1234')).rejects.toThrow();
  });

  test('throws when email is empty', async () => {
    await expect(register('', 'pass1234')).rejects.toThrow();
  });

  test('throws when password is shorter than 4 characters', async () => {
    await expect(register('hank@example.com', 'ab')).rejects.toThrow();
  });

  test('throws when email is already registered', async () => {
    await register('irene@example.com', 'pass1234');
    await expect(register('irene@example.com', 'otherpass')).rejects.toThrow();
  });

  test('allows two different users to register', async () => {
    await register('jane@example.com', 'pass1234');
    const user2 = await register('jack@example.com', 'pass5678');
    const users = readList(STORAGE_USERS);
    expect(users.length).toBe(2);
    expect(user2.email).toBe('jack@example.com');
  });
});

// ── login ─────────────────────────────────────────────────────────────────

describe('login', () => {
  beforeEach(async () => {
    // Seed one user
    await register('kate@example.com', 'correctpass');
    // Clear session to simulate a fresh browser session
    localStorage.removeItem(STORAGE_SESS);
  });

  test('returns user object on correct credentials', async () => {
    const user = await login('kate@example.com', 'correctpass');
    expect(user.email).toBe('kate@example.com');
    expect(typeof user.id).toBe('string');
  });

  test('sets session in localStorage on success', async () => {
    const user = await login('kate@example.com', 'correctpass');
    expect(localStorage.getItem(STORAGE_SESS)).toBe(user.id);
  });

  test('is case-insensitive for email', async () => {
    const user = await login('KATE@EXAMPLE.COM', 'correctpass');
    expect(user.email).toBe('kate@example.com');
  });

  test('throws on wrong password', async () => {
    await expect(login('kate@example.com', 'wrongpass')).rejects.toThrow();
  });

  test('throws when email not found', async () => {
    await expect(login('nobody@example.com', 'pass')).rejects.toThrow();
  });

  test('throws when email is empty', async () => {
    await expect(login('', 'correctpass')).rejects.toThrow();
  });

  test('throws when password is empty', async () => {
    await expect(login('kate@example.com', '')).rejects.toThrow();
  });

  test('does not set session on failed login', async () => {
    try { await login('kate@example.com', 'wrong'); } catch (_) {}
    expect(localStorage.getItem(STORAGE_SESS)).toBeNull();
  });
});

// ── logout ────────────────────────────────────────────────────────────────

describe('logout', () => {
  test('clears the session key', async () => {
    await register('leo@example.com', 'pass1234');
    expect(localStorage.getItem(STORAGE_SESS)).not.toBeNull();
    logout();
    expect(localStorage.getItem(STORAGE_SESS)).toBeNull();
  });

  test('is safe to call when no session exists', () => {
    expect(() => logout()).not.toThrow();
  });
});

// ── getCurrentUser ────────────────────────────────────────────────────────

describe('getCurrentUser', () => {
  test('returns null when no session', () => {
    expect(getCurrentUser()).toBeNull();
  });

  test('returns user after login', async () => {
    const registered = await register('mia@example.com', 'pass1234');
    const current    = getCurrentUser();
    expect(current).not.toBeNull();
    expect(current.email).toBe('mia@example.com');
    expect(current.id).toBe(registered.id);
  });

  test('returns null after logout', async () => {
    await register('ned@example.com', 'pass1234');
    logout();
    expect(getCurrentUser()).toBeNull();
  });

  test('does not expose passwordHash', async () => {
    await register('olive@example.com', 'pass1234');
    const current = getCurrentUser();
    expect(current.passwordHash).toBeUndefined();
  });

  test('returns null when session userId references missing user', () => {
    localStorage.setItem(STORAGE_SESS, 'nonexistent_id');
    expect(getCurrentUser()).toBeNull();
  });
});

// ── saveScore ─────────────────────────────────────────────────────────────

describe('saveScore', () => {
  test('returns false when no user is logged in', () => {
    expect(saveScore(5)).toBe(false);
  });

  test('saves a new score when none exists', async () => {
    await register('pat@example.com', 'pass1234');
    const saved = saveScore(5);
    expect(saved).toBe(true);
    const scores = readList(STORAGE_SCORES);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5);
  });

  test('updates score when new score is higher', async () => {
    await register('quinn@example.com', 'pass1234');
    saveScore(3);
    const updated = saveScore(6);
    expect(updated).toBe(true);
    const scores = readList(STORAGE_SCORES);
    expect(scores[0].score).toBe(6);
    expect(scores.length).toBe(1);
  });

  test('does not update score when new score is equal', async () => {
    await register('ray@example.com', 'pass1234');
    saveScore(5);
    const updated = saveScore(5);
    expect(updated).toBe(false);
    const scores = readList(STORAGE_SCORES);
    expect(scores.length).toBe(1);
  });

  test('does not update score when new score is lower', async () => {
    await register('sue@example.com', 'pass1234');
    saveScore(7);
    const updated = saveScore(3);
    expect(updated).toBe(false);
    const scores = readList(STORAGE_SCORES);
    expect(scores[0].score).toBe(7);
  });

  test('stores createdAt as ISO date string', async () => {
    await register('tom@example.com', 'pass1234');
    saveScore(4);
    const scores = readList(STORAGE_SCORES);
    expect(scores[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('each user gets their own score entry', async () => {
    await register('user1@example.com', 'pass1234');
    saveScore(5);
    logout();
    await register('user2@example.com', 'pass5678');
    saveScore(7);

    const scores = readList(STORAGE_SCORES);
    expect(scores.length).toBe(2);
  });
});

// ── getLeaderboard ────────────────────────────────────────────────────────

describe('getLeaderboard', () => {
  test('returns an empty array when no scores exist', () => {
    expect(getLeaderboard()).toEqual([]);
  });

  test('returns at most 10 entries by default', async () => {
    // Create 12 users each with a score
    for (let i = 0; i < 12; i++) {
      await register(`lb${i}@example.com`, 'pass1234');
      saveScore(i + 1);
      logout();
    }
    const board = getLeaderboard();
    expect(board.length).toBe(10);
  });

  test('returns entries sorted by score descending', async () => {
    await register('aa@example.com', 'pass1234');
    saveScore(3);
    logout();
    await register('bb@example.com', 'pass1234');
    saveScore(7);
    logout();
    await register('cc@example.com', 'pass1234');
    saveScore(1);

    const board = getLeaderboard();
    expect(board[0].score).toBe(7);
    expect(board[1].score).toBe(3);
    expect(board[2].score).toBe(1);
  });

  test('each entry has email, score, createdAt properties', async () => {
    await register('dee@example.com', 'pass1234');
    saveScore(5);

    const board = getLeaderboard();
    expect(board[0]).toHaveProperty('email');
    expect(board[0]).toHaveProperty('score');
    expect(board[0]).toHaveProperty('createdAt');
  });

  test('email in entry matches registered email', async () => {
    await register('eve@example.com', 'pass1234');
    saveScore(5);

    const board = getLeaderboard();
    expect(board[0].email).toBe('eve@example.com');
  });

  test('respects custom limit argument', async () => {
    await register('fa@example.com', 'pass1234');
    saveScore(3);
    logout();
    await register('fb@example.com', 'pass1234');
    saveScore(6);

    const board = getLeaderboard(1);
    expect(board.length).toBe(1);
    expect(board[0].score).toBe(6);
  });
});

// ── index.html auth integration checks ───────────────────────────────────

describe('index.html auth integration', () => {
  const fs   = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  test('loads auth.js via a <script src> tag', () => {
    expect(html).toMatch(/src=["']auth\.js["']/);
  });

  test('references PongAuth.saveScore', () => {
    expect(html).toMatch(/auth\.saveScore|PongAuth\.saveScore/);
  });

  test('references PongAuth.getLeaderboard', () => {
    expect(html).toMatch(/auth\.getLeaderboard|PongAuth\.getLeaderboard|getLeaderboard/);
  });

  test('references PongAuth.getCurrentUser', () => {
    expect(html).toMatch(/auth\.getCurrentUser|PongAuth\.getCurrentUser|getCurrentUser/);
  });

  test('contains auth overlay element with id pong-auth-overlay', () => {
    expect(html).toMatch(/pong-auth-overlay/);
  });

  test('contains leaderboard element with id pong-leaderboard', () => {
    expect(html).toMatch(/pong-leaderboard/);
  });

  test('contains Sign In button', () => {
    expect(html).toMatch(/Sign In/);
  });

  test('contains Sign Up button', () => {
    expect(html).toMatch(/Sign Up/);
  });

  test('contains email input for auth form', () => {
    expect(html).toMatch(/type.*email|email.*type/);
  });

  test('contains password input for auth form', () => {
    expect(html).toMatch(/type.*password|password.*type/);
  });

  test('contains logout functionality', () => {
    expect(html).toMatch(/logout|Logout/i);
  });

  test('contains status bar element', () => {
    expect(html).toMatch(/pong-status-bar/);
  });

  test('contains new best score notification', () => {
    expect(html).toMatch(/new.*best|New.*best|personal best/i);
  });

  test('contains leaderboard heading text', () => {
    expect(html).toMatch(/Leaderboard/i);
  });

  test('still passes original canvas checks', () => {
    expect(html).toMatch(/id="gameCanvas"/);
    expect(html).toMatch(/requestAnimationFrame/);
    expect(html).toMatch(/ball\.angle/);
    expect(html).toMatch(/ball\.speed/);
    expect(html).toMatch(/flashFrames/);
    expect(html).toMatch(/rallyCount/);
    expect(html).toMatch(/AI_LERP_RALLY_INC/);
  });
});
