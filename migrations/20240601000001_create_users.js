'use strict';

/**
 * users — one row per Google-authenticated identity.
 *
 * Authentication is delegated entirely to Google OAuth: there is no
 * password column, no salt column, and no bcrypt anywhere in this schema
 * or the app. `google_id` is Google's stable OAuth "sub" claim (mapped to
 * `profile.id` by passport-google-oauth20) — it is unique, and it is what
 * find-or-create-on-sign-in looks up.
 */

exports.up = function up(knex) {
  return knex.raw(`
    CREATE TABLE users (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      google_id   VARCHAR(255) NOT NULL,
      email       VARCHAR(255) NULL,
      name        VARCHAR(255) NULL,
      avatar_url  VARCHAR(1024) NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY users_google_id_unique (google_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
};

exports.down = function down(knex) {
  return knex.raw('DROP TABLE IF EXISTS users;');
};
