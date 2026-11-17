'use strict';

/**
 * lib/fun-button-placements/game-over-screen-button.js — the
 * "game-over-screen-button" option of the where-the-fun-button-sits Trait.
 *
 * A Fun mode button sits beside Play Again in the game-over overlay
 * (#pong-overlay), shown only after a game ends. Pressing it starts the next
 * game in a random fun mode; Play Again and Space still start Normal. The
 * button is built by index.html; this returns the setting the page reads.
 */

const PLACEMENT = 'game-over-screen-button';

function clientConfig() {
  return { placement: PLACEMENT };
}

module.exports = { PLACEMENT, clientConfig };
