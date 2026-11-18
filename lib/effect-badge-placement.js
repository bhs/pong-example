'use strict';

/**
 * lib/effect-badge-placement.js — the one place the where-the-effect-badge-sits
 * Trait is read.
 *
 * WHERE_THE_EFFECT_BADGE_SITS chooses where the active-effects badge is drawn.
 * Each option's code lives in lib/effect-badge-placements/. Unset or unknown
 * means 'bottom-right-corner'.
 */

const bottomRightCorner = require('./effect-badge-placements/bottom-right-corner');
const topCentre = require('./effect-badge-placements/top-centre');

function effectBadgePlacement(env = process.env) {
  switch (String(env.WHERE_THE_EFFECT_BADGE_SITS || '').trim().toLowerCase()) {
    case 'top-centre':
      return topCentre.clientConfig();
    case 'bottom-right-corner':
    default:
      return bottomRightCorner.clientConfig();
  }
}

module.exports = { effectBadgePlacement };
