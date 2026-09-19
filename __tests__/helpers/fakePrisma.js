'use strict';

/**
 * __tests__/helpers/fakePrisma.js
 *
 * A minimal, in-memory stand-in for a Prisma Client that implements just
 * enough of the `user` / `preference` / `highScore` / `gameHistory` model
 * APIs (plus `$transaction`) for server.js's routes — and
 * lib/gameHistoryService.js — to run against in unit tests, no real MySQL
 * instance required. Each call to createFakePrisma() returns an
 * independent set of Maps so tests don't share state.
 */

function notFoundError() {
  const err = new Error('Record to delete does not exist.');
  err.code = 'P2025';
  return err;
}

function createFakePrisma() {
  const users       = new Map(); // id -> user row
  const preferences = new Map(); // userId -> preference row
  const highScores  = new Map(); // userId -> highScore row
  const gameHistory = []; // array of gameHistory rows

  let preferenceAutoId  = 1;
  let highScoreAutoId   = 1;
  let gameHistoryAutoId = 1;

  const client = {
    __users: users,
    __preferences: preferences,
    __highScores: highScores,
    __gameHistory: gameHistory,

    user: {
      async findUnique({ where }) {
        return users.get(where.id) || null;
      },
      async upsert({ where, update, create }) {
        const existing = users.get(where.id);
        const now = new Date();
        const row = existing
          ? { ...existing, ...update, updatedAt: now }
          : { ...create, createdAt: now, updatedAt: now };
        users.set(where.id, row);
        return row;
      },
    },

    preference: {
      async findUnique({ where }) {
        return preferences.get(where.userId) || null;
      },
      async upsert({ where, update, create }) {
        const existing = preferences.get(where.userId);
        const now = new Date();
        const row = existing
          ? { ...existing, ...update, updatedAt: now }
          : {
              id: preferenceAutoId++,
              theme: 'dark',
              soundEnabled: true,
              paddleColor: '#ffffff',
              ...create,
              createdAt: now,
              updatedAt: now,
            };
        preferences.set(where.userId, row);
        return row;
      },
    },

    highScore: {
      async findUnique({ where, include }) {
        const row = highScores.get(where.userId);
        if (!row) return null;
        return attachUser(row, include, users);
      },
      async upsert({ where, update, create }) {
        const existing = highScores.get(where.userId);
        const now = new Date();
        const row = existing
          ? { ...existing, ...update, updatedAt: now }
          : { id: highScoreAutoId++, ...create, createdAt: now, updatedAt: now };
        highScores.set(where.userId, row);
        return row;
      },
      async findMany({ orderBy, take, include } = {}) {
        let rows = Array.from(highScores.values());
        if (orderBy && orderBy.score === 'desc') {
          rows = rows.sort((a, b) => b.score - a.score);
        }
        if (typeof take === 'number') {
          rows = rows.slice(0, take);
        }
        return rows.map((row) => attachUser(row, include, users));
      },
      async delete({ where }) {
        if (!highScores.has(where.userId)) {
          throw notFoundError();
        }
        const row = highScores.get(where.userId);
        highScores.delete(where.userId);
        return row;
      },
    },

    gameHistory: {
      async create({ data }) {
        const row = {
          id: gameHistoryAutoId++,
          finishedAt: new Date(),
          ...data,
        };
        gameHistory.push(row);
        return row;
      },
      async findMany({ where, orderBy, take } = {}) {
        let rows = gameHistory;
        if (where && where.player !== undefined) {
          rows = rows.filter((row) => row.player === where.player);
        }
        // Accept either a single orderBy clause or an array of them
        // (applied in priority order) — mirrors Prisma's own API, and lets
        // callers break ties on finishedAt (same millisecond) with `id`.
        const clauses = Array.isArray(orderBy) ? orderBy : (orderBy ? [orderBy] : []);
        rows = rows.slice().sort((a, b) => {
          for (const clause of clauses) {
            const [field] = Object.keys(clause);
            const dir = clause[field] === 'asc' ? 1 : -1;
            if (a[field] < b[field]) return -1 * dir;
            if (a[field] > b[field]) return 1 * dir;
          }
          return 0;
        });
        if (clauses.length === 0) {
          rows = rows.slice().reverse(); // default: newest-inserted first
        }
        if (typeof take === 'number') {
          rows = rows.slice(0, take);
        }
        return rows;
      },
    },

    // Interactive-transaction stand-in: real Prisma passes a scoped `tx`
    // client into the callback; here we just hand back this same client,
    // since the fake stores have no isolation/locking to model anyway.
    async $transaction(fn) {
      if (typeof fn === 'function') {
        return fn(client);
      }
      // Array-of-promises form — not used by this app, but included for
      // completeness.
      return Promise.all(fn);
    },
  };

  return client;
}

function attachUser(row, include, users) {
  if (!include || !include.user) return row;
  return { ...row, user: users.get(row.userId) || null };
}

module.exports = { createFakePrisma };
