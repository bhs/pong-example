'use strict';

/**
 * lib/engagement-config.js — what the browser needs to render the retention
 * features, handed out by GET /me (see server.js).
 *
 *   - the yesterday prompt is a toast that fades in over the screen;
 *   - signed-out players get no streak, just a sign-in line.
 */

/** The yesterday prompt: fades in over the canvas, then goes away. */
function toastOverTheScreen() {
  return { placement: 'toast-over-the-screen', durationMs: 5000 };
}

/** No streak or prompt without an account, just an invitation. */
function signedOutStreakOff() {
  return { enabled: false, line: 'Sign in to build a streak' };
}

/** What the client needs to know to render the retention features. */
function engagementConfig() {
  return {
    prompt: toastOverTheScreen(),
    signedOut: signedOutStreakOff(),
  };
}

module.exports = {
  engagementConfig,
  toastOverTheScreen,
  signedOutStreakOff,
};
