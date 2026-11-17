'use strict';

/**
 * __tests__/fun-modes.test.js
 *
 * The random fun mode button: mode registry and picking, bigger paddle hit
 * box, multi-ball scoring, bouncy barriers, return to Normal, the splash +
 * badge announcement plan, and the code of the kept options.
 */

const fs   = require('fs');
const path = require('path');

const {
  CANVAS_W, CANVAS_H, PADDLE_H, BALL_SIZE, BIG_PADDLE_FACTOR, EXTRA_BALL_COUNT,
  BARRIER_LAYOUT, MODES, FUN_MODE_KEYS, SPLASH_MS,
  pickFunMode, applyMode, serveBalls, splashThenBadge,
  makeBall, makeGame, makePlayerPaddle, makeAiPaddle, makeRally,
  moveAiPaddle, updateBall, updateBalls, bounceOffBarriers, pickAiTarget,
} = require('../game-logic');

const controlPanelButton = require('../lib/fun-button-placements/control-panel-button');
const splashThenBadgeOption = require('../lib/mode-announcements/splash-then-badge');

function newState() {
  return { game: makeGame(), playerPaddle: makePlayerPaddle(), aiPaddle: makeAiPaddle() };
}

function ballAt(x, y, vx, vy) {
  const speed = Math.hypot(vx, vy);
  return { x, y, speed, angle: Math.atan2(vy, vx), vx, vy, w: BALL_SIZE, h: BALL_SIZE };
}

describe('pickFunMode', () => {
  test('only picks one of the three fun modes, never normal', () => {
    expect(FUN_MODE_KEYS).toEqual(['bigPaddle', 'multiBall', 'bouncyBarriers']);
  });

  test('uses the injected random source', () => {
    expect(pickFunMode(() => 0)).toBe('bigPaddle');
    expect(pickFunMode(() => 0.5)).toBe('multiBall');
    expect(pickFunMode(() => 0.99)).toBe('bouncyBarriers');
  });

  test('a random source returning 1 still picks a valid mode', () => {
    expect(FUN_MODE_KEYS).toContain(pickFunMode(() => 1));
  });

  test('every pick is a fun mode when using Math.random', () => {
    for (let i = 0; i < 50; i++) expect(MODES[pickFunMode()].fun).toBe(true);
  });
});

describe('modes', () => {
  test('a fresh game is in Normal with no effects', () => {
    const { game, playerPaddle } = newState();
    expect(game.mode).toBe('normal');
    expect(game.extraBalls).toEqual([]);
    expect(game.barriers).toEqual([]);
    expect(playerPaddle.h).toBe(PADDLE_H);
  });

  test('bigPaddle makes only the player paddle taller, centred', () => {
    const state = newState();
    applyMode(state, 'bigPaddle');
    expect(state.playerPaddle.h).toBe(Math.round(PADDLE_H * BIG_PADDLE_FACTOR));
    expect(state.aiPaddle.h).toBe(PADDLE_H);
    expect(state.playerPaddle.y + state.playerPaddle.h / 2).toBe(CANVAS_H / 2);
  });

  test('multiBall adds extra balls and bouncyBarriers adds barriers', () => {
    const state = newState();
    applyMode(state, 'multiBall');
    expect(state.game.extraBalls).toHaveLength(EXTRA_BALL_COUNT);
    applyMode(state, 'bouncyBarriers');
    expect(state.game.extraBalls).toEqual([]);
    expect(state.game.barriers).toHaveLength(BARRIER_LAYOUT.length);
  });

  test('applying Normal removes every effect (Play Again / Space / fresh start)', () => {
    for (const key of FUN_MODE_KEYS) {
      const state = newState();
      applyMode(state, key);
      applyMode(state, 'normal');
      expect(state.game.mode).toBe('normal');
      expect(state.game.extraBalls).toEqual([]);
      expect(state.game.barriers).toEqual([]);
      expect(state.playerPaddle.h).toBe(PADDLE_H);
    }
  });

  test('an unknown mode falls back to Normal', () => {
    const state = newState();
    applyMode(state, 'bigPaddle');
    applyMode(state, 'nope');
    expect(state.game.mode).toBe('normal');
    expect(state.playerPaddle.h).toBe(PADDLE_H);
  });

  test('every barrier leaves the centre spawn clear', () => {
    const cx = CANVAS_W / 2 - BALL_SIZE / 2;
    const cy = CANVAS_H / 2 - BALL_SIZE / 2;
    for (const b of BARRIER_LAYOUT) {
      const hit = cx < b.x + b.w && cx + BALL_SIZE > b.x && cy < b.y + b.h && cy + BALL_SIZE > b.y;
      expect(hit).toBe(false);
    }
  });
});

