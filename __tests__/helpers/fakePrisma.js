'use strict';

/**
 * __tests__/helpers/fakePrisma.js
 *
 * A minimal, in-memory stand-in for a Prisma Client that implements just
 * enough of the `user` / `preference` / `highScore` / `gameHistory` model
 * APIs for server.js's routes to run against in unit tests — no real MySQL
 * instance required. Each call to createFakePrisma() returns an independent
 * set of Maps so tests don't share state.
 */

function notFoundError() {
  const err = new Error('Record to delete does not exist.');
  err.code = 'P2025';
  return err;
}

function createFakePrisma() {
  const users        = new Map(); // id -> user row
  const preferences  = new Map(); // userId -> preference row
  const highScores   = new Map(); // userId -> highScore row
  const gameHistory  = [];        // array of gameHistory rows (many per user)

  let preferenceAutoId  = 1;
  let highScoreAutoId   = 1;
  let gameHistoryAutoId = 1;

  return {
    __users: users,
    __preferences: preferences,
    __highScores: highScores,
    __gameHistory: gameHistory,

    user: {
      async findMany() {
        return [...users.values()];
      },
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
      async update({ where, data }) {
        const existing = users.get(where.id);
        if (!existing) throw notFoundError();
        const now = new Date();
        const row = { ...existing, ...data, updatedAt: now };
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
        if (orderBy) {
          rows = rows.sort(comparatorFor(orderBy));
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
        const row = { id: gameHistoryAutoId++, finishedAt: new Date(), ...data };
        gameHistory.push(row);
        return row;
      },
      async findMany({ where, orderBy, take } = {}) {
        let rows = gameHistory.slice();
        if (where && where.userId) {
          rows = rows.filter((row) => row.userId === where.userId);
        }
        if (orderBy && orderBy.finishedAt === 'desc') {
          rows = rows.sort((a, b) => b.finishedAt - a.finishedAt);
        }
        if (typeof take === 'number') {
          rows = rows.slice(0, take);
        }
        return rows;
      },
    },
  };
}

/**
 * Builds a sort comparator from a Prisma `orderBy`: either one
 * { field: 'asc' | 'desc' } object or an array of them, applied in order
 * (later keys only break ties of earlier ones). Dates compare by time.
 */
function comparatorFor(orderBy) {
  const keys = [];
  (Array.isArray(orderBy) ? orderBy : [orderBy]).forEach((clause) => {
    Object.entries(clause).forEach(([field, dir]) => keys.push([field, dir]));
  });
  const value = (v) => (v instanceof Date ? v.getTime() : (v === undefined ? 0 : v));
  return (a, b) => {
    for (const [field, dir] of keys) {
      const av = value(a[field]);
      const bv = value(b[field]);
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  };
}

function attachUser(row, include, users) {
  if (!include || !include.user) return row;
  return { ...row, user: users.get(row.userId) || null };
}

module.exports = { createFakePrisma };
