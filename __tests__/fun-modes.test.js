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
const http = require('http');

const {
  CANVAS_W, CANVAS_H, PADDLE_H, BALL_SIZE, BIG_PADDLE_FACTOR, EXTRA_BALL_COUNT,
  BARRIER_LAYOUT, MODES, FUN_MODE_KEYS, SPLASH_MS,
  pickFunMode, applyMode, serveBalls, splashThenBadge,
  makeBall, makeGame, makePlayerPaddle, makeAiPaddle, makeRally,
  moveAiPaddle, updateBall, updateBalls, bounceOffBarriers, pickAiTarget,
  POWER_UP_KEYS, PICKUP_SIZE, SLOW_MO_FACTOR, GHOST_NOISE, DEFAULT_PACING, DEFAULT_POWER_UP_SET,
  spawnPickup, collectPickup, applyEffect, tickEffects, clearPowerUps, updatePowerUps,
  ballTimeScale, ballAlpha, isAiFrozen,
} = require('../game-logic');

const { createApp } = require('../server');
const { createFakePrisma } = require('./helpers/fakePrisma');
const controlPanelButton = require('../lib/fun-button-placements/control-panel-button');
const splashThenBadgeOption = require('../lib/mode-announcements/splash-then-badge');
const steadyPacing = require('../lib/pickup-pacings/steady');
const rareAndLongPacing = require('../lib/pickup-pacings/rare-and-long');
const bottomRightCorner = require('../lib/effect-badge-placements/bottom-right-corner');
const topCentre = require('../lib/effect-badge-placements/top-centre');
const besidePlayerPaddle = require('../lib/effect-badge-placements/beside-player-paddle');
const { pickupPacing } = require('../lib/pickup-pacing');
const originalFourSet = require('../lib/power-up-sets/original-four');
const slowMoOn = require('../lib/slow-mos/on');
const slowMoOff = require('../lib/slow-mos/off');
const { slowMo } = require('../lib/slow-mo');
const ghostBallOn = require('../lib/ghost-balls/on');
const ghostBallOff = require('../lib/ghost-balls/off');
const { ghostBall } = require('../lib/ghost-ball');
const { effectBadgePlacement } = require('../lib/effect-badge-placement');

function newState() {
  return { game: makeGame(), playerPaddle: makePlayerPaddle(), aiPaddle: makeAiPaddle() };
}

function ballAt(x, y, vx, vy) {
  const speed = Math.hypot(vx, vy);
  return { x, y, speed, angle: Math.atan2(vy, vx), vx, vy, w: BALL_SIZE, h: BALL_SIZE };
}

