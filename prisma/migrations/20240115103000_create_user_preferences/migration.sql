-- CreateTable
--
-- MySQL DDL (production is MySQL 8.4, applied via `prisma migrate deploy` —
-- see prisma/schema.prisma). No double-quoted identifiers (that's SQLite/
-- Postgres syntax; MySQL's ANSI_QUOTES mode is not assumed to be on), and
-- every VARCHAR carries an explicit length, which MySQL requires and SQLite
-- does not.
CREATE TABLE user_preferences (
    user_id      VARCHAR(191) NOT NULL,
    paddle_color VARCHAR(7) NOT NULL,
    ball_color   VARCHAR(7) NOT NULL,
    bg_color     VARCHAR(7) NOT NULL,
    preset_name  VARCHAR(50) NULL,
    updated_at   BIGINT NOT NULL,

    PRIMARY KEY (user_id)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;
