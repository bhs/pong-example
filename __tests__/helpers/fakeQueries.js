'use strict';

/**
 * __tests__/helpers/fakeQueries.js
 *
 * In-memory stand-in for db/queries.js, used only in tests so the Express
 * route logic in server.js can be exercised without a real MySQL
 * connection. Mirrors the async function signatures of the real
 * Knex-backed module exactly (same names, same argument shapes, same
 * return shapes) so createApp(fakeQueries) behaves identically to
 * createApp() from the routes' point of view.
 */

function createFakeQueries() {
  const users  = new Map(); // id -> user row
  const prefs  = new Map(); // `${userId}:${key}` -> value
  const scores = new Map(); // player -> entry

  let nextUserId  = 1;
  let nextScoreId = 1;

  async function findOrCreateUserByGoogleId({ googleId, email, name, avatar }) {
    const existing = Array.from(users.values()).find((u) => u.google_id === googleId);

    if (existing) {
      if (email) existing.email = email;
      if (name) existing.name = name;
      if (avatar) existing.avatar_url = avatar;
      return existing;
    }

    const user = {
      id:         nextUserId++,
      google_id:  googleId,
      email:      email  || null,
      name:       name   || null,
      avatar_url: avatar || null,
    };
    users.set(user.id, user);
    return user;
  }

  async function getUserById(id) {
    return users.get(id) || null;
  }

  async function getPreference(userId, key) {
    const value = prefs.get(`${userId}:${key}`);
    return value === undefined ? null : value;
  }

  async function setPreference(userId, key, value) {
    prefs.set(`${userId}:${key}`, value);
    return { key, value };
  }

  async function listHighScores(limit = 100) {
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async function getHighScore(player) {
    return scores.get(player) || null;
  }

  async function upsertHighScore(player, score, userId = null) {
    const existing = scores.get(player);

    if (!existing) {
      const entry = { id: nextScoreId++, player, score, user_id: userId };
      scores.set(player, entry);
      return { updated: true, entry };
    }

    if (score > existing.score) {
      existing.score = score;
      if (userId) existing.user_id = userId;
      return { updated: true, entry: existing };
    }

    return { updated: false, entry: existing };
  }

  async function deleteHighScore(player) {
    return scores.delete(player);
  }

  return {
    // Exposed only so tests can seed/inspect state directly, mirroring how
    // the old ephemeral-store tests poked at store.scores / store.users.
    _users:  users,
    _prefs:  prefs,
    _scores: scores,

    findOrCreateUserByGoogleId,
    getUserById,
    getPreference,
    setPreference,
    listHighScores,
    getHighScore,
    upsertHighScore,
    deleteHighScore,
  };
}

module.exports = { createFakeQueries };
