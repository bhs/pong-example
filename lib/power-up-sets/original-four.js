'use strict';

/**
 * lib/power-up-sets/original-four.js — the "original-four" option of the
 * which-power-ups-are-available Trait (the default) for the Power-Ups fun mode.
 *
 * Offers Slow-Mo, Ghost Ball, Big Paddle burst and Freeze AI; each pickup that
 * spawns is one of the four, picked at random. game-logic.js draws from `kinds`;
 * index.html reads the same list from GET /api/config.
 */

const SET = 'original-four';

const KINDS = Object.freeze(['slowMo', 'ghostBall', 'bigPaddle', 'freezeAi']);

function clientConfig() {
  return { set: SET, kinds: KINDS.slice() };
}

module.exports = { SET, KINDS, clientConfig };
