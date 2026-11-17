'use strict';

/**
 * lib/fun-mode-config.js — the two Traits of the random fun mode button, read
 * from the environment when the process starts and handed to the browser by
 * GET /api/config (see server.js).
 *
 *   WHERE_THE_FUN_BUTTON_SITS   control-panel-button (default)
 *   HOW_THE_MODE_IS_ANNOUNCED   splash-then-badge (default)
 *
 * Each function below is the one place its variable is read; it calls the
 * code of the chosen option. A missing or unknown value takes the default.
 */

const controlPanelButton = require('./fun-button-placements/control-panel-button');
const splashThenBadge = require('./mode-announcements/splash-then-badge');

/** Where the fun button sits: the settings of the chosen placement. */
function funButtonPlacement(env = process.env) {
  switch (String(env.WHERE_THE_FUN_BUTTON_SITS || '').trim()) {
    case 'control-panel-button':
    default:
      return controlPanelButton.clientConfig();
  }
}

/** How the mode is announced: the settings of the chosen announcement. */
function modeAnnouncement(env = process.env) {
  switch (String(env.HOW_THE_MODE_IS_ANNOUNCED || '').trim()) {
    case 'splash-then-badge':
    default:
      return splashThenBadge.clientConfig();
  }
}

/** What the browser needs to place the fun button and announce the mode. */
function clientConfig(env = process.env) {
  return Object.assign({}, funButtonPlacement(env), modeAnnouncement(env));
}

module.exports = { funButtonPlacement, modeAnnouncement, clientConfig };
