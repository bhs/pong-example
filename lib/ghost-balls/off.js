'use strict';

/**
 * lib/ghost-balls/off.js — Ghost Ball is left out.
 *
 * Leaves Ghost Ball out of the pickups the Power-Ups fun mode offers: it never
 * spawns, so the ball is never made semi-transparent. The other pickups are
 * untouched.
 */

const OPTION = 'off';
const KIND = 'ghostBall';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.filter((k) => k !== KIND) });
}

module.exports = { OPTION, KIND, applyTo };