describe('big paddle', () => {
  test('a taller paddle hits a ball the normal one would miss', () => {
    const rally = makeRally();
    // Paddle spans y 0..80 (normal) or 0..128 (big); ball at y 100 is only inside the big one.
    const normal = makePlayerPaddle(); normal.y = 0;
    const big = makePlayerPaddle(); big.h = 128; big.y = 0;
    const game = { phase: 'playing', winner: null, pauseTimer: 0 };

    const a = ballAt(40, 100, -100, 0);
    updateBall(a, normal, makeAiPaddle(), Object.assign({}, game), 1 / 60, rally);
    expect(a.vx).toBeLessThan(0);

    const b = ballAt(40, 100, -100, 0);
    updateBall(b, big, makeAiPaddle(), Object.assign({}, game), 1 / 60, rally);
    expect(b.vx).toBeGreaterThan(0);
  });

  test('deflection uses the paddle\'s own height', () => {
    const big = makePlayerPaddle(); big.h = 160; big.y = 100;
    const game = { phase: 'playing', winner: null, pauseTimer: 0 };
    // Ball centre 40px below the paddle centre: half-way down a 160px paddle.
    const ball = ballAt(40, 100 + 80 + 40 - BALL_SIZE / 2, -100, 0);
    updateBall(ball, big, makeAiPaddle(), game, 1 / 600, makeRally());
    expect(ball.angle).toBeCloseTo(0.5 * (Math.PI * 75 / 180), 1);
  });

  test('paddle clamping and AI aim use each paddle\'s own height', () => {
    const ai = makeAiPaddle(); ai.h = 200; ai.y = 0;
    moveAiPaddle(ai, ballAt(400, CANVAS_H, 0, 0), 10);
    expect(ai.y).toBe(CANVAS_H - 200);
  });
});

describe('multi-ball', () => {
  test('a ball leaving the field scores once and ends the play phase', () => {
    const state = newState();
    applyMode(state, 'multiBall');
    state.game.phase = 'playing';
    const ball = ballAt(CANVAS_W + 5, 300, 100, 0);
    state.game.extraBalls = [ballAt(CANVAS_W + 5, 200, 100, 0), ballAt(CANVAS_W + 5, 400, 100, 0)];

    updateBalls(ball, state.playerPaddle, state.aiPaddle, state.game, 1 / 60, makeRally());
    expect(state.playerPaddle.score).toBe(1);
    expect(state.aiPaddle.score).toBe(0);
    expect(state.game.phase).toBe('scored');
  });

  test('an extra ball leaving the field scores too', () => {
    const state = newState();
    applyMode(state, 'multiBall');
    state.game.phase = 'playing';
    const ball = ballAt(400, 300, 0, 0);
    state.game.extraBalls = [ballAt(-BALL_SIZE - 5, 200, -100, 0), ballAt(400, 400, 0, 0)];

    updateBalls(ball, state.playerPaddle, state.aiPaddle, state.game, 1 / 60, makeRally());
    expect(state.aiPaddle.score).toBe(1);
  });

  test('serving resets every ball to the centre', () => {
    const state = newState();
    applyMode(state, 'multiBall');
    const ball = ballAt(10, 10, -50, 0);
    state.game.extraBalls.forEach((b) => { b.x = 0; });
    serveBalls(ball, state.game, 1);
    expect(state.game.extraBalls).toHaveLength(EXTRA_BALL_COUNT);
    [ball].concat(state.game.extraBalls).forEach((b) => {
      expect(b.x).toBe(CANVAS_W / 2 - BALL_SIZE / 2);
      expect(b.vx).toBeGreaterThan(0);
    });
  });

  test('the AI chases the incoming ball nearest to it', () => {
    const near = ballAt(600, 100, 100, 0);
    const far = ballAt(300, 500, 100, 0);
    const away = ballAt(700, 50, -100, 0);
    expect(pickAiTarget(far, [near, away])).toBe(near);
    expect(pickAiTarget(away, [])).toBe(away);
  });
});

