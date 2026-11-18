'use strict';

/**
 * lib/power-up-set.js — the one place the which-power-ups-are-available Trait
 * is read.
 *
 * WHICH_POWER_UPS_ARE_AVAILABLE chooses which pickups the Power-Ups fun mode
 * can offer. Each option's code lives in lib/power-up-sets/. Unset or unknown
 * means 'original-four'.
 */

const originalFour = require('./power-up-sets/original-four');

function powerUpSet(env = process.env) {
  switch (String(env.WHICH_POWER_UPS_ARE_AVAILABLE || '').trim().toLowerCase()) {
    case 'original-four':
    default:
      return originalFour.clientConfig();
  }
}

module.exports = { powerUpSet };
