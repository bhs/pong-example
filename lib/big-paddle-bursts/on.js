'use strict';

/**
 * lib/big-paddle-bursts/on.js — the "on" option of the big-paddle-burst Trait
 * (the default).
 *
 * Big Paddle stays among the pickups the Power-Ups fun mode offers. Hitting it
 * enlarges the player paddle (BIG_PADDLE_FACTOR) for a few seconds, then
 * returns it to normal size. That behaviour already lives in game-logic.js
 * (applyEffect, endEffect, tickEffects) and index.html; this option leaves the
 * set as it is, so the existing code runs behind the switch.
 */

const OPTION = 'on';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.slice() });
}

module.exports = { OPTION, applyTo };
