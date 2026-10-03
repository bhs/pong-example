'use strict';

/**
 * Smoke tests for the Preferences modal markup and wiring in index.html.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('Preferences modal', () => {
  test('has three colour pickers and Classic / Neon presets', () => {
    expect(html).toMatch(/<input type="color" id="pong-prefs-paddle"/);
    expect(html).toMatch(/<input type="color" id="pong-prefs-ball"/);
    expect(html).toMatch(/<input type="color" id="pong-prefs-bg"/);
    expect(html).toMatch(/id="pong-prefs-classic"[^>]*>Classic</);
    expect(html).toMatch(/id="pong-prefs-neon"[^>]*>Neon</);
  });

  test('is hidden by default and opened via a Preferences button', () => {
    expect(html).toMatch(/<div id="pong-prefs-modal" hidden>/);
    expect(html).toMatch(/prefsBtn\.textContent = 'Preferences'/);
  });

  test('render loop reads the style variables', () => {
    expect(html).toMatch(/ctx\.fillStyle = bgColor;/);
    expect(html).toMatch(/ctx\.fillStyle = paddleColor;/);
    expect(html).toMatch(/ctx\.fillStyle = ballColor;/);
  });

  test('loads from and saves to /api/preferences', () => {
    expect(html).toMatch(/fetch\('\/api\/preferences', \{ credentials/);
    expect(html).toMatch(/method: 'PUT'/);
  });
});
