'use strict';

const express    = require('express');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const path       = require('path');
const fs         = require('fs');

// ── Configuration ─────────────────────────────────────────────────────────
const PORT        = process.env.PORT        || 3000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'pong-dev-secret-change-in-prod';
const DB_PATH     = process.env.DB_PATH     || path.join(__dirname, 'data', 'pong.db');
const BCRYPT_ROUNDS = 10;

// ── Database setup ────────────────────────────────────────────────────────
// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    NOT NULL UNIQUE,
    password_hash TEXT   NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS high_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score      INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_high_scores_score ON high_scores(score DESC);
  CREATE INDEX IF NOT EXISTS idx_high_scores_user  ON high_scores(user_id);
`);

// ── Prepared statements ───────────────────────────────────────────────────
const stmts = {
  findUserByEmail:    db.prepare('SELECT * FROM users WHERE email = ?'),
  insertUser:         db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)'),
  insertScore:        db.prepare('INSERT INTO high_scores (user_id, score) VALUES (?, ?)'),
  leaderboard:        db.prepare(`
    SELECT hs.id, hs.score, hs.created_at, u.email
    FROM   high_scores hs
    JOIN   users u ON u.id = hs.user_id
    ORDER  BY hs.score DESC
    LIMIT  10
  `),
  userScores:         db.prepare(`
    SELECT id, score, created_at
    FROM   high_scores
    WHERE  user_id = ?
    ORDER  BY score DESC
  `),
};

// ── Express app ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Serve the public/ directory (game front-end)
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware: JWT authentication ─────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── POST /api/auth/register ───────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = stmts.findUserByEmail.get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = stmts.insertUser.run(email.toLowerCase().trim(), password_hash);

  const token = jwt.sign(
    { sub: info.lastInsertRowid, email: email.toLowerCase().trim() },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.status(201).json({ token, userId: info.lastInsertRowid });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = stmts.findUserByEmail.get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.json({ token, userId: user.id });
});

// ── POST /api/scores  (JWT-protected) ─────────────────────────────────────
app.post('/api/scores', requireAuth, (req, res) => {
  const { score } = req.body || {};

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) {
    return res.status(400).json({ error: 'score must be a non-negative integer' });
  }

  const info = stmts.insertScore.run(req.user.sub, score);

  return res.status(201).json({ id: info.lastInsertRowid, score, userId: req.user.sub });
});

// ── GET /api/scores/leaderboard ────────────────────────────────────────────
app.get('/api/scores/leaderboard', (_req, res) => {
  const rows = stmts.leaderboard.all();
  return res.json(rows);
});

// ── Fallback: serve index.html for any other GET (SPA-style) ──────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ───────────────────────────────────────────────────────────
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`Pong server listening on port ${PORT}`);
  });
}

module.exports = { app, db, stmts };
