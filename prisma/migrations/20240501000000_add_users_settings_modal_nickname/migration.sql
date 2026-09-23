-- AlterTable
-- Column is prefixed `mendel_exp_settings_modal_` because this table is
-- shared by every concurrently-running variation of the
-- 'player-nickname-setting' hop, each applying its own migration against the
-- same database (see .mendel/experiment.json). This is the
-- 'dedicated-settings-modal' variation's own nickname column, edited via the
-- gear-icon Settings modal (PATCH /api/user/nickname).
ALTER TABLE `users` ADD COLUMN `mendel_exp_settings_modal_nickname` VARCHAR(191) NULL;
