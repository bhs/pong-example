'use strict';

/**
 * auth.js — JWT helpers and bcrypt wrappers
 *
 * Keeps all authentication logic in one place so it can be unit-tested
 * without spinning up the Express server or a database.
 */

const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

const SALT_ROUNDS  = 10;
const JWT_SECRET   = process.env.JWT_SECRET  || 'change-me-in-production';
const JWT_EXPIRES  = process.env.JWT_EXPIRES  || '7d';

// ── Password helpers ─────────────────────────────────────────────────────────

/**
 * Hash a plain-text password using bcrypt.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plain-text password with a stored bcrypt hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ── JWT helpers ───────────────────────────────────────────────────────────────

/**
 * Sign a JWT containing the user's id and username.
 * @param {{ id: number, username: string }} payload
 * @returns {string} signed JWT
 */
function signToken(payload) {
  return jwt.sign(
    { id: payload.id, username: payload.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * Verify and decode a JWT.
 * Throws a JsonWebTokenError if the token is invalid or expired.
 * @param {string} token
 * @returns {{ id: number, username: string, iat: number, exp: number }}
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Express middleware that validates the Authorization: Bearer <token> header.
 * Attaches the decoded payload to req.user on success.
 * Responds with 401 on failure so protected routes can rely on req.user.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  // Export for testing / overriding
  JWT_SECRET,
};