describe('bouncy barriers', () => {
  const barrier = { x: 380, y: 120, w: 40, h: 110 };

  test('reflects off the side face', () => {
    const ball = ballAt(barrier.x - BALL_SIZE + 2, 150, 200, 0);
    expect(bounceOffBarriers(ball, [barrier])).toBe(true);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.x + ball.w).toBeLessThanOrEqual(barrier.x);
  });

  test('reflects off the top face', () => {
    const ball = ballAt(395, barrier.y - BALL_SIZE + 2, 0, 200);
    bounceOffBarriers(ball, [barrier]);
    expect(ball.vy).toBeLessThan(0);
  });

  test('leaves a ball already moving away alone', () => {
    const ball = ballAt(barrier.x - BALL_SIZE + 2, 150, -200, 0);
    expect(bounceOffBarriers(ball, [barrier])).toBe(false);
    expect(ball.vx).toBe(-200);
  });

  test('does nothing with no barriers (Normal)', () => {
    const ball = ballAt(390, 150, 200, 0);
    expect(bounceOffBarriers(ball, [])).toBe(false);
    expect(bounceOffBarriers(ball, undefined)).toBe(false);
  });

  test('updateBall bounces off the game\'s barriers', () => {
    const state = newState();
    applyMode(state, 'bouncyBarriers');
    state.game.phase = 'playing';
    const b = state.game.barriers[0];
    const ball = ballAt(b.x - BALL_SIZE - 1, b.y + 50, 300, 0);
    updateBall(ball, state.playerPaddle, state.aiPaddle, state.game, 0.01, makeRally());
    expect(ball.vx).toBeLessThan(0);
  });

  test('a ball in Normal flies straight through the barrier area', () => {
    const state = newState();
    state.game.phase = 'playing';
    const b = BARRIER_LAYOUT[0];
    const ball = ballAt(b.x - BALL_SIZE - 1, b.y + 50, 300, 0);
    updateBall(ball, state.playerPaddle, state.aiPaddle, state.game, 0.01, makeRally());
    expect(ball.vx).toBeGreaterThan(0);
  });
});

describe('splash-then-badge option', () => {
  test('its own code shows the name for 1.5 seconds then keeps a badge', () => {
    expect(SPLASH_MS).toBe(1500);
    expect(splashThenBadge('multiBall')).toEqual({
      splashText: 'Multi-Ball', splashMs: 1500, badgeText: 'Multi-Ball',
    });
  });

  test('Normal gets no splash and no badge', () => {
    expect(splashThenBadge('normal')).toEqual({ splashText: null, splashMs: 0, badgeText: null });
  });

  test('server-side option code and config', () => {
    expect(splashThenBadgeOption.clientConfig()).toEqual({ announcement: 'splash-then-badge', splashMs: 1500 });
  });
});

describe('control-panel-button option', () => {
  test('its own code describes the control panel button', () => {
    expect(controlPanelButton.clientConfig()).toEqual({ placement: 'control-panel-button' });
  });
});

describe('index.html wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  test('Play Again and Space start a Normal game; the panel button starts a fun one', () => {
    expect(html).toMatch(/function startNewGame\(\) \{[^}]*beginGame\('normal'\)/);
    expect(html).toMatch(/function startFunGame\(\) \{\s*beginGame\(pickFunMode\(\)\)/);
    expect(html).toMatch(/getElementById\('pong-panel-button'\)/);
  });

  test('declares the same fun modes as game-logic', () => {
    for (const key of Object.keys(MODES)) {
      expect(html).toMatch(new RegExp(`\\b${key}: \\{\\s*name: '${MODES[key].name}'`));
    }
  });

  test('announces the mode and reports fun_mode_started with the mode name', () => {
    expect(html).toMatch(/announceSplashThenBadge\(modeKey\)/);
    expect(html).toMatch(/sendMendelEvent\('fun_mode_started', \{ mode: modeKey \}\)/);
  });
});
