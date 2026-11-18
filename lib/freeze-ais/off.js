'use strict';

/**
 * lib/freeze-ais/off.js — the "off" option of the freeze-ai Trait.
 *
 * Leaves Freeze AI out of the pickups the Power-Ups fun mode offers: it never
 * spawns, so the AI paddle is never frozen by a pickup. The other pickups are
 * untouched.
 */

const OPTION = 'off';
const KIND = 'freezeAi';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.filter((k) => k !== KIND) });
}

module.exports = { OPTION, KIND, applyTo };
