'use strict';

/**
 * engagement-client.js — browser side of the daily-play retention features.
 *
 *   - a '🔥 N-day streak' badge on the cabinet's control panel (#pong-streak,
 *     empty and therefore hidden when there is no streak);
 *   - a short 'Beat your yesterday: N' toast over the screen (#pong-screen)
 *     on load, gone after a few seconds or on the first key press;
 *   - with the `strip-on-the-control-panel` placement, the same prompt as a
 *     permanent line (#pong-yesterday-strip) on the control panel instead of
 *     the toast, kept up to date after each score;
 *   - for signed-out players, a 'Sign in to build a streak' line instead
 *     (#pong-streak-note) — no streak, no toast.
 *
 * Numbers come from GET /api/engagement (see lib/engagement.js); the toast
 * placement and the signed-out line come from GET /me's `engagement` object
 * (see lib/engagement-traits.js). Everything is injected (document, fetch,
 * timers) so it can run under a test DOM. Failures never touch gameplay.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PongEngagement = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const TOAST_ID = 'pong-yesterday-toast';
  const FADE_MS  = 400;
  const STRIP_PLACEMENT = 'strip-on-the-control-panel';

  function streakLabel(streak) {
    return streak > 0 ? '🔥 ' + streak + '-day streak' : '';
  }

  function promptText(data) {
    if (data.yesterdayBest !== null && data.yesterdayBest !== undefined) {
      return 'Beat your yesterday: ' + data.yesterdayBest;
    }
    if (data.streak > 0) return 'Keep your ' + data.streak + '-day streak alive';
    return 'Play today to start a streak';
  }

  /**
   * @param {object} env
   * @param {Document} env.document
   * @param {Window}   env.window     (keydown listener)
   * @param {Function} env.fetch
   * @param {Function} [env.setTimeout]
   * @param {Function} [env.clearTimeout]
   * @param {Function} [env.tzOffset] minutes, defaults to the browser's getTimezoneOffset()
   */
  function create(env) {
    const doc = env.document;
    const win = env.window;
    const later = env.setTimeout || setTimeout;
    const cancel = env.clearTimeout || clearTimeout;
    const tzOffset = env.tzOffset || function () { return new Date().getTimezoneOffset(); };

    let latest = 0;       // sequence number: only the newest response is applied
    let toast = null;     // { el, timer }
    let strip = false;    // true when the prompt lives on the control panel

    function setText(id, text) {
      const el = doc.getElementById(id);
      if (el) el.textContent = text;
    }

    function dismissToast() {
      if (!toast) return;
      const { el, timer } = toast;
      toast = null;
      cancel(timer);
      win.removeEventListener('keydown', dismissToast);
      el.classList.remove('visible');
      later(function () { if (el.parentNode) el.parentNode.removeChild(el); }, FADE_MS);
    }

    function showToast(text, durationMs) {
      const screen = doc.getElementById('pong-screen');
      if (!screen) return;
      dismissToast();
      const el = doc.createElement('div');
      el.id = TOAST_ID;
      el.setAttribute('role', 'status');
      el.textContent = text;
      screen.appendChild(el);
      later(function () { el.classList.add('visible'); }, 20);
      toast = { el, timer: later(dismissToast, durationMs) };
      win.addEventListener('keydown', dismissToast);
    }

    async function fetchEngagement() {
      const res = await env.fetch('/api/engagement?tzOffset=' + encodeURIComponent(tzOffset()), {
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      return res.json();
    }

    /** Fetch and render the badge; with `config`, also the on-load prompt. */
    async function run(config) {
      const seq = ++latest;
      let data = null;
      try {
        data = await fetchEngagement();
      } catch (err) {
        return; // network trouble: leave whatever is on screen
      }
      if (seq !== latest) return;

      setText('pong-streak-note', '');
      setText('pong-streak', data ? streakLabel(data.streak) : '');
      if (config && config.prompt) strip = config.prompt.placement === STRIP_PLACEMENT;
      if (strip) {
        setText('pong-yesterday-strip', data ? promptText(data) : '');
      } else if (data && config && config.prompt) {
        showToast(promptText(data), config.prompt.durationMs || 5000);
      }
    }

    return {
      /** Signed in, page load: badge plus the toast. */
      load(config) { return run(config || { prompt: { durationMs: 5000 } }); },
      /** Signed in, after a score was saved: badge only. */
      refresh() { return run(null); },
      /** Signed out: no streak, an invitation instead. */
      showSignedOut(config) {
        latest += 1;
        dismissToast();
        setText('pong-streak', '');
        setText('pong-yesterday-strip', '');
        const note = doc.getElementById('pong-streak-note');
        if (!note) return;
        const line = (config && config.signedOut && config.signedOut.line) || 'Sign in to build a streak';
        note.textContent = '';
        const a = doc.createElement('a');
        a.href = '/auth/google';
        a.textContent = line;
        note.appendChild(a);
      },
    };
  }

  return { create, streakLabel, promptText };
}));
