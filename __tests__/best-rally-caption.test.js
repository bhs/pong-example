'use strict';

/**
 * __tests__/best-rally-caption.test.js
 *
 * Smoke tests for the "Best rally" caption markup in index.html — a second
 * caption below the control hints, populated by JS only after game-over and
 * only for signed-in players in the ~50% display bucket (see
 * isBestRallyBucketed in server.js). Static-markup assertions only, mirroring
 * __tests__/control-hints.test.js.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('best-rally caption', () => {
  test('renders a static, initially-empty <p> caption with the expected id', () => {
    expect(html).toMatch(/<p id="pong-best-rally"><\/p>/);
  });

  test('caption sits below the control hints caption in markup order', () => {
    const hintsIndex = html.indexOf('<p id="pong-control-hints">');
    const rallyIndex = html.indexOf('<p id="pong-best-rally">');
    expect(hintsIndex).toBeGreaterThan(-1);
    expect(rallyIndex).toBeGreaterThan(hintsIndex);
  });

  test('is hidden via CSS while empty, rather than a game-state class', () => {
    const tagMatch = html.match(/<p id="pong-best-rally"[^>]*>/);
    expect(tagMatch).not.toBeNull();
    expect(tagMatch[0]).not.toMatch(/hidden/);
    expect(html).toMatch(/#pong-best-rally:empty\s*\{\s*display:\s*none;\s*\}/);
  });

  test('client script populates it only when currentUser and bestRallyBucket are both truthy', () => {
    expect(html).toMatch(/if\s*\(currentUser\s*&&\s*bestRallyBucket\)/);
  });

  test('client script tracks a maxRally value on the rally state object', () => {
    expect(html).toMatch(/maxRally:\s*0/);
  });

  test('longestRally is sent alongside score/duration when saving', () => {
    expect(html).toMatch(/longestRally:\s*rally\.maxRally/);
  });
});