describe('pickFunMode', () => {
  test('only picks one of the four fun modes, never normal', () => {
    expect(FUN_MODE_KEYS).toEqual(['bigPaddle', 'multiBall', 'bouncyBarriers', 'powerUps']);
  });

  test('uses the injected random source', () => {
    expect(pickFunMode(() => 0)).toBe('bigPaddle');
    expect(pickFunMode(() => 0.3)).toBe('multiBall');
    expect(pickFunMode(() => 0.6)).toBe('bouncyBarriers');
    expect(pickFunMode(() => 0.99)).toBe('powerUps');
  });

  test('every fun mode is reachable across the [0, 1) range', () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(pickFunMode(() => i / 100));
    expect([...seen].sort()).toEqual([...FUN_MODE_KEYS].sort());
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
    expect(game.pickups).toEqual([]);
    expect(game.effects).toEqual([]);
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
      expect(state.game.pickups).toEqual([]);
      expect(state.game.effects).toEqual([]);
      expect(state.playerPaddle.h).toBe(PADDLE_H);
      expect(state.aiPaddle.h).toBe(PADDLE_H);
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

describe('power-ups mode', () => {
  // rng that walks through a fixed list of values, then repeats the last.
  const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

  function powerUpState() {
    const state = newState();
    applyMode(state, 'powerUps');
    return state;
  }

  test('is registered as a named fun mode with the four pickups', () => {
    expect(MODES.powerUps.name).toBe('Power-Ups');
    expect(MODES.powerUps.fun).toBe(true);
    expect(POWER_UP_KEYS).toEqual(['slowMo', 'ghostBall', 'bigPaddle', 'freezeAi']);
    expect(splashThenBadge('powerUps')).toEqual({
      splashText: 'Power-Ups', splashMs: 1500, badgeText: 'Power-Ups',
    });
  });

  test('setup creates an empty field and arms the spawn timer', () => {
    const { game } = powerUpState();
    expect(game.mode).toBe('powerUps');
    expect(game.pickups).toEqual([]);
    expect(game.effects).toEqual([]);
    expect(game.pickupTimer).toBe(DEFAULT_PACING.spawnIntervalS);
  });

  test('spawnPickup picks each kind from the rng and keeps at most one on the field', () => {
    POWER_UP_KEYS.forEach((kind, i) => {
      const { game } = powerUpState();
      const p = spawnPickup(game, () => (i + 0.5) / POWER_UP_KEYS.length);
      expect(p.kind).toBe(kind);
      expect(p.ttl).toBe(DEFAULT_PACING.pickupLifetimeS);
      expect(p.x).toBeGreaterThanOrEqual(200);
      expect(p.x + PICKUP_SIZE).toBeLessThanOrEqual(CANVAS_W - 200);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + PICKUP_SIZE).toBeLessThanOrEqual(CANVAS_H);
      expect(spawnPickup(game, () => 0)).toBeNull();
      expect(game.pickups).toHaveLength(1);
    });
  });

  test('collectPickup removes a pickup the ball overlaps and ignores a miss', () => {
    const { game } = powerUpState();
    const p = spawnPickup(game, () => 0.1);
    expect(collectPickup(game, ballAt(p.x + 30, p.y + 30, 0, 0))).toBeNull();
    expect(game.pickups).toHaveLength(1);
    expect(collectPickup(game, ballAt(p.x + 2, p.y + 2, 0, 0))).toBe(p);
    expect(game.pickups).toEqual([]);
  });

  test('Slow-Mo scales ball speed, then expires after its duration', () => {
    const state = powerUpState();
    applyEffect(state, 'slowMo');
    expect(ballTimeScale(state.game)).toBe(SLOW_MO_FACTOR);

    state.game.phase = 'playing';
    const ball = ballAt(300, 300, 200, 0);
    updateBalls(ball, state.playerPaddle, state.aiPaddle, state.game, 1, makeRally());
    expect(ball.x).toBeCloseTo(300 + 200 * SLOW_MO_FACTOR);

    tickEffects(state, DEFAULT_PACING.effectDurationsS.slowMo - 0.1);
    expect(state.game.effects).toHaveLength(1);
    tickEffects(state, 0.2);
    expect(state.game.effects).toEqual([]);
    expect(ballTimeScale(state.game)).toBe(1);
  });

  test('Ghost Ball gives the AI a noisy, stale target that re-rolls over time', () => {
    const state = powerUpState();
    const ball = ballAt(400, 300, 100, 0);
    expect(pickAiTarget(ball, [], state.game)).toBe(ball);

    applyEffect(state, 'ghostBall', () => 1);        // offset = +GHOST_NOISE
    const ghost = pickAiTarget(ball, [], state.game);
    expect(ghost.y).toBeCloseTo(300 + GHOST_NOISE);
    expect(ball.y).toBe(300);                          // the real ball is untouched

    tickEffects(state, 0.1, () => 0);                  // still stale
    expect(pickAiTarget(ball, [], state.game).y).toBeCloseTo(300 + GHOST_NOISE);
    tickEffects(state, 1, () => 0);                    // re-rolled to -GHOST_NOISE
    expect(pickAiTarget(ball, [], state.game).y).toBeCloseTo(300 - GHOST_NOISE);

    tickEffects(state, DEFAULT_PACING.effectDurationsS.ghostBall);
    expect(pickAiTarget(ball, [], state.game)).toBe(ball);
  });

  test('Big Paddle raises only the player paddle, then restores it on expiry', () => {
    const state = powerUpState();
    applyEffect(state, 'bigPaddle');
    expect(state.playerPaddle.h).toBe(Math.round(PADDLE_H * BIG_PADDLE_FACTOR));
    expect(state.aiPaddle.h).toBe(PADDLE_H);
    tickEffects(state, DEFAULT_PACING.effectDurationsS.bigPaddle + 0.1);
    expect(state.playerPaddle.h).toBe(PADDLE_H);
    expect(state.game.effects).toEqual([]);
  });

  test('Big Paddle at the screen edge stays on the field when it ends', () => {
    const state = powerUpState();
    state.playerPaddle.y = CANVAS_H - PADDLE_H;
    applyEffect(state, 'bigPaddle');
    expect(state.playerPaddle.y + state.playerPaddle.h).toBeLessThanOrEqual(CANVAS_H);
    tickEffects(state, 10);
    expect(state.playerPaddle.y + PADDLE_H).toBeLessThanOrEqual(CANVAS_H);
  });

  test('Freeze AI stops the AI paddle for about 2 seconds', () => {
    const state = powerUpState();
    const target = ballAt(600, 500, 100, 0);
    applyEffect(state, 'freezeAi');
    expect(isAiFrozen(state.game)).toBe(true);
    const y0 = state.aiPaddle.y;
    moveAiPaddle(state.aiPaddle, target, 0.1, 0, state.game);
    expect(state.aiPaddle.y).toBe(y0);

    tickEffects(state, DEFAULT_PACING.effectDurationsS.freezeAi + 0.1);
    expect(isAiFrozen(state.game)).toBe(false);
    moveAiPaddle(state.aiPaddle, target, 0.1, 0, state.game);
    expect(state.aiPaddle.y).toBeGreaterThan(y0);
  });

  test('every effect uses its steady-pacing duration and re-collecting refreshes it', () => {
    expect(DEFAULT_PACING).toEqual(steadyPacing.clientConfig());
    const state = powerUpState();
    POWER_UP_KEYS.forEach((kind) => {
      expect(applyEffect(state, kind).remaining).toBe(steadyPacing.EFFECT_DURATIONS_S[kind]);
    });
    tickEffects(state, 1);
    applyEffect(state, 'slowMo');
    expect(state.game.effects.filter((e) => e.kind === 'slowMo')).toHaveLength(1);
    expect(state.game.effects.find((e) => e.kind === 'slowMo').remaining).toBe(5);
    expect(applyEffect(state, 'nope')).toBeNull();
  });

  test('updatePowerUps spawns a pickup every ~6s, expires it after ~8s, and applies a hit', () => {
    const state = powerUpState();
    const far = ballAt(10, 10, 0, 0);
    updatePowerUps(state, [far], 5.9, () => 0.1);
    expect(state.game.pickups).toHaveLength(0);
    updatePowerUps(state, [far], 0.2, () => 0.1);
    expect(state.game.pickups).toHaveLength(1);
    // A long spawn interval keeps the next pickup away while the first expires.
    const slowSpawn = Object.assign({}, DEFAULT_PACING, { spawnIntervalS: 100 });
    state.game.pickupTimer = 100;
    updatePowerUps(state, [far], 7.7, () => 0.1, slowSpawn);
    expect(state.game.pickups).toHaveLength(1);
    updatePowerUps(state, [far], 0.4, () => 0.1, slowSpawn);
    expect(state.game.pickups).toHaveLength(0);

    const p = spawnPickup(state.game, () => 0.6);       // bigPaddle (index 2)
    updatePowerUps(state, [ballAt(p.x, p.y, 0, 0)], 0.01, () => 0.1);
    expect(state.game.pickups).toEqual([]);
    expect(state.game.effects.map((e) => e.kind)).toEqual(['bigPaddle']);
  });

  function stateWithEverythingActive() {
    const state = powerUpState();
    POWER_UP_KEYS.forEach((kind) => applyEffect(state, kind));
    spawnPickup(state.game, () => 0);
    return state;
  }

  test('a scored point clears every pickup and effect and restores the paddle', () => {
    const state = stateWithEverythingActive();
    state.game.phase = 'playing';
    const ball = ballAt(CANVAS_W + 5, 300, 100, 0);
    updateBall(ball, state.playerPaddle, state.aiPaddle, state.game, 1 / 60, makeRally());
    expect(state.game.phase).toBe('scored');
    expect(state.game.pickups).toEqual([]);
    expect(state.game.effects).toEqual([]);
    expect(state.playerPaddle.h).toBe(PADDLE_H);
    expect(state.game.pickupTimer).toBe(DEFAULT_PACING.spawnIntervalS);
  });

  test('the winning point clears them too (game over)', () => {
    const state = stateWithEverythingActive();
    state.game.phase = 'playing';
    state.aiPaddle.score = 6;
    const ball = ballAt(-BALL_SIZE - 5, 300, -100, 0);
    updateBall(ball, state.playerPaddle, state.aiPaddle, state.game, 1 / 60, makeRally());
    expect(state.game.phase).toBe('won');
    expect(state.game.pickups).toEqual([]);
    expect(state.game.effects).toEqual([]);
    expect(state.playerPaddle.h).toBe(PADDLE_H);
  });

  test('leaving the mode (any applyMode) tears everything down', () => {
    for (const next of ['normal', 'bigPaddle', 'multiBall', 'bouncyBarriers']) {
      const state = stateWithEverythingActive();
      applyMode(state, next);
      expect(state.game.pickups).toEqual([]);
      expect(state.game.effects).toEqual([]);
      expect(ballTimeScale(state.game)).toBe(1);
      expect(isAiFrozen(state.game)).toBe(false);
      expect(state.aiPaddle.h).toBe(PADDLE_H);
      expect(state.playerPaddle.h).toBe(next === 'bigPaddle' ? Math.round(PADDLE_H * BIG_PADDLE_FACTOR) : PADDLE_H);
    }
  });

  test('clearPowerUps is harmless in other modes', () => {
    const state = newState();
    applyMode(state, 'bigPaddle');
    clearPowerUps(state);
    expect(state.playerPaddle.h).toBe(Math.round(PADDLE_H * BIG_PADDLE_FACTOR));
  });

  test('Normal play ignores power-ups: full speed, AI moves, no pickups', () => {
    const state = newState();
    state.game.phase = 'playing';
    expect(ballTimeScale(state.game)).toBe(1);
    expect(isAiFrozen(state.game)).toBe(false);
    const ball = ballAt(300, 300, 200, 0);
    updateBalls(ball, state.playerPaddle, state.aiPaddle, state.game, 1, makeRally());
    expect(ball.x).toBeCloseTo(500);
    const y0 = state.aiPaddle.y;
    moveAiPaddle(state.aiPaddle, ballAt(600, 500, 100, 0), 0.1, 0, state.game);
    expect(state.aiPaddle.y).toBeGreaterThan(y0);
  });
});

describe('pickup-pacing and where-the-effect-badge-sits options', () => {
  test('steady pacing: one pickup per 6s, 8s on the field, 5/5/5/2s effects', () => {
    expect(steadyPacing.clientConfig()).toEqual({
      pacing: 'steady',
      spawnIntervalS: 6,
      pickupLifetimeS: 8,
      effectDurationsS: { slowMo: 5, ghostBall: 5, bigPaddle: 5, freezeAi: 2 },
    });
  });

  test('rare-and-long pacing: one pickup per 10s, effects 1.5x as long as steady', () => {
    const cfg = rareAndLongPacing.clientConfig();
    expect(cfg).toEqual({
      pacing: 'rare-and-long',
      spawnIntervalS: 10,
      pickupLifetimeS: 8,
      effectDurationsS: { slowMo: 7.5, ghostBall: 7.5, bigPaddle: 7.5, freezeAi: 3 },
    });
    for (const kind of POWER_UP_KEYS) {
      expect(cfg.effectDurationsS[kind]).toBeCloseTo(steadyPacing.EFFECT_DURATIONS_S[kind] * 1.5);
    }
  });

  test('rare-and-long pacing drives spawn timing and effect length in game-logic', () => {
    const state = newState();
    const pacing = rareAndLongPacing.clientConfig();
    applyEffect(state, 'slowMo', Math.random, pacing);
    expect(state.game.effects[0].remaining).toBe(7.5);
    clearPowerUps(state, pacing);
    expect(state.game.pickupTimer).toBe(10);
  });

  test('bottom-right-corner placement', () => {
    expect(bottomRightCorner.clientConfig()).toEqual({ placement: 'bottom-right-corner' });
  });

  test('top-centre placement', () => {
    expect(topCentre.clientConfig()).toEqual({ placement: 'top-centre' });
  });

  describe('beside-player-paddle placement', () => {
    const kinds = { slowMo: { name: 'Slow-Mo', colour: '#4fc3f7' }, freezeAi: { name: 'Freeze AI', colour: '#fff' } };
    const durations = { slowMo: 5, freezeAi: 2 };
    const paddle = { x: 30, y: 100, w: 12, h: 80 };

    test('its config names the placement', () => {
      expect(besidePlayerPaddle.clientConfig()).toEqual({ placement: 'beside-player-paddle' });
    });

    test('chips sit to the right of the paddle, stacked from its top, with the seconds left', () => {
      const chips = besidePlayerPaddle.layoutChips(
        [{ kind: 'slowMo', remaining: 2.5 }, { kind: 'freezeAi', remaining: 2 }], paddle, kinds, durations, 600);
      expect(chips).toHaveLength(2);
      expect(chips[0].x).toBeGreaterThan(paddle.x + paddle.w);
      expect(chips[0].y).toBe(100);
      expect(chips[1].y).toBe(100 + besidePlayerPaddle.CHIP_H + besidePlayerPaddle.CHIP_GAP);
      expect(chips[0].label).toBe('Slow-Mo 3s');
      expect(chips[0].colour).toBe('#4fc3f7');
    });

    test('the chips follow the paddle and stay on the canvas', () => {
      const effects = [{ kind: 'slowMo', remaining: 1 }, { kind: 'freezeAi', remaining: 1 }];
      const moved = besidePlayerPaddle.layoutChips(effects, { ...paddle, y: 300 }, kinds, durations, 600);
      expect(moved[0].y).toBe(300);
      const low = besidePlayerPaddle.layoutChips(effects, { ...paddle, y: 590 }, kinds, durations, 600);
      const last = low[low.length - 1];
      expect(last.y + last.h).toBeLessThanOrEqual(600);
    });

    test('the countdown bar shrinks with the time left and is clamped to 0..1', () => {
      const frac = (remaining) =>
        besidePlayerPaddle.layoutChips([{ kind: 'slowMo', remaining }], paddle, kinds, durations, 600)[0].fraction;
      expect(frac(5)).toBe(1);
      expect(frac(2.5)).toBeCloseTo(0.5);
      expect(frac(0)).toBe(0);
      expect(frac(9)).toBe(1);
    });

    test('no effects means no chips and nothing drawn', () => {
      const ctx = { save: jest.fn(), restore: jest.fn() };
      expect(besidePlayerPaddle.layoutChips([], paddle, kinds, durations, 600)).toEqual([]);
      expect(besidePlayerPaddle.drawChips(ctx, [], paddle, kinds, durations, 600)).toEqual([]);
      expect(ctx.save).not.toHaveBeenCalled();
    });

    test('drawChips paints a chip and a bar per effect and restores the context', () => {
      const ctx = {
        save: jest.fn(), restore: jest.fn(), setLineDash: jest.fn(),
        fillRect: jest.fn(), fillText: jest.fn(),
      };
      besidePlayerPaddle.drawChips(ctx, [{ kind: 'slowMo', remaining: 2 }], paddle, kinds, durations, 600);
      expect(ctx.fillRect).toHaveBeenCalledTimes(3);
      expect(ctx.fillText).toHaveBeenCalledWith('Slow-Mo 2s', expect.any(Number), expect.any(Number));
      expect(ctx.restore).toHaveBeenCalledTimes(1);
    });
  });

  test('the dispatchers return a well-formed option config', () => {
    expect(pickupPacing().spawnIntervalS).toBeGreaterThan(0);
    expect(Object.keys(pickupPacing().effectDurationsS).sort()).toEqual([...POWER_UP_KEYS].sort());
    expect(typeof effectBadgePlacement().placement).toBe('string');
  });
});

describe('original-four power-up set option', () => {
  test('offers Slow-Mo, Ghost Ball, Big Paddle and Freeze AI', () => {
    expect(originalFourSet.clientConfig()).toEqual({
      set: 'original-four',
      kinds: ['slowMo', 'ghostBall', 'bigPaddle', 'freezeAi'],
    });
  });

  test('is the set game-logic uses by default and every kind can spawn', () => {
    expect(DEFAULT_POWER_UP_SET).toEqual(originalFourSet.clientConfig());
    const seen = new Set();
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const game = { pickups: [] };
      seen.add(spawnPickup(game, () => r).kind);
    }
    expect([...seen].sort()).toEqual([...POWER_UP_KEYS].sort());
  });

  test('a set of one kind only spawns that kind', () => {
    const game = { pickups: [] };
    const p = spawnPickup(game, Math.random, undefined, { set: 'x', kinds: ['freezeAi'] });
    expect(p.kind).toBe('freezeAi');
  });

  test('every kind it offers is a known power-up', () => {
    for (const k of originalFourSet.KINDS) expect(POWER_UP_KEYS).toContain(k);
  });
});

describe('slow-mo options', () => {
  const full = () => originalFourSet.clientConfig();

  test('on keeps Slow-Mo in the set and its effect slows the ball, then restores it', () => {
    const set = slowMoOn.applyTo(full());
    expect(set.kinds).toEqual(['slowMo', 'ghostBall', 'bigPaddle', 'freezeAi']);
    const game = { pickups: [] };
    expect(spawnPickup(game, () => 0, undefined, set).kind).toBe('slowMo');
    const state = newState();
    applyEffect(state, 'slowMo');
    expect(ballTimeScale(state.game)).toBe(SLOW_MO_FACTOR);
    tickEffects(state, DEFAULT_PACING.effectDurationsS.slowMo + 0.1);
    expect(ballTimeScale(state.game)).toBe(1);
  });

  test('off leaves Slow-Mo out and the other pickups in', () => {
    const set = slowMoOff.applyTo(full());
    expect(set.kinds).toEqual(['ghostBall', 'bigPaddle', 'freezeAi']);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const game = { pickups: [] };
      expect(spawnPickup(game, () => r, undefined, set).kind).not.toBe('slowMo');
    }
    expect(full().kinds).toContain('slowMo');   // the input is not mutated
  });

  test('the dispatch takes the default option (on) when nothing chooses one', () => {
    expect(slowMo(full(), {})).toEqual(slowMoOn.applyTo(full()));
    expect(slowMo(full(), {}).kinds).toContain('slowMo');
  });
});

