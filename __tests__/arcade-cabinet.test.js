'use strict';

/**
 * __tests__/arcade-cabinet.test.js
 *
 * Smoke tests for the CSS-drawn arcade cabinet wrapped around the game in
 * index.html. Pure markup/CSS, so these assert against the raw file contents.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('arcade cabinet', () => {
  test('has a marquee reading PONG, a bezel, a screen and a control panel', () => {
    expect(html).toMatch(/<div id="pong-marquee">PONG<\/div>/);
    expect(html).toMatch(/id="pong-bezel"/);
    expect(html).toMatch(/id="pong-control-panel"/);
  });

  test('the canvas sits inside the screen element', () => {
    expect(html).toMatch(/<div id="pong-screen">\s*<canvas id="gameCanvas"><\/canvas>\s*<\/div>/);
  });

  test('hints and best-rally caption live on the control panel', () => {
    const panelStart = html.indexOf('<div id="pong-control-panel">');
    expect(panelStart).toBeGreaterThan(html.indexOf('<canvas id="gameCanvas">'));
    expect(html.indexOf('<p id="pong-control-hints">')).toBeGreaterThan(panelStart);
    expect(html.indexOf('<p id="pong-best-rally">')).toBeGreaterThan(panelStart);
  });

  test('has decorative button and joystick with no handlers', () => {
    expect(html).toMatch(/id="pong-panel-button"/);
    expect(html).toMatch(/id="pong-panel-joystick"/);
    expect(html).not.toMatch(/getElementById\('pong-panel-/);
  });

  test('scales proportionally with CSS and uses no images', () => {
    expect(html).toMatch(/--u:\s*min\(1px,\s*100vw \/ 700,\s*100vh \/ 800\)/);
    expect(html).not.toMatch(/<img\b[^>]*src=["']\/?[^"']*\.(png|jpe?g|svg|gif)/i);
    expect(html).not.toMatch(/url\(/);
  });

  test('game-over overlay is confined to the screen, settings modal stays full-page', () => {
    expect(html).toMatch(/#pong-overlay \{\s*position: absolute;\s*inset: 0;/);
    expect(html).toMatch(/getElementById\('pong-screen'\)\.appendChild\(overlay\)/);
    expect(html).toMatch(/#pong-settings-modal \{\s*position: fixed;/);
  });

  test('page background is a mid-tone purple radial gradient, not near-black', () => {
    expect(html).toMatch(/radial-gradient\(ellipse at 50% 45%, #6a4fa3[^;]*#3d2d66/);
  });
});
