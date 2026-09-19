-- CreateTable
CREATE TABLE `game_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `player` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL,
    `duration` INTEGER NOT NULL,
    `finishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `game_history_player_finishedAt_idx`(`player`, `finishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `game_history` ADD CONSTRAINT `game_history_player_fkey` FOREIGN KEY (`player`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