describe('ghost-ball options', () => {
  const full = () => originalFourSet.clientConfig();

  test('on keeps Ghost Ball in the set', () => {
    const set = ghostBallOn.applyTo(full());
    expect(set.kinds).toEqual(['slowMo', 'ghostBall', 'bigPaddle', 'freezeAi']);
    const game = { pickups: [] };
    expect(spawnPickup(game, () => 0.3, undefined, set).kind).toBe('ghostBall');
  });

  test('on makes the ball semi-transparent and flickering while the effect runs, then opaque', () => {
    const state = newState();
    expect(ballAlpha(state.game)).toBe(1);
    applyEffect(state, 'ghostBall');
    const seen = new Set();
    for (let t = 0; t < 1; t += 0.01) {
      state.game.effects.find((e) => e.kind === 'ghostBall').remaining = 5 - t;
      seen.add(ballAlpha(state.game));
    }
    expect([...seen].sort()).toEqual([ghostBallOn.ALPHA_LOW, ghostBallOn.ALPHA_HIGH].sort());
    expect(ghostBallOn.ALPHA_HIGH).toBeLessThan(1);
    tickEffects(state, DEFAULT_PACING.effectDurationsS.ghostBall + 0.1);
    expect(ballAlpha(state.game)).toBe(1);
  });

  test('on still collides normally: a ghosted ball bounces off the paddle like any other', () => {
    const state = newState();
    state.game.phase = 'playing';
    applyEffect(state, 'ghostBall');
    state.playerPaddle.y = 0;
    const ball = ballAt(40, 40, -100, 0);
    updateBall(ball, state.playerPaddle, state.aiPaddle, state.game, 1 / 60, makeRally());
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.w).toBe(BALL_SIZE);
  });

  test('off leaves Ghost Ball out and the other pickups in', () => {
    const set = ghostBallOff.applyTo(full());
    expect(set.kinds).toEqual(['slowMo', 'bigPaddle', 'freezeAi']);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const game = { pickups: [] };
      expect(spawnPickup(game, () => r, undefined, set).kind).not.toBe('ghostBall');
    }
    expect(full().kinds).toContain('ghostBall');   // the input is not mutated
  });

  test('the dispatch takes the default option (on) when nothing chooses one', () => {
    expect(ghostBall(full(), {})).toEqual(ghostBallOn.applyTo(full()));
    expect(ghostBall(full(), {}).kinds).toContain('ghostBall');
  });
});

