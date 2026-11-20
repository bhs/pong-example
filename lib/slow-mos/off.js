'use strict';

/**
 * lib/slow-mos/off.js — the "off" option of the slow-mo Trait.
 *
 * Leaves Slow-Mo out of the pickups the Power-Ups fun mode offers: it never
 * spawns, so no ball is ever slowed. The other pickups are untouched.
 */

const OPTION = 'off';
const KIND = 'slowMo';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.filter((k) => k !== KIND) });
}

module.exports = { OPTION, KIND, applyTo };
