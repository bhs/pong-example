'use strict';

/**
 * lib/leaderboard-placements/modal-from-a-button.js — the "modal-from-a-button"
 * option of the where-the-leaderboard-appears Trait (the default).
 *
 * A trophy button in the top-right auth bar opens a full-page modal listing
 * the top players (rank, player, score, longest rally), highlighting the
 * signed-in player's row. The modal itself is drawn by index.html; this
 * returns the settings the page needs to do so.
 */

const PLACEMENT = 'modal-from-a-button';
const BOARD_SIZE = 10;

function clientConfig() {
  return { placement: PLACEMENT, limit: BOARD_SIZE };
}

module.exports = { PLACEMENT, BOARD_SIZE, clientConfig };