describe('GET /api/config for Power-Ups', () => {
  test('serves the pickup pacing and the effect badge placement', async () => {
    const app = createApp(createFakePrisma(), { logWrite: () => {} });
    const body = await new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/config' }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => { server.close(); resolve(JSON.parse(Buffer.concat(chunks).toString())); });
        }).on('error', (err) => { server.close(); reject(err); });
      });
    });
    expect(body.powerUps).toEqual({ pacing: pickupPacing(), badge: effectBadgePlacement(), set: ghostBall(slowMo(originalFourSet.clientConfig())) });
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

  test('Power-Ups is mirrored in the page: mode, effect badge, clearing at point end', () => {
    expect(html).toMatch(/<div id="pong-effect-badge"[^>]*\bhidden\b/);
    expect(html).toMatch(/#pong-effect-badge \{[^}]*right:[^}]*bottom:/);
    expect(html).toMatch(/#pong-effect-badge\[data-placement="top-centre"\] \{[^}]*top:[^}]*flex-direction: row/);
    expect(html).toMatch(/#pong-effect-badge\[data-placement="beside-player-paddle"\] \{ display: none; \}/);
    expect(html).toContain('/lib/effect-badge-placements/beside-player-paddle.js');
    expect(html).toMatch(/powerUps: \{\s*name: 'Power-Ups'/);
    expect((html.match(/clearPowerUps\(\);/g) || []).length).toBeGreaterThanOrEqual(4);
    for (const key of POWER_UP_KEYS) expect(html).toContain(`${key}:`);
  });

  test('announces the mode and reports fun_mode_started with the mode name', () => {
    expect(html).toMatch(/announceSplashThenBadge\(modeKey\)/);
    expect(html).toMatch(/sendMendelEvent\('fun_mode_started', \{ mode: modeKey \}\)/);
  });
});
