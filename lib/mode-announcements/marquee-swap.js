'use strict';

/**
 * lib/mode-announcements/marquee-swap.js — the "marquee-swap" option of the
 * how-the-mode-is-announced Trait.
 *
 * The PONG marquee text on the cabinet is replaced by the mode name, for
 * example BIG PADDLE MODE, for the duration of the fun game, and PONG is
 * restored on Normal play. index.html swaps the text; this returns the
 * setting the page reads.
 */

const ANNOUNCEMENT = 'marquee-swap';

function clientConfig() {
  return { announcement: ANNOUNCEMENT };
}

module.exports = { ANNOUNCEMENT, clientConfig };
