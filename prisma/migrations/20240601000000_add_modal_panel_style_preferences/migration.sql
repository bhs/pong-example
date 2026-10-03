-- CreateTable
-- Purely additive. Named for the 'server-authoritative-modal-panel'
-- variation of the 'user-style-preferences-pane' hop because this database
-- is shared by every concurrently-running variation, each applying its own
-- migration (see .mendel/experiment.json). Holds one row per user with the
-- paddle / ball / background colours chosen in the Preferences modal.
CREATE TABLE `modal_panel_style_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `paddleColor` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
    `ballColor` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
    `bgColor` VARCHAR(191) NOT NULL DEFAULT '#00008b',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `modal_panel_style_preferences_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `modal_panel_style_preferences` ADD CONSTRAINT `modal_panel_style_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
