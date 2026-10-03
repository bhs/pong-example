'use strict';

/**
 * __tests__/in-canvas-menu.test.js
 *
 * Smoke tests for the canvas-drawn customization menu in index.html.
 * Asserted against the raw file contents (no DOM/browser environment).
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('in-canvas menu overlay', () => {
  test('defines menu / playing / paused UI states', () => {
    expect(html).toMatch(/state:\s*'menu'/);
    expect(html).toMatch(/ui\.state\s*=\s*'playing'/);
    expect(html).toMatch(/ui\.state\s*=\s*'paused'/);
  });

  test('offers paddle colour, ball speed and difficulty options', () => {
    expect(html).toMatch(/PADDLE_COLORS/);
    expect(html).toMatch(/BALL_SPEED_PRESETS/);
    expect(html).toMatch(/DIFFICULTY_PRESETS/);
  });

  test('hit-tests clicks against canvas coordinates', () => {
    expect(html).toMatch(/canvas\.addEventListener\('click'/);
    expect(html).toMatch(/canvas\.addEventListener\('mousemove'/);
    expect(html).toMatch(/getBoundingClientRect/);
  });

  test('settings feed the physics and rendering code', () => {
    expect(html).toMatch(/ctx\.fillStyle = settings\.paddleColor/);
    expect(html).toMatch(/ballSpeedInit\(\)/);
    expect(html).toMatch(/aiDifficulty\(\)/);
  });

  test('reports settings_changed and game_started from the menu', () => {
    expect(html).toMatch(/sendMendelEvent\('settings_changed'\)/);
    expect(html).toMatch(/sendMendelEvent\('game_started'\)/);
  });

  test('adds no menu DOM elements', () => {
    expect(html).not.toMatch(/id="pong-menu/);
  });
});
