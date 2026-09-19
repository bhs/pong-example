'use strict';

/**
 * __tests__/canvas-border-shadow.test.js
 *
 * Smoke tests for the 'layered-depth-frame' variation of the canvas
 * border/shadow treatment. This is pure markup/CSS (no JS behaviour), so
 * these tests assert against the raw index.html contents rather than
 * spinning up a DOM/browser environment.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('layered-depth-frame canvas border/shadow', () => {
  test('canvas is wrapped in a dedicated presentational frame element', () => {
    expect(html).toMatch(/<div id="pong-canvas-frame">/);
    const frameIndex  = html.indexOf('<div id="pong-canvas-frame">');
    const canvasIndex = html.indexOf('<canvas id="gameCanvas">');
    expect(frameIndex).toBeGreaterThan(-1);
    expect(canvasIndex).toBeGreaterThan(frameIndex);
  });

  test('frame defines rounded corners, a gradient background border, and two stacked shadows', () => {
    const styleMatch = html.match(/#pong-canvas-frame\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const rules = styleMatch[1];

    expect(rules).toMatch(/border-radius:\s*14px/);
    expect(rules).toMatch(/background:\s*linear-gradient/);

    // Two comma-separated box-shadow layers (contact + ambient).
    const shadowMatch = rules.match(/box-shadow:\s*([^;]*);/);
    expect(shadowMatch).not.toBeNull();
    const shadowLayers = shadowMatch[1].split(/,(?![^(]*\))/).map((s) => s.trim());
    expect(shadowLayers.length).toBeGreaterThanOrEqual(2);
  });

  test('canvas itself has matching rounded corners', () => {
    const styleMatch = html.match(/canvas\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    expect(styleMatch[1]).toMatch(/border-radius:\s*11px/);
  });

  test('page background is a slightly darker flat color (no gradient) for shadow contrast', () => {
    const styleMatch = html.match(/html,\s*body\s*\{([^}]*)\}/);
    expect(styleMatch).not.toBeNull();
    const rules = styleMatch[1];
    expect(rules).toMatch(/background-color:\s*#0a0a0c/);
  });
});
