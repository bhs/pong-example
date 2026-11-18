'use strict';

/**
 * lib/effect-badge-placements/top-centre.js — the "top-centre" option of the
 * where-the-effect-badge-sits Trait.
 *
 * Active Power-Ups effects show as a row of chips along the top centre of the
 * screen, above the playfield action. index.html draws the chips (its
 * #pong-effect-badge[data-placement="top-centre"] rule positions the row);
 * this returns the setting the page reads.
 */

const PLACEMENT = 'top-centre';

function clientConfig() {
  return { placement: PLACEMENT };
}

module.exports = { PLACEMENT, clientConfig };
