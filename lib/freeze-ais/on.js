'use strict';

/**
 * lib/freeze-ais/on.js — the "on" option of the freeze-ai Trait.
 *
 * Freeze AI stays among the pickups the Power-Ups fun mode offers. Hitting it
 * stops the AI paddle from moving for a short time. That behaviour already
 * lives in game-logic.js (applyEffect, isAiFrozen, moveAiPaddle) and
 * index.html; this option leaves the set as it is, so the existing code runs
 * behind the switch.
 */

const OPTION = 'on';

function applyTo(set) {
  return Object.assign({}, set, { kinds: set.kinds.slice() });
}

module.exports = { OPTION, applyTo };
