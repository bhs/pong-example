'use strict';

/**
 * lib/power-up-sets/just-two.js — the "just-two" option of the
 * which-power-ups-are-available Trait for the Power-Ups fun mode.
 *
 * Offers only Slow-Mo and Big Paddle burst, a minimal set that is easy to read
 * and learn. The shape matches original-four.clientConfig(), so game-logic.js
 * and index.html apply it unchanged.
 */

const SET = 'just-two';

const KINDS = Object.freeze(['slowMo', 'bigPaddle']);

function clientConfig() {
  return { set: SET, kinds: KINDS.slice() };
}

module.exports = { SET, KINDS, clientConfig };
