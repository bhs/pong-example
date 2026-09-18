'use strict';

/**
 * high_scores — one row per player. `player` is the normalized (trimmed,
 * lowercased) identity string the API keys scores by, kept unique so
 * "upsert" is well-defined. `user_id` is an optional foreign key into
 * users(id): scores saved by a signed-in Google user are linked to their
 * account (ON DELETE SET NULL so a deleted account doesn't take its old
 * scores with it); scores saved via the legacy /api/login stub simply
 * leave it NULL. The descending index on `score` matches how the API
 * always reads this table — ordered highest-first.
 */

exports.up = function up(knex) {
  return knex.raw(`
    CREATE TABLE high_scores (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      player      VARCHAR(191) NOT NULL,
      user_id     INT UNSIGNED NULL,
      score       INT UNSIGNED NOT NULL DEFAULT 0,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY high_scores_player_unique (player),
      KEY high_scores_score_index (score DESC),
      CONSTRAINT high_scores_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
};

exports.down = function down(knex) {
  return knex.raw('DROP TABLE IF EXISTS high_scores;');
};
