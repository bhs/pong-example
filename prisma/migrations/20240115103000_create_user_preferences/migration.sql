-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "paddle_color" TEXT NOT NULL,
    "ball_color" TEXT NOT NULL,
    "bg_color" TEXT NOT NULL,
    "preset_name" TEXT,
    "updated_at" INTEGER NOT NULL
);
