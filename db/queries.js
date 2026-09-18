'use strict';

/**
 * db/queries.js — thin Knex query functions backing the Express routes in
 * server.js.
 *
 * Every function here maps directly onto one (or a small, obvious pair of)
 * SQL statement(s) against the users / preferences / high_scores tables
 * created in ../migrations. There is no ORM layer, no model classes, and
 * no query logic duplicated elsewhere — this module is the single place
 * that talks to MySQL.
 */

const knex = require('./knex');

// ── users ───────────────────────────────────────────────────────────────

/**
 * Find-or-create a user by Google's stable OAuth "sub" id. This is the
 * only way a user row ever comes into existence — there is no signup
 * form and no password, because authentication is delegated entirely to
 * Google. On repeat sign-ins, freshly-supplied profile fields (email,
 * name, avatar) overwrite whatever was stored before.
 */
async function findOrCreateUserByGoogleId({ googleId, email, name, avatar }) {
  const existing = await knex('users').where({ google_id: googleId }).first();

  if (existing) {
    const updates = {};
    if (email && email !== existing.email) updates.email = email;
    if (name && name !== existing.name) updates.name = name;
    if (avatar && avatar !== existing.avatar_url) updates.avatar_url = avatar;

    if (Object.keys(updates).length > 0) {
      await knex('users').where({ id: existing.id }).update(updates);
      return { ...existing, ...updates };
    }
    return existing;
  }

  const [id] = await knex('users').insert({
    google_id:  googleId,
    email:      email  || null,
    name:       name   || null,
    avatar_url: avatar || null,
  });

  return knex('users').where({ id }).first();
}

async function getUserById(id) {
  const user = await knex('users').where({ id }).first();
  return user || null;
}

// ── preferences ─────────────────────────────────────────────────────────

async function getPreference(userId, key) {
  const row = await knex('preferences')
    .where({ user_id: userId, pref_key: key })
    .first();

  return row ? row.pref_value : null;
}

async function setPreference(userId, key, value) {
  const existing = await knex('preferences')
    .where({ user_id: userId, pref_key: key })
    .first();

  if (existing) {
    await knex('preferences').where({ id: existing.id }).update({ pref_value: value });
  } else {
    await knex('preferences').insert({ user_id: userId, pref_key: key, pref_value: value });
  }

  return { key, value };
}

// ── high scores ─────────────────────────────────────────────────────────

async function listHighScores(limit = 100) {
  return knex('high_scores').orderBy('score', 'desc').limit(limit);
}

async function getHighScore(player) {
  const row = await knex('high_scores').where({ player }).first();
  return row || null;
}

/**
 * Create or update (upsert) a high score for `player`. Only updates if
 * the new score is strictly higher than the one on record — same rule the
 * ephemeral-store version of this app used.
 */
async function upsertHighScore(player, score, userId = null) {
  const existing = await knex('high_scores').where({ player }).first();

  if (!existing) {
    const [id] = await knex('high_scores').insert({ player, score, user_id: userId });
    const entry = await knex('high_scores').where({ id }).first();
    return { updated: true, entry };
  }

  if (score > existing.score) {
    await knex('high_scores')
      .where({ id: existing.id })
      .update({ score, user_id: userId || existing.user_id });
    const entry = await knex('high_scores').where({ id: existing.id }).first();
    return { updated: true, entry };
  }

  return { updated: false, entry: existing };
}

async function deleteHighScore(player) {
  const deletedCount = await knex('high_scores').where({ player }).del();
  return deletedCount > 0;
}

module.exports = {
  findOrCreateUserByGoogleId,
  getUserById,
  getPreference,
  setPreference,
  listHighScores,
  getHighScore,
  upsertHighScore,
  deleteHighScore,
};
