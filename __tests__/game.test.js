'use strict';

const {
  CANVAS_W, CANVAS_H,
  PADDLE_W, PADDLE_H,
  BALL_SIZE,
  PADDLE_SPEED,
  BALL_SPEED_INIT, BALL_SPEED_MAX, BALL_SPEED_INC,
  AI_LERP,
  SCORE_WIN,
  makeBall,
  makePlayerPaddle,
  makeAiPaddle,
  makeGame,
  rand,
  clamp,
  aabbOverlap,
  movePlayerPaddle,
  moveAiPaddle,
  updateBall,
  tickPause,
} = require('../game-logic');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Run updateBall for `steps` frames of `dt` seconds. */
function runFrames(ball, player, ai, game, dt, steps) {
  for (let i = 0; i < steps; i++) {
    if (game.phase !== 'playing') break;
    updateBall(ball, player, ai, game, dt);
  }
}

// ── clamp ─────────────────────────────────────────────────────────────────

describe('clamp', () => {
  test('returns lo when value is below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('returns hi when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('handles equal lo and hi', () => {
    expect(clamp(3, 7, 7)).toBe(7);
  });

  test('handles boundary values exactly', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

// ── rand ──────────────────────────────────────────────────────────────────

describe('rand', () => {
  test('returns a value within [min, max)', () => {
    for (let i = 0; i < 200; i++) {
      const v = rand(-1, 1);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  test('returns a value close to min when min ≈ max', () => {
    const v = rand(5, 5.0001);
    expect(v).toBeGreaterThanOrEqual(5);
    expect(v).toBeLessThan(5.0001);
  });
});

// ── aabbOverlap ───────────────────────────────────────────────────────────

describe('aabbOverlap', () => {
  test('detects clear overlap', () => {
    expect(aabbOverlap(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
  });

  test('detects no overlap (separated horizontally)', () => {
    expect(aabbOverlap(0, 0, 10, 10, 20, 0, 10, 10)).toBe(false);
  });

  test('detects no overlap (separated vertically)', () => {
    expect(aabbOverlap(0, 0, 10, 10, 0, 20, 10, 10)).toBe(false);
  });

  test('touching edges are NOT overlapping', () => {
    // Right edge of A at x=10, left edge of B at x=10 → ax + aw = bx (not <)
    expect(aabbOverlap(0, 0, 10, 10, 10, 0, 10, 10)).toBe(false);
  });

  test('one pixel overlap is detected', () => {
    expect(aabbOverlap(0, 0, 11, 10, 10, 0, 10, 10)).toBe(true);
  });
});

// ── makeBall ──────────────────────────────────────────────────────────────

describe('makeBall', () => {
  test('positions ball at canvas centre', () => {
    const b = makeBall(1, 0);
    expect(b.x).toBeCloseTo(CANVAS_W / 2 - BALL_SIZE / 2);
    expect(b.y).toBeCloseTo(CANVAS_H / 2 - BALL_SIZE / 2);
  });

  test('launches with correct initial speed magnitude', () => {
    const b = makeBall(1, 0);
    const speed = Math.hypot(b.vx, b.vy);
    expect(speed).toBeCloseTo(BALL_SPEED_INIT);
  });

  test('dirSign=+1 launches ball to the right (toward AI)', () => {
    const b = makeBall(1, 0);
    expect(b.vx).toBeGreaterThan(0);
  });

  test('dirSign=-1 launches ball to the left (toward player)', () => {
    const b = makeBall(-1, 0);
    expect(b.vx).toBeLessThan(0);
  });

  test('ball has correct size properties', () => {
    const b = makeBall(1, 0);
    expect(b.w).toBe(BALL_SIZE);
    expect(b.h).toBe(BALL_SIZE);
  });
});

// ── makePlayerPaddle / makeAiPaddle ───────────────────────────────────────

describe('makePlayerPaddle', () => {
  test('starts at left side of canvas', () => {
    const p = makePlayerPaddle();
    expect(p.x).toBe(30);
    expect(p.score).toBe(0);
    expect(p.w).toBe(PADDLE_W);
    expect(p.h).toBe(PADDLE_H);
  });

  test('is vertically centred', () => {
    const p = makePlayerPaddle();
    expect(p.y).toBeCloseTo(CANVAS_H / 2 - PADDLE_H / 2);
  });
});

describe('makeAiPaddle', () => {
  test('starts at right side of canvas', () => {
    const p = makeAiPaddle();
    expect(p.x).toBe(CANVAS_W - 30 - PADDLE_W);
    expect(p.score).toBe(0);
  });

  test('is vertically centred', () => {
    const p = makeAiPaddle();
    expect(p.y).toBeCloseTo(CANVAS_H / 2 - PADDLE_H / 2);
  });
});

// ── makeGame ──────────────────────────────────────────────────────────────

describe('makeGame', () => {
  test('starts in scored phase', () => {
    const g = makeGame();
    expect(g.phase).toBe('scored');
    expect(g.winner).toBeNull();
    expect(g.pauseTimer).toBeGreaterThan(0);
  });
});

// ── movePlayerPaddle ──────────────────────────────────────────────────────

describe('movePlayerPaddle', () => {
  const DT = 1 / 60;

  test('moves up when ArrowUp is held', () => {
    const p = makePlayerPaddle();
    const before = p.y;
    movePlayerPaddle(p, { ArrowUp: true }, DT);
    expect(p.y).toBeLessThan(before);
  });

  test('moves down when ArrowDown is held', () => {
    const p = makePlayerPaddle();
    const before = p.y;
    movePlayerPaddle(p, { ArrowDown: true }, DT);
    expect(p.y).toBeGreaterThan(before);
  });

  test('moves up when KeyW is held', () => {
    const p = makePlayerPaddle();
    const before = p.y;
    movePlayerPaddle(p, { KeyW: true }, DT);
    expect(p.y).toBeLessThan(before);
  });

  test('moves down when KeyS is held', () => {
    const p = makePlayerPaddle();
    const before = p.y;
    movePlayerPaddle(p, { KeyS: true }, DT);
    expect(p.y).toBeGreaterThan(before);
  });

  test('does not move when no keys are held', () => {
    const p = makePlayerPaddle();
    const before = p.y;
    movePlayerPaddle(p, {}, DT);
    expect(p.y).toBe(before);
  });

  test('is clamped at top boundary (y >= 0)', () => {
    const p = makePlayerPaddle();
    p.y = 1;
    // Move up hard enough to go negative
    movePlayerPaddle(p, { ArrowUp: true }, 1); // 1 second = PADDLE_SPEED px
    expect(p.y).toBe(0);
  });

  test('is clamped at bottom boundary (y <= CANVAS_H - PADDLE_H)', () => {
    const p = makePlayerPaddle();
    p.y = CANVAS_H - PADDLE_H - 1;
    movePlayerPaddle(p, { ArrowDown: true }, 1);
    expect(p.y).toBe(CANVAS_H - PADDLE_H);
  });

  test('moves correct distance per frame', () => {
    const p = makePlayerPaddle();
    const before = p.y;
    movePlayerPaddle(p, { ArrowDown: true }, DT);
    expect(p.y - before).toBeCloseTo(PADDLE_SPEED * DT);
  });
});

// ── moveAiPaddle ──────────────────────────────────────────────────────────

describe('moveAiPaddle', () => {
  const DT = 1 / 60;

  test('moves toward ball when ball is above paddle centre', () => {
    const ai   = makeAiPaddle();
    const ball = makeBall(1, 0);
    ai.y   = CANVAS_H / 2;                    // paddle below mid
    ball.y = 0;                                // ball at top
    const before = ai.y;
    moveAiPaddle(ai, ball, DT);
    expect(ai.y).toBeLessThan(before);
  });

  test('moves toward ball when ball is below paddle centre', () => {
    const ai   = makeAiPaddle();
    const ball = makeBall(1, 0);
    ai.y   = 0;                                // paddle above mid
    ball.y = CANVAS_H - BALL_SIZE;             // ball at bottom
    const before = ai.y;
    moveAiPaddle(ai, ball, DT);
    expect(ai.y).toBeGreaterThan(before);
  });

  test('does not exceed PADDLE_SPEED per second', () => {
    const ai   = makeAiPaddle();
    const ball = makeBall(1, 0);
    ai.y   = 0;
    ball.y = CANVAS_H - BALL_SIZE;
    const before = ai.y;
    moveAiPaddle(ai, ball, DT);
    expect(Math.abs(ai.y - before)).toBeLessThanOrEqual(PADDLE_SPEED * DT + 0.001);
  });

  test('is clamped at top boundary', () => {
    const ai   = makeAiPaddle();
    const ball = makeBall(1, 0);
    ai.y   = 1;
    ball.y = 0;
    moveAiPaddle(ai, ball, 1);
    expect(ai.y).toBeGreaterThanOrEqual(0);
  });

  test('is clamped at bottom boundary', () => {
    const ai   = makeAiPaddle();
    const ball = makeBall(1, 0);
    ai.y   = CANVAS_H - PADDLE_H - 1;
    ball.y = CANVAS_H;
    moveAiPaddle(ai, ball, 1);
    expect(ai.y).toBeLessThanOrEqual(CANVAS_H - PADDLE_H);
  });
});

// ── updateBall — wall bounces ─────────────────────────────────────────────

describe('updateBall — wall bounces', () => {
  test('bounces off the top wall', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };

    ball.x  = CANVAS_W / 2;
    ball.y  = 1;
    ball.vx = 0;
    ball.vy = -200;           // heading up

    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.vy).toBeGreaterThan(0); // should now be heading down
  });

  test('bounces off the bottom wall', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };

    ball.x  = CANVAS_W / 2;
    ball.y  = CANVAS_H - BALL_SIZE - 1;
    ball.vx = 0;
    ball.vy = 200;            // heading down

    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.vy).toBeLessThan(0);
  });

  test('ball y is clamped to [0, CANVAS_H - BALL_SIZE] after top bounce', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };

    ball.x  = CANVAS_W / 2;
    ball.y  = -10;            // already past the wall
    ball.vx = 0;
    ball.vy = -500;

    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.y).toBeGreaterThanOrEqual(0);
  });
});

