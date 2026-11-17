'use strict';

/**
 * lib/leaderboard-placement.js — chooses where the global leaderboard
 * appears (Trait "where-the-leaderboard-appears").
 *
 * The choice is read from WHERE_THE_LEADERBOARD_APPEARS when the process
 * starts serving (never at build time) and defaults to
 * "modal-from-a-button". leaderboardConfig() is the one place that reads it:
 * it calls the chosen option's code, which returns what the browser needs
 * (served by GET /api/config). Each option lives in its own file under
 * lib/leaderboard-placements/.
 */

const modalFromAButton = require('./leaderboard-placements/modal-from-a-button');
const gameOverOverlaySection = require('./leaderboard-placements/game-over-overlay-section');

const DEFAULT_PLACEMENT = modalFromAButton.PLACEMENT;

const OPTIONS = {
  [modalFromAButton.PLACEMENT]: modalFromAButton.clientConfig,
  [gameOverOverlaySection.PLACEMENT]: gameOverOverlaySection.clientConfig,
};

function leaderboardConfig(env = process.env) {
  const chosen = String(env.WHERE_THE_LEADERBOARD_APPEARS || '').trim() || DEFAULT_PLACEMENT;
  const option = OPTIONS[chosen];
  if (!option) {
    throw new Error(`Unknown leaderboard placement: ${chosen}`);
  }
  return option();
}

module.exports = { leaderboardConfig, DEFAULT_PLACEMENT };
