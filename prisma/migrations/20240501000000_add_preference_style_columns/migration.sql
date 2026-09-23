-- AlterTable
-- Adds the style-preferences columns (paddle/ball/background color pickers
-- + one-click preset name — see index.html's settings pane) to the existing
-- `preferences` table. `paddleColor` already existed; `ballColor` and
-- `bgColor` get the same default it did ("#ffffff" / "#000000" — the
-- game's current hardcoded look) so existing rows read back exactly what a
-- user who has never opened the settings pane already sees, and
-- `presetName` is nullable since manually-picked colors don't correspond
-- to either built-in preset.
ALTER TABLE `preferences`
  ADD COLUMN `ballColor` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
  ADD COLUMN `bgColor` VARCHAR(191) NOT NULL DEFAULT '#000000',
  ADD COLUMN `presetName` VARCHAR(191) NULL;
