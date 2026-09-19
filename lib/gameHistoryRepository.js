'use strict';

/**
 * lib/gameHistoryRepository.js — thin data-access layer for GameHistory
 * (and the HighScore reads it's paired with) rows.
 *
 * Every read/write against the `gameHistory` / `highScore` Prisma models
 * that GameHistoryService needs funnels through here rather than being
 * inlined into the service or, worse, into server.js's route handlers.
 * That's the whole point of this seam: GameHistoryService describes *what*
 * a "player summary" or "recording a finished game" means; this module
 * knows *how* those map onto Prisma calls. Future history features
 * (pagination, filtering, per-mode stats) should only ever need to change
 * this file plus GameHistoryService — never the HTTP layer.
 *
 * Every method accepts an optional `client` (defaulting to the shared
 * `prisma` this repository was built with) so GameHistoryService.getSummary
 * can run the high-score lookup and the recent-games query against the same
 * interactive-transaction client (`prisma.$transaction(async (tx) => ...)`)
 * and get one consistent snapshot.
 */

function createGameHistoryRepository(prisma) {
  return {
    /** Insert one completed-game row. */
    async create({ player, score, duration, finishedAt }, client = prisma) {
      return client.gameHistory.create({
        data: {
          player,
          score,
          duration,
          finishedAt: finishedAt || new Date(),
        },
      });
    },

    /**
     * The `limit` most recent games for a player, newest first. Ties on
     * `finishedAt` (same millisecond) are broken by `id` descending so the
     * ordering is deterministic even when several games finish within the
     * same tick.
     */
    async findRecent(player, limit, client = prisma) {
      return client.gameHistory.findMany({
        where:   { player },
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        take:    limit,
      });
    },

    /** The player's current high-score row, or null if they have none. */
    async findHighScore(player, client = prisma) {
      return client.highScore.findUnique({ where: { userId: player } });
    },

    /**
     * Run `fn(tx)` inside a single Prisma transaction. Both a real
     * PrismaClient and the in-memory test fake expose `$transaction`, so
     * callers don't need to know which one they were handed.
     */
    async transaction(fn) {
      return prisma.$transaction(fn);
    },
  };
}

module.exports = { createGameHistoryRepository };
