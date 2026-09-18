'use strict';

/**
 * preferences — one row per (user, key) pair, e.g. a saved paddle color or
 * a "reduce motion" toggle. `user_id` is a foreign key into users(id); the
 * whole row goes away automatically (ON DELETE CASCADE) if that user's
 * account is ever removed.
 */

exports.up = function up(knex) {
  return knex.raw(`
    CREATE TABLE preferences (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     INT UNSIGNED NOT NULL,
      pref_key    VARCHAR(191) NOT NULL,
      pref_value  TEXT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY preferences_user_id_pref_key_unique (user_id, pref_key),
      KEY preferences_user_id_index (user_id),
      CONSTRAINT preferences_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
};

exports.down = function down(knex) {
  return knex.raw('DROP TABLE IF EXISTS preferences;');
};
