-- AlterTable
-- Column is prefixed `mendel_exp_` because this table is shared by every
-- concurrently-running variation of this hop, each applying its own
-- migration against the same database (see .mendel/experiment.json).
ALTER TABLE `high_scores` ADD COLUMN `mendel_exp_longest_rally` INTEGER NOT NULL DEFAULT 0;