// ── updateBall — paddle collisions ────────────────────────────────────────

describe('updateBall — player paddle collision', () => {
  function makeCollisionSetup() {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };

    // Place ball directly overlapping the player paddle, moving left
    const ball = {
      x:  player.x + player.w - 2,   // slightly inside paddle
      y:  player.y + PADDLE_H / 2 - BALL_SIZE / 2,
      vx: -BALL_SPEED_INIT,
      vy: 0,
      w:  BALL_SIZE,
      h:  BALL_SIZE,
    };
    return { ball, player, ai, game };
  }

  test('ball vx reverses to positive after hitting player paddle', () => {
    const { ball, player, ai, game } = makeCollisionSetup();
    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.vx).toBeGreaterThan(0);
  });

  test('ball is repositioned to the right of the player paddle', () => {
    const { ball, player, ai, game } = makeCollisionSetup();
    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.x).toBeGreaterThanOrEqual(player.x + player.w);
  });

  test('ball speed increases after paddle hit', () => {
    const { ball, player, ai, game } = makeCollisionSetup();
    const speedBefore = Math.hypot(ball.vx, ball.vy);
    updateBall(ball, player, ai, game, 1 / 60);
    const speedAfter = Math.hypot(ball.vx, ball.vy);
    expect(speedAfter).toBeGreaterThan(speedBefore);
  });

  test('ball speed is capped at BALL_SPEED_MAX', () => {
    const { ball, player, ai, game } = makeCollisionSetup();
    ball.vx = -(BALL_SPEED_MAX + 500); // way above max
    updateBall(ball, player, ai, game, 1 / 60);
    const speed = Math.hypot(ball.vx, ball.vy);
    expect(speed).toBeLessThanOrEqual(BALL_SPEED_MAX + 0.01);
  });
});

