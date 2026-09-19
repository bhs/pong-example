'use strict';

/**
 * lib/gameHistoryService.js — GameHistoryService.
 *
 * The single owner of every GameHistory read and write. server.js's
 * game-completion route (POST /api/scores) and its player-summary route
 * (GET /api/player/summary) call methods here; neither one touches
 * prisma.gameHistory or prisma.highScore directly. That keeps the
 * completion code path itself unchanged by future history features —
 * pagination, filtering, per-mode stats — since those only ever need to
 * grow this file (and lib/gameHistoryRepository.js), not the HTTP layer.
 */

const { createGameHistoryRepository } = require('./gameHistoryRepository');

const DEFAULT_RECENT_LIMIT = 10;

function createGameHistoryService(prisma) {
  const repo = createGameHistoryRepository(prisma);

  return {
    /**
     * Record one completed game. Called unconditionally from the
     * game-completion flow every time a match finishes — independent of
     * whether it happened to beat the player's stored HighScore.
     *
     * @param {{ player: string, score: number, duration: number }} game
     */
    async recordGame({ player, score, duration }) {
      return repo.create({ player, score, duration, finishedAt: new Date() });
    },

    /**
     * The combined "player summary": current high score plus the most
     * recent games, computed inside a single Prisma transaction so a
     * concurrent game completion can never produce an inconsistent
     * snapshot — e.g. a high score that already reflects the new game but
     * a history list that doesn't yet include it, or vice-versa.
     *
     * @param {string} player
     * @param {{ historyLimit?: number }} [options]
     * @returns {Promise<{ highScore: object|null, recentGames: object[] }>}
     */
    async getSummary(player, { historyLimit = DEFAULT_RECENT_LIMIT } = {}) {
      return repo.transaction(async (tx) => {
        const [highScore, recentGames] = await Promise.all([
          repo.findHighScore(player, tx),
          repo.findRecent(player, historyLimit, tx),
        ]);
        return { highScore, recentGames };
      });
    },
  };
}

module.exports = { createGameHistoryService, DEFAULT_RECENT_LIMIT };
