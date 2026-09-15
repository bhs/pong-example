-- Migration 001: user_preferences
-- Creates the dedicated user_preferences table used by preferencesRepo.js.
-- Lives in its own SQLite database file, separate from the ephemeral
-- users/scores store (see server.js) — style preferences are the first
-- piece of state in this app that needs to survive a process restart.

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id      TEXT PRIMARY KEY,
  paddle_color TEXT NOT NULL,
  ball_color   TEXT NOT NULL,
  bg_color     TEXT NOT NULL,
  preset_name  TEXT,
  updated_at   INTEGER NOT NULL
);
