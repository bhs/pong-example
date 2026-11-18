'use strict';

/**
 * lib/big-paddle-bursts/off.js — the "off" option of the big-paddle-burst Trait.
 *
 * Leaves Big Paddle out of the pickups the Power-Ups fun mode offers: it never
 * spawns, so the player paddle is never enlarged by a pickup. The other
 * pickups are untouched.
 */

const OPTION = 'off';
const KIND = 'bigPaddle';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.filter((k) => k !== KIND) });
}

module.exports = { OPTION, KIND, applyTo };
