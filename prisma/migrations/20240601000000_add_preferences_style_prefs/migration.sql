-- AlterTable
-- Columns are prefixed `mendel_exp_style_prefs_` because this table is shared
-- by every concurrently-running variation of the 'user-style-preferences-pane'
-- hop, each applying its own migration against the same database. They back
-- the Settings modal's ball / background colour pickers and preset buttons
-- (PUT /api/preferences). The paddle colour reuses the existing
-- `paddleColor` column. Purely additive; existing rows get the defaults.
ALTER TABLE `preferences`
    ADD COLUMN `mendel_exp_style_prefs_ball_color` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
    ADD COLUMN `mendel_exp_style_prefs_bg_color` VARCHAR(191) NOT NULL DEFAULT '#00008b',
    ADD COLUMN `mendel_exp_style_prefs_preset_name` VARCHAR(191) NULL;
