-- Migration 001: Initial schema
-- Creates the users and high_scores tables.

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL      PRIMARY KEY,
  username   VARCHAR(64) NOT NULL UNIQUE,
  password   TEXT        NOT NULL,           -- bcrypt hash
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS high_scores (
  id         SERIAL      PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER     NOT NULL CHECK (score >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_high_scores_user_id  ON high_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_high_scores_score     ON high_scores(score DESC);
