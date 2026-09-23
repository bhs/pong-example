-- AlterTable
-- Column is prefixed `mendel_exp_` because this table is shared by every
-- concurrently-running variation of this hop, each applying its own
-- migration against the same database (see .mendel/experiment.json).
-- Nullable, purely additive: nothing that already reads `users` observes
-- any change.
ALTER TABLE `users` ADD COLUMN `mendel_exp_nickname_inline_header_editor` VARCHAR(191) NULL;
