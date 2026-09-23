'use strict';

/**
 * __tests__/personal-best-badge.test.js
 *
 * Smoke tests for the "Personal Best" badge on the game-over overlay in
 * index.html — a small line appended to the overlay after a finished game,
 * populated by POSTing the final score to POST /api/scores (see
 * server.test.js for the endpoint's own behaviour) and reading the result
 * back via GET /api/scores/:userId, gated on GET /me. Signed-out players see
 * a 'Sign in with Google to save your score' link instead. Static-markup /
 * source assertions only, mirroring __tests__/best-rally-caption.test.js and
 * __tests__/control-hints.test.js — a real authenticated Google session is
 * out of scope for a self-contained unit test (see __tests__/auth.test.js).
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('personal best badge', () => {
  test('fetches the signed-in user from GET /me with credentials included', () => {
    expect(html).toMatch(/fetch\(\s*['"]\/me['"]\s*,\s*\{\s*credentials:\s*['"]include['"]\s*\}\s*\)/);
  });

  test('posts the finished game to POST /api/scores with credentials included', () => {
    expect(html).toMatch(/fetch\(\s*['"]\/api\/scores['"]\s*,\s*\{/);
    const postBlockMatch = html.match(/await fetch\('\/api\/scores', \{[\s\S]*?\}\);/);
    expect(postBlockMatch).not.toBeNull();
    expect(postBlockMatch[0]).toMatch(/method:\s*['"]POST['"]/);
    expect(postBlockMatch[0]).toMatch(/credentials:\s*['"]include['"]/);
  });

  test('POST /api/scores body includes score, duration, and longestRally', () => {
    expect(html).toMatch(/score:\s*finalScore/);
    expect(html).toMatch(/duration:\s*Math\.round\(gameElapsedSeconds\)/);
    expect(html).toMatch(/longestRally:\s*rally\.maxRally/);
  });

  test('reads back the personal best via GET /api/scores/:userId', () => {
    expect(html).toMatch(/fetch\(`\/api\/scores\/\$\{encodeURIComponent\(user\.id\)\}`/);
  });

  test('does not call POST /api/scores or GET /api/scores/:userId endpoints for a signed-out user', () => {
    const fnMatch = html.match(/async function renderPersonalBestBadge\([\s\S]*?\n    \}\n/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    const earlyReturnIndex = fnBody.indexOf('appendSignInLink(overlay);');
    const postIndex        = fnBody.indexOf("fetch('/api/scores'");
    expect(earlyReturnIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeLessThan(postIndex);
  });

  test('appends a "Personal Best: N" line to the overlay', () => {
    expect(html).toMatch(/el\.textContent = `Personal Best: \$\{best\}`;/);
  });

  test('appends a sign-in link with the expected copy for signed-out players', () => {
    expect(html).toMatch(/Sign in with Google to save your score/);
    expect(html).toMatch(/a\.href = '\/auth\/google';/);
  });

  test('there is no separate leaderboard UI in the overlay flow', () => {
    expect(html).not.toMatch(/leaderboard/i);
  });

  test('game-over overlay renders the personal best badge right after showing the overlay', () => {
    const fnMatch = html.match(/function showGameOverOverlay\([\s\S]*?\n    \}\n/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[0]).toMatch(/renderPersonalBestBadge\(overlay, playerScore\);/);
  });
});
