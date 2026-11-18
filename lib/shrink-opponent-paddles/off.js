'use strict';

/**
 * lib/shrink-opponent-paddles/off.js — the "off" option of the
 * shrink-opponent-paddle Trait (the default).
 *
 * Leaves Shrink opponent paddle out of the pickups the Power-Ups fun mode
 * offers: it never spawns, so the AI paddle is never shrunk by a pickup. The
 * other pickups are untouched.
 */

const OPTION = 'off';
const KIND = 'shrinkOpponent';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.filter((k) => k !== KIND) });
}

module.exports = { OPTION, KIND, applyTo };
