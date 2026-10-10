'use strict';

/**
 * __tests__/game-settings.test.js
 *
 * Regex checks on index.html's pause/settings modal wiring, plus checks that
 * its preset tables stay in sync with game-logic.js.
 */

const fs   = require('fs');
const path = require('path');
const logic = require('../game-logic');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('settings object', () => {
  test('is a module-scope object with paddleColor, speedPreset and difficulty', () => {
    const m = html.match(/const settings = \{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/paddleColor:\s*'#ffffff'/);
    expect(m[1]).toMatch(/speedPreset:\s*'normal'/);
    expect(m[1]).toMatch(/difficulty:\s*'normal'/);
  });

  test('update() and render() read the settings instead of hard-coded constants', () => {
    expect(html).toMatch(/ctx\.fillStyle = settings\.paddleColor/);
    expect(html).toMatch(/clamp\(ball\.speed \* BALL_SPEED_MUL, speedPreset\(\)\.init, speedPreset\(\)\.max\)/);
    expect(html).toMatch(/ball\.speed = speedPreset\(\)\.init/);
    expect(html).toMatch(/difficultyPreset\(\)/);
    expect(html).not.toMatch(/ball\.speed = BALL_SPEED_INIT/);
    expect(html).not.toMatch(/AI_LERP \+ rally/);
  });
});

describe('presets stay in sync with game-logic.js', () => {
  test.each(['slow', 'fast'])('%s speed preset', (name) => {
    const m = html.match(new RegExp(`${name}:\\s*\\{ init: (\\d+),\\s*max: (\\d+) \\}`));
    expect(m).not.toBeNull();
    expect(logic.SPEED_PRESETS[name]).toEqual({ init: Number(m[1]), max: Number(m[2]) });
  });

  test.each(['easy', 'hard'])('%s difficulty preset', (name) => {
    const m = html.match(new RegExp(
      `${name}:\\s*\\{ aiLerp: ([\\d.]+),\\s*aiLerpRallyInc: ([\\d.]+),\\s*aiSpeedScale: ([\\d.]+) \\}`));
    expect(m).not.toBeNull();
    expect(logic.DIFFICULTY_PRESETS[name]).toEqual({
      aiLerp: Number(m[1]), aiLerpRallyInc: Number(m[2]), aiSpeedScale: Number(m[3]),
    });
  });

  test('normal presets equal the original constants', () => {
    expect(logic.SPEED_PRESETS.normal).toEqual({ init: logic.BALL_SPEED_INIT, max: logic.BALL_SPEED_MAX });
    expect(logic.DIFFICULTY_PRESETS.normal).toEqual({
      aiLerp: logic.AI_LERP, aiLerpRallyInc: logic.AI_LERP_RALLY_INC, aiSpeedScale: 1,
    });
  });

  test('paddle colours match', () => {
    const m = html.match(/const PADDLE_COLORS = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const colors = m[1].split(',').map((c) => c.trim().replace(/'/g, ''));
    expect(colors).toEqual(logic.PADDLE_COLORS);
  });
});

describe('presets change gameplay in game-logic', () => {
  test('incrementSpeed respects the speed preset range', () => {
    expect(logic.incrementSpeed(10000, logic.SPEED_PRESETS.slow)).toBe(logic.SPEED_PRESETS.slow.max);
    expect(logic.incrementSpeed(0, logic.SPEED_PRESETS.fast)).toBe(logic.SPEED_PRESETS.fast.init);
  });

  test('hard AI moves further per frame than easy AI', () => {
    const ball = { y: 0, x: 0 };
    const easy = logic.moveAiPaddle({ y: 500 }, ball, 0.1, 0, logic.DIFFICULTY_PRESETS.easy);
    const hard = logic.moveAiPaddle({ y: 500 }, ball, 0.1, 0, logic.DIFFICULTY_PRESETS.hard);
    expect(hard.y).toBeLessThan(easy.y);
  });
});

describe('pause modal wiring', () => {
  test('Esc and P toggle the modal; opening pauses and closing resumes', () => {
    expect(html).toMatch(/e\.code === 'Escape' \|\| \(e\.code === 'KeyP'/);
    expect(html).toMatch(/game\.paused = true/);
    expect(html).toMatch(/game\.paused = false/);
    expect(html).toMatch(/game\.phase === 'gameover' \|\| game\.paused/);
  });

  test('modal is built with DOM APIs inside the existing settings card', () => {
    expect(html).toMatch(/overlay\.id = 'pong-settings-modal'/);
    expect(html).toMatch(/card\.id = 'pong-settings-card'/);
    expect(html).toMatch(/\.pong-swatch/);
    expect(html).toMatch(/pong-nickname-input/);
  });

  test('preferences are fetched and PUT only for signed-in users', () => {
    expect(html).toMatch(/fetch\('\/api\/preferences'/);
    expect(html).toMatch(/method: 'PUT'/);
    expect(html).toMatch(/if \(!currentUser\) return;/);
  });
});
