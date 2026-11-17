'use strict';

/**
 * lib/leaderboard-placements/game-over-overlay-section.js — the
 * "game-over-overlay-section" option of the where-the-leaderboard-appears
 * Trait.
 *
 * The game-over overlay inside the cabinet screen gains a compact top-5 list
 * under the personal best line, refreshed after the score POST resolves, with
 * the signed-in player's row highlighted. The list is drawn by index.html;
 * this returns the settings the page needs to do so.
 */

const PLACEMENT = 'game-over-overlay-section';
const BOARD_SIZE = 5;

function clientConfig() {
  return { placement: PLACEMENT, limit: BOARD_SIZE };
}

module.exports = { PLACEMENT, BOARD_SIZE, clientConfig };