describe('updateBall — AI paddle collision', () => {
  function makeCollisionSetup() {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };

    const ball = {
      x:  ai.x - BALL_SIZE + 2,      // slightly inside AI paddle
      y:  ai.y + PADDLE_H / 2 - BALL_SIZE / 2,
      vx: BALL_SPEED_INIT,
      vy: 0,
      w:  BALL_SIZE,
      h:  BALL_SIZE,
    };
    return { ball, player, ai, game };
  }

  test('ball vx reverses to negative after hitting AI paddle', () => {
    const { ball, player, ai, game } = makeCollisionSetup();
    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.vx).toBeLessThan(0);
  });

  test('ball is repositioned to the left of the AI paddle', () => {
    const { ball, player, ai, game } = makeCollisionSetup();
    updateBall(ball, player, ai, game, 1 / 60);
    expect(ball.x + BALL_SIZE).toBeLessThanOrEqual(ai.x + 0.01);
  });
});

// ── updateBall — scoring ───────────────────────────────────────────────────

describe('updateBall — scoring', () => {
  test('AI scores when ball exits left', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };
    const ball   = {
      x: -BALL_SIZE - 5,   // already off the left edge
      y: CANVAS_H / 2,
      vx: -100,
      vy: 0,
      w: BALL_SIZE,
      h: BALL_SIZE,
    };

    updateBall(ball, player, ai, game, 1 / 60);
    expect(ai.score).toBe(1);
    expect(player.score).toBe(0);
  });

  test('Player scores when ball exits right', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };
    const ball   = {
      x: CANVAS_W + 5,     // already off the right edge
      y: CANVAS_H / 2,
      vx: 100,
      vy: 0,
      w: BALL_SIZE,
      h: BALL_SIZE,
    };

    updateBall(ball, player, ai, game, 1 / 60);
    expect(player.score).toBe(1);
    expect(ai.score).toBe(0);
  });

  test('transitions to scored phase (not won) when score < SCORE_WIN', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, game, 1 / 60);
    expect(game.phase).toBe('scored');
    expect(game.winner).toBeNull();
  });

  test('transitions to won phase when AI reaches SCORE_WIN', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    ai.score     = SCORE_WIN - 1;          // one away from winning
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, game, 1 / 60);
    expect(ai.score).toBe(SCORE_WIN);
    expect(game.phase).toBe('won');
    expect(game.winner).toBe('ai');
  });

  test('transitions to won phase when player reaches SCORE_WIN', () => {
    const player = makePlayerPaddle();
    player.score = SCORE_WIN - 1;
    const ai     = makeAiPaddle();
    const game   = { phase: 'playing', winner: null, pauseTimer: 0 };
    const ball   = {
      x: CANVAS_W + 5,
      y: CANVAS_H / 2,
      vx: 100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, game, 1 / 60);
    expect(player.score).toBe(SCORE_WIN);
    expect(game.phase).toBe('won');
    expect(game.winner).toBe('player');
  });
});

