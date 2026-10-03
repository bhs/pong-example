'use strict';

/**
 * Smoke tests: the Play Again restart is routed through a GameController
 * that dispatches a 'game:restart' CustomEvent, with ball, paddle and score
 * modules each listening for it.
 */

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('event-driven restart', () => {
  test('defines a GameController with init and a running flag', () => {
    expect(html).toMatch(/const GameController\s*=/);
    expect(html).toMatch(/init\(\)\s*\{/);
    expect(html).toMatch(/running:\s*true/);
  });

  test('dispatches a game:restart CustomEvent', () => {
    expect(html).toMatch(/dispatchEvent\(new CustomEvent\(GAME_RESTART_EVENT\)\)/);
    expect(html).toMatch(/GAME_RESTART_EVENT\s*=\s*'game:restart'/);
  });

  test('ball, paddle and score modules each register a restart listener', () => {
    const listeners = html.match(/gameEvents\.addEventListener\(GAME_RESTART_EVENT/g) || [];
    expect(listeners.length).toBeGreaterThanOrEqual(3);
  });

  test('main loop only reschedules while running', () => {
    expect(html).toMatch(/if \(GameController\.running\)/);
    expect(html).toMatch(/GameController\.pause\(\)/);
  });

  test('Play Again button and Space both go through the controller', () => {
    expect(html).toMatch(/btn\.addEventListener\('click', \(\) => GameController\.restart\(\)\)/);
    expect(html).toMatch(/e\.code === 'Space' && game\.phase === 'gameover'/);
  });

  test('still counts play_again_click and game_started', () => {
    expect(html).toMatch(/sendMendelEvent\('play_again_click'\)/);
    expect(html).toMatch(/sendMendelEvent\('game_started'\)/);
  });
});
