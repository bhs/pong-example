'use strict';

/**
 * lib/slow-mos/on.js — the "on" option of the slow-mo Trait (the default).
 *
 * Slow-Mo stays among the pickups the Power-Ups fun mode offers. Hitting it
 * slows every ball to about half speed (SLOW_MO_FACTOR) for a few seconds,
 * then restores the prior speed. That behaviour already lives in
 * game-logic.js (applyEffect, tickEffects, ballTimeScale) and index.html; this
 * option leaves the set as it is, so the existing code runs behind the switch.
 */

const OPTION = 'on';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.slice() });
}

module.exports = { OPTION, applyTo };
