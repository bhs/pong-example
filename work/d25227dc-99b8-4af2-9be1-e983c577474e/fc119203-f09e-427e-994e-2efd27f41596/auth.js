'use strict';

// ── LocalStorage Auth Module ──────────────────────────────────────────────
//
// Stores all user and score data in the browser via localStorage.
//
// Schema:
//   localStorage['pong_users']       → JSON array of { id, email, passwordHash }
//   localStorage['pong_high_scores'] → JSON array of { userId, score, createdAt }
//
// Passwords are hashed client-side with SHA-256 via the Web Crypto API so
// plaintext credentials are never persisted.

const STORAGE_USERS  = 'pong_users';
const STORAGE_SCORES = 'pong_high_scores';
const STORAGE_SESS   = 'pong_session';   // currently-logged-in userId

// ── Storage helpers ───────────────────────────────────────────────────────

/**
 * Read and parse a JSON array from localStorage.
 * Returns an empty array when the key is absent or unparseable.
 *
 * @param {string} key
 * @returns {Array}
 */
function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Serialize and write a value to localStorage.
 *
 * @param {string} key
 * @param {*}      value
 */
function writeList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Crypto helper ─────────────────────────────────────────────────────────

/**
 * Hash a plaintext string with SHA-256 via the Web Crypto API.
 * Returns a lowercase hex digest string.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const bytes   = Array.from(new Uint8Array(hashBuf));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── ID generator ─────────────────────────────────────────────────────────

/**
 * Generate a simple unique ID (timestamp + random suffix).
 *
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Auth functions ────────────────────────────────────────────────────────

/**
 * Register a new user.
 * Rejects if the email is already taken or inputs are invalid.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ id: string, email: string }>}
 */
async function register(email, password) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || password.length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }

  const users = readList(STORAGE_USERS);
  if (users.some((u) => u.email === trimmedEmail)) {
    throw new Error('An account with that email already exists.');
  }

  const passwordHash = await sha256(password);
  const newUser = { id: generateId(), email: trimmedEmail, passwordHash };
  users.push(newUser);
  writeList(STORAGE_USERS, users);

  // Auto-login after registration
  localStorage.setItem(STORAGE_SESS, newUser.id);

  return { id: newUser.id, email: newUser.email };
}

/**
 * Log in an existing user.
 * Rejects if credentials are invalid.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ id: string, email: string }>}
 */
async function login(email, password) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail || !password) {
    throw new Error('Please enter your email and password.');
  }

  const users = readList(STORAGE_USERS);
  const user  = users.find((u) => u.email === trimmedEmail);
  if (!user) {
    throw new Error('No account found with that email.');
  }

  const passwordHash = await sha256(password);
  if (passwordHash !== user.passwordHash) {
    throw new Error('Incorrect password.');
  }

  localStorage.setItem(STORAGE_SESS, user.id);
  return { id: user.id, email: user.email };
}

/**
 * Log out the current user by clearing the session key.
 */
function logout() {
  localStorage.removeItem(STORAGE_SESS);
}

/**
 * Return the currently logged-in user, or null if no session exists.
 *
 * @returns {{ id: string, email: string } | null}
 */
function getCurrentUser() {
  const userId = localStorage.getItem(STORAGE_SESS);
  if (!userId) return null;
  const users = readList(STORAGE_USERS);
  const user  = users.find((u) => u.id === userId);
  return user ? { id: user.id, email: user.email } : null;
}

// ── High-score functions ──────────────────────────────────────────────────

/**
 * Save a score for the logged-in user if it beats their current personal best.
 * Does nothing if no user is logged in.
 *
 * @param {number} score - The player's score from the just-finished game.
 * @returns {boolean}    - True when the record was updated, false otherwise.
 */
function saveScore(score) {
  const userId = localStorage.getItem(STORAGE_SESS);
  if (!userId) return false;

  const scores  = readList(STORAGE_SCORES);
  const idx     = scores.findIndex((s) => s.userId === userId);
  const existing = idx >= 0 ? scores[idx] : null;

  if (existing && existing.score >= score) return false;

  const entry = { userId, score, createdAt: new Date().toISOString() };
  if (idx >= 0) {
    scores[idx] = entry;
  } else {
    scores.push(entry);
  }
  writeList(STORAGE_SCORES, scores);
  return true;
}

/**
 * Return the top N high-score entries, sorted descending, with email labels.
 *
 * Each entry: { email: string, score: number, createdAt: string }
 *
 * @param {number} [limit=10]
 * @returns {Array<{ email: string, score: number, createdAt: string }>}
 */
function getLeaderboard(limit) {
  if (limit === undefined) limit = 10;
  const scores = readList(STORAGE_SCORES);
  const users  = readList(STORAGE_USERS);

  const userMap = {};
  users.forEach((u) => { userMap[u.id] = u.email; });

  return scores
    .map((s) => ({ email: userMap[s.userId] || 'Unknown', score: s.score, createdAt: s.createdAt }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Module export (Node / browser) ───────────────────────────────────────
//
// When loaded as a <script> the functions are attached to `window.PongAuth`
// for use by the inline game script.  When imported via require() in tests
// the module.exports block is used.

/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
  // Node / Jest environment — export pure helpers that don't depend on the
  // real Web Crypto API or localStorage (those are stubbed in tests).
  module.exports = {
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
    // Internal helpers exposed for unit testing
    readList,
    writeList,
  };
} else {
  // Browser environment — expose via global namespace
  window.PongAuth = {
    register,
    login,
    logout,
    getCurrentUser,
    saveScore,
    getLeaderboard,
  };
}
