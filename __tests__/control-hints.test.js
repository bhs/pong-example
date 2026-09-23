'use strict';

/**
 * __tests__/control-hints.test.js
 *
 * Smoke tests for the static control-hints caption markup in index.html.
 * The caption is plain markup/CSS living below the canvas (not injected by
 * JS), so these tests just assert against the raw file contents rather than
 * spinning up a DOM/browser environment.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('control hints caption', () => {
  test('renders a static <p> caption with the expected id', () => {
    expect(html).toMatch(/<p id="pong-control-hints">/);
  });

  test('caption text mentions the movement keys and the restart shortcut', () => {
    const match = html.match(/<p id="pong-control-hints">([^<]*)<\/p>/);
    expect(match).not.toBeNull();
    const text = match[1];
    expect(text).toMatch(/W\/S/);
    expect(text).toMatch(/↑\/↓/);
    expect(text).toMatch(/Space to play again/);
  });

  test('caption sits below the canvas element in markup order', () => {
    const canvasIndex  = html.indexOf('<canvas id="gameCanvas">');
    const captionIndex = html.indexOf('<p id="pong-control-hints">');
    expect(canvasIndex).toBeGreaterThan(-1);
    expect(captionIndex).toBeGreaterThan(canvasIndex);
  });

  test('defines a small, muted, centered style for the caption', () => {
    const styleMatch = html.match(/#pong-control-hints\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const rules = styleMatch[1];
    expect(rules).toMatch(/font-size:\s*0\.9rem/);
    expect(rules).toMatch(/color:\s*#999/);
    expect(rules).toMatch(/text-align:\s*center/);
    expect(rules).toMatch(/margin-top:\s*8px/);
  });

  test('caption element is not gated by any game-state class or conditional attribute', () => {
    const tagMatch = html.match(/<p id="pong-control-hints"[^>]*>/);
    expect(tagMatch).not.toBeNull();
    expect(tagMatch[0]).not.toMatch(/hidden/);
    expect(tagMatch[0]).not.toMatch(/style="display:\s*none"/);
  });
});
