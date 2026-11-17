'use strict';

/**
 * __tests__/engagement-dom.test.js
 *
 * Runs engagement-client.js against a jsdom copy of the cabinet's markup:
 * the streak badge, the 'beat your yesterday' toast and the signed-out line.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const PongEngagement = require('../engagement-client');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Just the cabinet markup (no game script, which needs a real canvas).
const cabinetStart = html.indexOf('<div id="pong-cabinet">');
const cabinet = html.slice(cabinetStart, html.indexOf('<script', cabinetStart));

function setup(responses) {
  const dom = new JSDOM(`<!doctype html><body>${cabinet}</body>`);
  const { document, window } = dom.window;
  const timers = [];
  const calls = [];
  const ui = PongEngagement.create({
    document,
    window,
    tzOffset: () => 300,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearTimeout: (id) => { if (timers[id]) timers[id].live = false; },
    fetch: async (url) => {
      calls.push(url);
      const r = responses.shift();
      if (r instanceof Error) throw r;
      return { ok: r.status === undefined, json: async () => r };
    },
  });
  return { dom, document, window, ui, calls, timers };
}

const CONFIG = { prompt: { placement: 'toast-over-the-screen', durationMs: 5000 }, signedOut: { enabled: false, line: 'Sign in to build a streak' } };
const toast = (document) => document.getElementById('pong-yesterday-toast');

describe('streak badge', () => {
  test('control panel has the badge and signed-out line, hidden while empty', () => {
    const { document } = setup([]);
    const panel = document.getElementById('pong-control-panel');
    expect(panel.querySelector('#pong-streak').textContent).toBe('');
    expect(panel.querySelector('#pong-streak-note').textContent).toBe('');
    expect(html).toMatch(/#pong-streak:empty,\s*#pong-streak-note:empty \{ display: none; \}/);
  });

  test('shows "🔥 N-day streak" and sends the timezone offset', async () => {
    const { document, ui, calls } = setup([{ streak: 4, playedToday: true, yesterdayBest: 6, todayBest: 2 }]);
    await ui.load(CONFIG);
    expect(document.getElementById('pong-streak').textContent).toBe('🔥 4-day streak');
    expect(calls).toEqual(['/api/engagement?tzOffset=300']);
  });

  test('stays empty when there is no streak', async () => {
    const { document, ui } = setup([{ streak: 0, playedToday: false, yesterdayBest: null, todayBest: null }]);
    await ui.load(CONFIG);
    expect(document.getElementById('pong-streak').textContent).toBe('');
  });

  test('refresh after a score updates the badge without a new toast', async () => {
    const { document, ui } = setup([
      { streak: 0, playedToday: false, yesterdayBest: null, todayBest: null },
      { streak: 1, playedToday: true, yesterdayBest: null, todayBest: 5 },
    ]);
    await ui.load(CONFIG);
    toast(document).remove();
    await ui.refresh();
    expect(document.getElementById('pong-streak').textContent).toBe('🔥 1-day streak');
    expect(toast(document)).toBeNull();
  });

  test('a failed request leaves gameplay and the page alone', async () => {
    const { document, ui } = setup([new Error('offline')]);
    await expect(ui.load(CONFIG)).resolves.toBeUndefined();
    expect(document.getElementById('pong-streak').textContent).toBe('');
    expect(toast(document)).toBeNull();
  });

  test('a rejected response (e.g. session lost) clears the badge', async () => {
    const { document, ui } = setup([{ streak: 2, yesterdayBest: 1 }, { status: 401 }]);
    await ui.load(CONFIG);
    await ui.refresh();
    expect(document.getElementById('pong-streak').textContent).toBe('');
  });
});

describe('yesterday prompt toast', () => {
  test('says "Beat your yesterday: N" inside the screen and fades in', async () => {
    const { document, ui } = setup([{ streak: 3, playedToday: false, yesterdayBest: 7, todayBest: null }]);
    await ui.load(CONFIG);
    const el = toast(document);
    expect(el.textContent).toBe('Beat your yesterday: 7');
    expect(el.parentNode.id).toBe('pong-screen');
    expect(el.classList.contains('visible')).toBe(false);
  });

  test('goes away after a few seconds', async () => {
    const { document, ui, timers } = setup([{ streak: 1, playedToday: false, yesterdayBest: 7 }]);
    await ui.load(CONFIG);
    expect(timers.some((t) => t.ms === 5000)).toBe(true);
    timers.find((t) => t.ms === 5000).fn();
    expect(toast(document).classList.contains('visible')).toBe(false);
    timers.filter((t) => t.ms === 400).forEach((t) => t.fn());
    expect(toast(document)).toBeNull();
  });

  test('goes away on the first key press', async () => {
    const { document, window, ui, timers } = setup([{ streak: 1, playedToday: false, yesterdayBest: 7 }]);
    await ui.load(CONFIG);
    timers.find((t) => t.ms === 20).fn();
    expect(toast(document).classList.contains('visible')).toBe(true);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(toast(document).classList.contains('visible')).toBe(false);
    timers.filter((t) => t.ms === 400).forEach((t) => t.fn());
    expect(toast(document)).toBeNull();
  });

  test('without a game yesterday, invites the player to start or keep a streak', () => {
    expect(PongEngagement.promptText({ streak: 0, yesterdayBest: null })).toBe('Play today to start a streak');
    expect(PongEngagement.promptText({ streak: 1, yesterdayBest: null })).toBe('Keep your 1-day streak alive');
    expect(PongEngagement.promptText({ streak: 5, yesterdayBest: 0 })).toBe('Beat your yesterday: 0');
  });
});

describe('yesterday prompt strip', () => {
  const STRIP = { prompt: { placement: 'strip-on-the-control-panel' }, signedOut: CONFIG.signedOut };
  const strip = (document) => document.getElementById('pong-yesterday-strip');

  test('control panel has the strip, hidden while empty', () => {
    const { document } = setup([]);
    expect(document.getElementById('pong-control-panel').contains(strip(document))).toBe(true);
    expect(strip(document).textContent).toBe('');
    expect(html).toMatch(/#pong-yesterday-strip:empty \{ display: none; \}/);
  });

  test('reads "Beat your yesterday: N" on the panel, with no toast', async () => {
    const { document, ui, timers } = setup([{ streak: 3, playedToday: false, yesterdayBest: 7, todayBest: null }]);
    await ui.load(STRIP);
    expect(strip(document).textContent).toBe('Beat your yesterday: 7');
    expect(toast(document)).toBeNull();
    expect(timers.length).toBe(0);
  });

  test('stays after a key press and follows the latest data after a score', async () => {
    const { document, window, ui } = setup([
      { streak: 1, playedToday: false, yesterdayBest: 7 },
      { streak: 2, playedToday: true, yesterdayBest: 7, todayBest: 9 },
    ]);
    await ui.load(STRIP);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(strip(document).textContent).toBe('Beat your yesterday: 7');
    await ui.refresh();
    expect(strip(document).textContent).toBe('Beat your yesterday: 7');
    expect(document.getElementById('pong-streak').textContent).toBe('🔥 2-day streak');
  });

  test('is emptied when signed out or when the request is rejected', async () => {
    const { document, ui } = setup([{ streak: 1, yesterdayBest: 7 }, { status: 401 }]);
    await ui.load(STRIP);
    await ui.refresh();
    expect(strip(document).textContent).toBe('');
    ui.showSignedOut(STRIP);
    expect(strip(document).textContent).toBe('');
  });
});

describe('signed-out players', () => {
  test('see a "Sign in to build a streak" line and no badge or toast', () => {
    const { document, ui, calls } = setup([]);
    ui.showSignedOut(CONFIG);
    expect(document.getElementById('pong-streak-note').textContent).toBe('Sign in to build a streak');
    expect(document.querySelector('#pong-streak-note a').getAttribute('href')).toBe('/auth/google');
    expect(document.getElementById('pong-streak').textContent).toBe('');
    expect(toast(document)).toBeNull();
    expect(calls).toEqual([]);
  });

  test('signing in replaces the line with the badge', async () => {
    const { document, ui } = setup([{ streak: 2, playedToday: true, yesterdayBest: null, todayBest: 3 }]);
    ui.showSignedOut(CONFIG);
    await ui.load(CONFIG);
    expect(document.getElementById('pong-streak-note').textContent).toBe('');
    expect(document.getElementById('pong-streak').textContent).toBe('🔥 2-day streak');
  });
});

describe('index.html wiring', () => {
  test('loads the module, loads engagement on sign-in and refreshes after the score POST', () => {
    expect(html).toMatch(/<script src="\/engagement-client\.js"><\/script>/);
    expect(html).toMatch(/engagementUI\.load\(data\.engagement\)/);
    expect(html).toMatch(/engagementUI\.showSignedOut\(/);
    expect(html).toMatch(/engagementUI\.refresh\(\)/);
  });
});
