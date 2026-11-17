'use strict';

/**
 * lib/mode-announcements/splash-then-badge.js — the "splash-then-badge" option
 * of the how-the-mode-is-announced Trait (the default).
 *
 * The mode name is shown large in the centre of the screen for about 1.5
 * seconds as the game starts, then a small mode badge stays in a corner for
 * the rest of the game. index.html draws both; this returns the setting the
 * page reads.
 */

const ANNOUNCEMENT = 'splash-then-badge';
const SPLASH_MS = 1500;

function clientConfig() {
  return { announcement: ANNOUNCEMENT, splashMs: SPLASH_MS };
}

module.exports = { ANNOUNCEMENT, SPLASH_MS, clientConfig };
