-- AlterTable
-- Column is prefixed `mendel_exp_` because this table is shared by every
-- concurrently-running variation of this hop, each applying its own
-- migration against the same database (see .mendel/experiment.json).
-- Tracks the timestamp of the signed-in user's most recently finished game
-- (see POST /api/scores in server.js) — defaults to NULL for players who
-- haven't finished a game since this column was added.
ALTER TABLE `users` ADD COLUMN `mendel_exp_last_played_at` DATETIME(3) NULL;
