'use strict';

/**
 * lib/engagement-traits.js — the two open questions of the retention features.
 *
 *   WHERE_THE_YESTERDAY_PROMPT_APPEARS   toast-over-the-screen (default),
 *                                        strip-on-the-control-panel
 *   STREAK_FOR_SIGNED_OUT_PLAYERS        off (default)
 *
 * Each variable is read in exactly one function below, which calls the code
 * of the chosen option. Read when the process answers a request, never baked
 * in at build time. The browser gets the result from GET /me (see server.js).
 */

// ── Where the yesterday prompt appears ──────────────────────────────────────

/** Option `toast-over-the-screen`: fades in over the canvas, then goes away. */
function toastOverTheScreen() {
  return { placement: 'toast-over-the-screen', durationMs: 5000 };
}

/**
 * Option `strip-on-the-control-panel`: a permanent line on the control panel
 * (#pong-yesterday-strip), beside the hints and the best-rally caption.
 */
function stripOnTheControlPanel() {
  return { placement: 'strip-on-the-control-panel' };
}

function whereTheYesterdayPromptAppears(env = process.env) {
  switch (env.WHERE_THE_YESTERDAY_PROMPT_APPEARS) {
    case 'strip-on-the-control-panel':
      return stripOnTheControlPanel();
    case 'toast-over-the-screen':
    default:
      return toastOverTheScreen();
  }
}

// ── Streak for signed-out players ───────────────────────────────────────────

/** Option `off`: no streak or prompt without an account, just an invitation. */
function signedOutStreakOff() {
  return { enabled: false, line: 'Sign in to build a streak' };
}

function streakForSignedOutPlayers(env = process.env) {
  switch (env.STREAK_FOR_SIGNED_OUT_PLAYERS) {
    case 'off':
    default:
      return signedOutStreakOff();
  }
}

/** What the client needs to know to render the retention features. */
function engagementConfig(env = process.env) {
  return {
    prompt: whereTheYesterdayPromptAppears(env),
    signedOut: streakForSignedOutPlayers(env),
  };
}

module.exports = {
  engagementConfig,
  whereTheYesterdayPromptAppears,
  streakForSignedOutPlayers,
  toastOverTheScreen,
  stripOnTheControlPanel,
  signedOutStreakOff,
};
