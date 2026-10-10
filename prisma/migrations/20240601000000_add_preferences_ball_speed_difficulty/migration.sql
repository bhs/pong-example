-- AlterTable
-- Columns are prefixed `mendel_exp_` because this table is shared by every
-- concurrently-running variation of the 'game-customization-options' hop,
-- each applying its own migration against the same database (see
-- .mendel/experiment.json). Values are validated by PUT /api/preferences:
-- ball speed is 'slow' | 'normal' | 'fast', difficulty is
-- 'easy' | 'normal' | 'hard'.
ALTER TABLE `preferences`
  ADD COLUMN `mendel_exp_ball_speed` VARCHAR(191) NOT NULL DEFAULT 'normal',
  ADD COLUMN `mendel_exp_difficulty` VARCHAR(191) NOT NULL DEFAULT 'normal';
