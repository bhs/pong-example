'use strict';

/**
 * lib/multi-balls/off.js — the "off" option of the multi-ball Trait (the
 * default).
 *
 * Leaves Multi-ball out of the pickups the Power-Ups fun mode offers: it never
 * spawns, so no extra ball is ever added by a pickup. The other pickups are
 * untouched.
 */

const OPTION = 'off';
const KIND = 'multiBall';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.filter((k) => k !== KIND) });
}

module.exports = { OPTION, KIND, applyTo };