// ── tickPause ─────────────────────────────────────────────────────────────

describe('tickPause', () => {
  test('decrements pauseTimer', () => {
    const game = makeGame();
    game.pauseTimer = 1.0;
    tickPause(game, 0.1);
    expect(game.pauseTimer).toBeCloseTo(0.9);
  });

  test('returns false when timer has not expired', () => {
    const game = makeGame();
    game.pauseTimer = 1.0;
    expect(tickPause(game, 0.1)).toBe(false);
  });

  test('returns true when timer expires', () => {
    const game = makeGame();
    game.pauseTimer = 0.05;
    expect(tickPause(game, 0.1)).toBe(true);
  });

  test('timer can go negative (caller checks return value)', () => {
    const game = makeGame();
    game.pauseTimer = 0.0;
    tickPause(game, 1.0);
    expect(game.pauseTimer).toBeLessThan(0);
  });
});

// ── constants sanity checks ───────────────────────────────────────────────

describe('constants', () => {
  test('BALL_SPEED_INIT is less than BALL_SPEED_MAX', () => {
    expect(BALL_SPEED_INIT).toBeLessThan(BALL_SPEED_MAX);
  });

  test('PADDLE_H is less than CANVAS_H', () => {
    expect(PADDLE_H).toBeLessThan(CANVAS_H);
  });

  test('BALL_SIZE is less than CANVAS_H', () => {
    expect(BALL_SIZE).toBeLessThan(CANVAS_H);
  });

  test('SCORE_WIN is a positive integer', () => {
    expect(SCORE_WIN).toBeGreaterThan(0);
    expect(Number.isInteger(SCORE_WIN)).toBe(true);
  });

  test('AI_LERP is positive', () => {
    expect(AI_LERP).toBeGreaterThan(0);
  });
});

// ── index.html sanity checks ───────────────────────────────────────────────

describe('index.html', () => {
  const fs   = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  test('contains a canvas element with id="gameCanvas"', () => {
    expect(html).toMatch(/id="gameCanvas"/);
  });

  test('contains requestAnimationFrame', () => {
    expect(html).toMatch(/requestAnimationFrame/);
  });

  test('contains performance.now', () => {
    expect(html).toMatch(/performance\.now/);
  });

  test('contains keydown and keyup event listeners', () => {
    expect(html).toMatch(/keydown/);
    expect(html).toMatch(/keyup/);
  });

  test('contains delta-time computation (dt)', () => {
    // The HTML game loop should reference delta time
    expect(html).toMatch(/\bdt\b/);
  });

  test('defines canvas width and height', () => {
    expect(html).toMatch(/canvas\.width/);
    expect(html).toMatch(/canvas\.height/);
  });

  test('uses ctx.clearRect or ctx.fillRect to clear each frame', () => {
    expect(html).toMatch(/ctx\.(clearRect|fillRect)/);
  });

  test('has a doctype declaration', () => {
    expect(html.trim().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  test('has a <canvas> element', () => {
    expect(html).toMatch(/<canvas/i);
  });

  test('references game sections via comments (State, Input, Update, Render)', () => {
    expect(html).toMatch(/State/);
    expect(html).toMatch(/Input/);
    expect(html).toMatch(/Update/);
    expect(html).toMatch(/Render/);
  });
});
