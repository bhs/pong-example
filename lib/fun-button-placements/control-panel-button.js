'use strict';

/**
 * lib/fun-button-placements/control-panel-button.js — the fun button on the
 * control panel.
 *
 * The existing red button on the cabinet control panel starts a fresh game in
 * a random fun mode at any time, and stays enabled in every game phase. The
 * button is wired by index.html; this returns the setting the page reads.
 */

const PLACEMENT = 'control-panel-button';

function clientConfig() {
  return { placement: PLACEMENT };
}

module.exports = { PLACEMENT, clientConfig };
