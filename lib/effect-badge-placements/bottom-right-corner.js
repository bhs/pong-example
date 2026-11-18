'use strict';

/**
 * lib/effect-badge-placements/bottom-right-corner.js — the "bottom-right-corner"
 * option of the where-the-effect-badge-sits Trait (the default).
 *
 * Active Power-Ups effects show as stacked chips with a countdown in the
 * bottom-right corner of the screen, mirroring the mode badge at bottom-left.
 * index.html draws the chips; this returns the setting the page reads.
 */

const PLACEMENT = 'bottom-right-corner';

function clientConfig() {
  return { placement: PLACEMENT };
}

module.exports = { PLACEMENT, clientConfig };
