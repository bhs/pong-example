'use strict';

/**
 * lib/add-random-obstructions-to-the-game-areas/off.js — the "off" option of
 * the add-random-obstructions-to-the-game-area Trait.
 *
 * Leaves the random obstructions out of the Power-Ups fun mode: none are ever
 * placed, so the field stays clear. The pickups in the set are untouched.
 */

const OPTION = 'off';

function applyTo(set) {
  return Object.assign({}, set, { obstructions: false });
}

module.exports = { OPTION, applyTo };
