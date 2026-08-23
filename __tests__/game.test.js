'use strict';

const {
  CANVAS_W, CANVAS_H,
  PADDLE_W, PADDLE_H,
  BALL_SIZE,
  PADDLE_SPEED,
  BALL_SPEED_INIT, BALL_SPEED_MAX, BALL_SPEED_MUL,
  AI_LERP, AI_LERP_RALLY_INC,
  MAX_DEFLECT_ANGLE,
  SCORE_WIN,
  FLASH_FRAMES,
  PAUSE_FRAMES,
  makeBall,
  makePlayerPaddle,
  makeAiPaddle,
  makeScore,
  makeGame,
  makeRally,
  rand,
  clamp,
  aabbOverlap,
  reflectAngleVertical,
  deflectAngle,
  incrementSpeed,
  syncBallVelocity,
  movePlayerPaddle,
  moveAiPaddle,
  updateBall,
  tickPause,
  tickFlash,
} = require('../game-logic');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Run updateBall for `steps` frames of `dt` seconds. */
function runFrames(ball, player, ai, score, game, dt, steps, rally) {
  for (let i = 0; i < steps; i++) {
    if (game.phase !== 'playing') break;
    updateBall(ball, player, ai, score, game, dt, rally);
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

// ── reflectAngleVertical ──────────────────────────────────────────────────

describe('reflectAngleVertical', () => {
  test('negates a positive angle', () => {
    expect(reflectAngleVertical(Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });

  test('negates a negative angle', () => {
    expect(reflectAngleVertical(-Math.PI / 6)).toBeCloseTo(Math.PI / 6);
  });

  test('zero angle stays zero', () => {
    expect(reflectAngleVertical(0)).toBeCloseTo(0);
  });
});

// ── deflectAngle ──────────────────────────────────────────────────────────

describe('deflectAngle', () => {
  test('centre hit (relY=0) produces zero deflection', () => {
    expect(deflectAngle(0)).toBeCloseTo(0);
  });

  test('top-edge hit (relY = -PADDLE_H/2) produces -MAX_DEFLECT_ANGLE', () => {
    expect(deflectAngle(-PADDLE_H / 2)).toBeCloseTo(-MAX_DEFLECT_ANGLE);
  });

  test('bottom-edge hit (relY = +PADDLE_H/2) produces +MAX_DEFLECT_ANGLE', () => {
    expect(deflectAngle(PADDLE_H / 2)).toBeCloseTo(MAX_DEFLECT_ANGLE);
  });

  test('deflection is clamped for hits beyond paddle edge', () => {
    expect(Math.abs(deflectAngle(PADDLE_H * 2))).toBeCloseTo(MAX_DEFLECT_ANGLE);
  });

  test('MAX_DEFLECT_ANGLE is 75 degrees', () => {
    expect(MAX_DEFLECT_ANGLE).toBeCloseTo(Math.PI * 75 / 180);
  });
});

// ── incrementSpeed ────────────────────────────────────────────────────────

describe('incrementSpeed', () => {
  test('multiplies speed by BALL_SPEED_MUL', () => {
    expect(incrementSpeed(300)).toBeCloseTo(300 * BALL_SPEED_MUL);
  });

  test('clamps result to BALL_SPEED_MAX', () => {
    expect(incrementSpeed(BALL_SPEED_MAX)).toBeCloseTo(BALL_SPEED_MAX);
    expect(incrementSpeed(BALL_SPEED_MAX * 10)).toBeCloseTo(BALL_SPEED_MAX);
  });

  test('result is never below BALL_SPEED_INIT', () => {
    expect(incrementSpeed(0)).toBeCloseTo(BALL_SPEED_INIT);
  });

  test('BALL_SPEED_MUL is 1.05', () => {
    expect(BALL_SPEED_MUL).toBeCloseTo(1.05);
  });
});

// ── syncBallVelocity ──────────────────────────────────────────────────────

describe('syncBallVelocity', () => {
  test('sets vx and vy from speed and angle', () => {
    const b = { speed: 300, angle: Math.PI / 4, vx: 0, vy: 0, x: 0, y: 0, w: 12, h: 12 };
    syncBallVelocity(b);
    expect(b.vx).toBeCloseTo(300 * Math.cos(Math.PI / 4));
    expect(b.vy).toBeCloseTo(300 * Math.sin(Math.PI / 4));
  });

  test('magnitude of resulting velocity equals speed', () => {
    const b = { speed: 450, angle: 1.2, vx: 0, vy: 0, x: 0, y: 0, w: 12, h: 12 };
    syncBallVelocity(b);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(450);
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
    expect(b.speed).toBeCloseTo(BALL_SPEED_INIT);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALL_SPEED_INIT);
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

  test('ball exposes speed and angle properties', () => {
    const b = makeBall(1, Math.PI / 6);
    expect(typeof b.speed).toBe('number');
    expect(typeof b.angle).toBe('number');
  });

  test('vx and vy are consistent with speed and angle', () => {
    const b = makeBall(1, Math.PI / 6);
    expect(b.vx).toBeCloseTo(b.speed * Math.cos(b.angle));
    expect(b.vy).toBeCloseTo(b.speed * Math.sin(b.angle));
  });
});

// ── makePlayerPaddle / makeAiPaddle ───────────────────────────────────────

describe('makePlayerPaddle', () => {
  test('starts at left side of canvas', () => {
    const p = makePlayerPaddle();
    expect(p.x).toBe(30);
    expect(p.w).toBe(PADDLE_W);
    expect(p.h).toBe(PADDLE_H);
  });

  test('is vertically centred', () => {
    const p = makePlayerPaddle();
    expect(p.y).toBeCloseTo(CANVAS_H / 2 - PADDLE_H / 2);
  });

  test('does not have a score field (scores live in makeScore)', () => {
    const p = makePlayerPaddle();
    expect(p.score).toBeUndefined();
  });
});

describe('makeAiPaddle', () => {
  test('starts at right side of canvas', () => {
    const p = makeAiPaddle();
    expect(p.x).toBe(CANVAS_W - 30 - PADDLE_W);
  });

  test('is vertically centred', () => {
    const p = makeAiPaddle();
    expect(p.y).toBeCloseTo(CANVAS_H / 2 - PADDLE_H / 2);
  });

  test('does not have a score field (scores live in makeScore)', () => {
    const p = makeAiPaddle();
    expect(p.score).toBeUndefined();
  });
});

// ── makeScore ─────────────────────────────────────────────────────────────

describe('makeScore', () => {
  test('initialises both sides at zero', () => {
    const s = makeScore();
    expect(s.player).toBe(0);
    expect(s.ai).toBe(0);
  });

  test('player and ai fields are independent', () => {
    const s = makeScore();
    s.player = 3;
    expect(s.ai).toBe(0);
  });
});

// ── makeGame ──────────────────────────────────────────────────────────────

describe('makeGame', () => {
  test('starts in scored phase', () => {
    const g = makeGame();
    expect(g.phase).toBe('scored');
    expect(g.winner).toBeNull();
  });

  test('pauseFrames is PAUSE_FRAMES on construction', () => {
    const g = makeGame();
    expect(g.pauseFrames).toBe(PAUSE_FRAMES);
  });

  test('PAUSE_FRAMES constant is 60', () => {
    expect(PAUSE_FRAMES).toBe(60);
  });
});

// ── makeRally ─────────────────────────────────────────────────────────────

describe('makeRally', () => {
  test('initialises with zero rallyCount and flashFrames', () => {
    const r = makeRally();
    expect(r.rallyCount).toBe(0);
    expect(r.flashFrames).toBe(0);
  });
});

// ── tickFlash ─────────────────────────────────────────────────────────────

describe('tickFlash', () => {
  test('returns false when flashFrames is 0', () => {
    const r = makeRally();
    expect(tickFlash(r)).toBe(false);
  });

  test('returns true while flashFrames > 0', () => {
    const r = makeRally();
    r.flashFrames = FLASH_FRAMES;
    expect(tickFlash(r)).toBe(true);
  });

  test('decrements flashFrames each call', () => {
    const r = makeRally();
    r.flashFrames = 3;
    tickFlash(r);
    expect(r.flashFrames).toBe(2);
  });

  test('returns false once counter reaches 0', () => {
    const r = makeRally();
    r.flashFrames = 1;
    tickFlash(r); // flashFrames goes to 0, returns true (was 1 before dec → returns true)
    expect(tickFlash(r)).toBe(false); // now 0, returns false
  });

  test('FLASH_FRAMES constant is positive', () => {
    expect(FLASH_FRAMES).toBeGreaterThan(0);
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

  test('moves faster with higher rallyCount (difficulty escalation)', () => {
    const ai1  = makeAiPaddle();
    const ai2  = makeAiPaddle();
    const ball = makeBall(1, 0);
    // Position AI and ball close enough that the lerp diff * dt is NOT capped,
    // so the rallyCount-based lerp increase actually changes the result.
    // diff = 10 px, DT = 1/60s
    // move0  = 10 * 4.5  * (1/60) ≈ 0.75   (well below PADDLE_SPEED * DT ≈ 5.8)
    // move10 = 10 * 6.0  * (1/60) ≈ 1.0
    ai1.y  = CANVAS_H / 2 - PADDLE_H / 2 - 10;  // paddle 10 px above its normal position
    ai2.y  = ai1.y;
    ball.y = CANVAS_H / 2 - BALL_SIZE / 2;       // ball at centre (paddle centre - 10 below)
    const before = ai1.y;
    moveAiPaddle(ai1, ball, DT, 0);   // no escalation
    moveAiPaddle(ai2, ball, DT, 10);  // 10 rally hits → faster lerp
    expect(ai2.y - before).toBeGreaterThan(ai1.y - before);
  });

  test('AI_LERP_RALLY_INC is positive', () => {
    expect(AI_LERP_RALLY_INC).toBeGreaterThan(0);
  });
});

// ── updateBall — wall bounces ─────────────────────────────────────────────

describe('updateBall — wall bounces', () => {
  test('bounces off the top wall (vy flips positive)', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };

    ball.x     = CANVAS_W / 2;
    ball.y     = 1;
    ball.speed = 200;
    ball.angle = -Math.PI / 4;   // heading up-right
    syncBallVelocity(ball);

    updateBall(ball, player, ai, score, game, 1 / 60);
    expect(ball.vy).toBeGreaterThan(0); // should now be heading down
  });

  test('bounces off the bottom wall (vy flips negative)', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };

    ball.x     = CANVAS_W / 2;
    ball.y     = CANVAS_H - BALL_SIZE - 1;
    ball.speed = 200;
    ball.angle = Math.PI / 4;    // heading down-right
    syncBallVelocity(ball);

    updateBall(ball, player, ai, score, game, 1 / 60);
    expect(ball.vy).toBeLessThan(0);
  });

  test('ball y is clamped to [0, CANVAS_H - BALL_SIZE] after top bounce', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };

    ball.x     = CANVAS_W / 2;
    ball.y     = -10;            // already past the wall
    ball.speed = 500;
    ball.angle = -Math.PI / 4;
    syncBallVelocity(ball);

    updateBall(ball, player, ai, score, game, 1 / 60);
    expect(ball.y).toBeGreaterThanOrEqual(0);
  });

  test('wall bounce preserves ball speed magnitude', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };

    ball.x     = CANVAS_W / 2;
    ball.y     = 1;
    ball.speed = 350;
    ball.angle = -Math.PI / 4;
    syncBallVelocity(ball);
    const speedBefore = ball.speed;

    updateBall(ball, player, ai, score, game, 1 / 60);
    expect(ball.speed).toBeCloseTo(speedBefore);
  });
});

// ── updateBall — paddle collisions ────────────────────────────────────────

describe('updateBall — player paddle collision', () => {
  function makeCollisionSetup() {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();

    // Place ball directly overlapping the player paddle, moving left
    const ball = {
      x:     player.x + player.w - 2,   // slightly inside paddle
      y:     player.y + PADDLE_H / 2 - BALL_SIZE / 2,
      speed: BALL_SPEED_INIT,
      angle: Math.PI,                    // heading left
      vx:    -BALL_SPEED_INIT,
      vy:    0,
      w:     BALL_SIZE,
      h:     BALL_SIZE,
    };
    return { ball, player, ai, score, game, rally };
  }

  test('ball vx reverses to positive after hitting player paddle', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.vx).toBeGreaterThan(0);
  });

  test('ball is repositioned to the right of the player paddle', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.x).toBeGreaterThanOrEqual(player.x + player.w);
  });

  test('ball speed increases after paddle hit (multiplied by BALL_SPEED_MUL)', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    const speedBefore = ball.speed;
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.speed).toBeCloseTo(speedBefore * BALL_SPEED_MUL);
  });

  test('ball speed is capped at BALL_SPEED_MAX', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    ball.speed = BALL_SPEED_MAX + 500;   // way above max
    ball.vx    = -(BALL_SPEED_MAX + 500);
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.speed).toBeLessThanOrEqual(BALL_SPEED_MAX + 0.01);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(BALL_SPEED_MAX + 0.01);
  });

  test('centre hit produces a near-zero vertical component', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    // Ball centre is at paddle centre → deflectAngle(0) = 0
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(Math.abs(ball.vy)).toBeLessThan(10);
  });

  test('edge hit produces steep deflection (close to MAX_DEFLECT_ANGLE)', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    // Move ball to top edge of paddle
    ball.y = player.y;
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    const deflect = Math.abs(Math.atan2(ball.vy, ball.vx));
    expect(deflect).toBeGreaterThan(Math.PI * 60 / 180); // at least 60°
  });

  test('rally count increments on paddle hit', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    expect(rally.rallyCount).toBe(0);
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(rally.rallyCount).toBe(1);
  });

  test('deflection angle after player paddle hit is within [-MAX_DEFLECT_ANGLE, +MAX_DEFLECT_ANGLE]', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    const angle = Math.atan2(ball.vy, ball.vx);
    expect(Math.abs(angle)).toBeLessThanOrEqual(MAX_DEFLECT_ANGLE + 0.001);
  });
});

describe('updateBall — AI paddle collision', () => {
  function makeCollisionSetup() {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();

    const ball = {
      x:     ai.x - BALL_SIZE + 2,      // slightly inside AI paddle
      y:     ai.y + PADDLE_H / 2 - BALL_SIZE / 2,
      speed: BALL_SPEED_INIT,
      angle: 0,                          // heading right
      vx:    BALL_SPEED_INIT,
      vy:    0,
      w:     BALL_SIZE,
      h:     BALL_SIZE,
    };
    return { ball, player, ai, score, game, rally };
  }

  test('ball vx reverses to negative after hitting AI paddle', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.vx).toBeLessThan(0);
  });

  test('ball is repositioned to the left of the AI paddle', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.x + BALL_SIZE).toBeLessThanOrEqual(ai.x + 0.01);
  });

  test('ball speed increases on AI paddle hit', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    const speedBefore = ball.speed;
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(ball.speed).toBeCloseTo(speedBefore * BALL_SPEED_MUL);
  });

  test('rally count increments on AI paddle hit', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(rally.rallyCount).toBe(1);
  });

  test('centre AI hit returns ball roughly horizontally leftward', () => {
    const { ball, player, ai, score, game, rally } = makeCollisionSetup();
    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    // deflectAngle(0) = 0 → angle = Math.PI → vx ≈ -speed, vy ≈ 0
    expect(ball.vx).toBeLessThan(0);
    expect(Math.abs(ball.vy)).toBeLessThan(10);
  });
});

// ── updateBall — angle-based reflection ───────────────────────────────────

describe('updateBall — angle-based reflection', () => {
  test('angle is stored on ball and synced to vx/vy', () => {
    const ball   = makeBall(1, 0);
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };

    expect(typeof ball.angle).toBe('number');
    expect(ball.vx).toBeCloseTo(ball.speed * Math.cos(ball.angle));
    expect(ball.vy).toBeCloseTo(ball.speed * Math.sin(ball.angle));
  });

  test('after top-wall bounce angle is reflected (vertical component flipped)', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const ball   = {
      x: CANVAS_W / 2, y: 1,
      speed: 300, angle: -Math.PI / 4,
      vx: 300 * Math.cos(-Math.PI / 4),
      vy: 300 * Math.sin(-Math.PI / 4),
      w: BALL_SIZE, h: BALL_SIZE,
    };
    const angleBefore = ball.angle;
    updateBall(ball, player, ai, score, game, 1 / 60);
    expect(ball.angle).toBeCloseTo(-angleBefore);
  });

  test('speed multiplier applies on each successive paddle hit', () => {
    // Simulate two successive paddle hits and verify compounding speed
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();

    // Hit player paddle once
    const ball1 = {
      x: player.x + player.w - 2,
      y: player.y + PADDLE_H / 2 - BALL_SIZE / 2,
      speed: BALL_SPEED_INIT, angle: Math.PI,
      vx: -BALL_SPEED_INIT, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };
    updateBall(ball1, player, ai, score, game, 1 / 60, rally);
    const afterFirst = ball1.speed;
    expect(afterFirst).toBeCloseTo(BALL_SPEED_INIT * BALL_SPEED_MUL);

    // Hit AI paddle once (simulate by setting up new position)
    ball1.x = ai.x - BALL_SIZE + 2;
    ball1.angle = 0; ball1.vx = afterFirst; ball1.vy = 0;
    updateBall(ball1, player, ai, score, game, 1 / 60, rally);
    expect(ball1.speed).toBeCloseTo(BALL_SPEED_INIT * BALL_SPEED_MUL * BALL_SPEED_MUL);
  });
});

// ── updateBall — scoring ───────────────────────────────────────────────────

describe('updateBall — scoring', () => {
  test('AI scores when ball exits left', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: -BALL_SIZE - 5,   // already off the left edge
      y: CANVAS_H / 2,
      speed: 100, angle: Math.PI,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(score.ai).toBe(1);
    expect(score.player).toBe(0);
  });

  test('Player scores when ball exits right', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: CANVAS_W + 5,     // already off the right edge
      y: CANVAS_H / 2,
      speed: 100, angle: 0,
      vx: 100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(score.player).toBe(1);
    expect(score.ai).toBe(0);
  });

  test('transitions to scored phase (not gameover) when score < SCORE_WIN', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      speed: 100, angle: Math.PI,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(game.phase).toBe('scored');
    expect(game.winner).toBeNull();
  });

  test('transitions to gameover phase when AI reaches SCORE_WIN', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    score.ai     = SCORE_WIN - 1;          // one away from winning
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      speed: 100, angle: Math.PI,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(score.ai).toBe(SCORE_WIN);
    expect(game.phase).toBe('gameover');
    expect(game.winner).toBe('ai');
  });

  test('transitions to gameover phase when player reaches SCORE_WIN', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    score.player = SCORE_WIN - 1;
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: CANVAS_W + 5,
      y: CANVAS_H / 2,
      speed: 100, angle: 0,
      vx: 100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(score.player).toBe(SCORE_WIN);
    expect(game.phase).toBe('gameover');
    expect(game.winner).toBe('player');
  });

  test('scoring resets rallyCount to 0', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    rally.rallyCount = 5;
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      speed: 100, angle: Math.PI,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(rally.rallyCount).toBe(0);
  });

  test('scoring sets flashFrames to FLASH_FRAMES', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      speed: 100, angle: Math.PI,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    expect(rally.flashFrames).toBe(FLASH_FRAMES);
  });

  test('after scoring, pauseFrames is reset to PAUSE_FRAMES', () => {
    const player = makePlayerPaddle();
    const ai     = makeAiPaddle();
    const score  = makeScore();
    const game   = { phase: 'playing', winner: null, pauseFrames: 0 };
    const rally  = makeRally();
    const ball   = {
      x: -BALL_SIZE - 5,
      y: CANVAS_H / 2,
      speed: 100, angle: Math.PI,
      vx: -100, vy: 0,
      w: BALL_SIZE, h: BALL_SIZE,
    };

    updateBall(ball, player, ai, score, game, 1 / 60, rally);
    // Phase is 'scored' (score < SCORE_WIN), so pauseFrames should be reset
    expect(game.pauseFrames).toBe(PAUSE_FRAMES);
  });
});

// ── tickPause ─────────────────────────────────────────────────────────────

describe('tickPause', () => {
  test('decrements pauseFrames by 1 per call', () => {
    const game = makeGame();
    game.pauseFrames = 60;
    tickPause(game);
    expect(game.pauseFrames).toBe(59);
  });

  test('returns false when timer has not expired', () => {
    const game = makeGame();
    game.pauseFrames = 10;
    expect(tickPause(game)).toBe(false);
  });

  test('returns true when pauseFrames reaches 0', () => {
    const game = makeGame();
    game.pauseFrames = 1;
    expect(tickPause(game)).toBe(true);
  });

  test('returns true when pauseFrames goes negative', () => {
    const game = makeGame();
    game.pauseFrames = 0;
    expect(tickPause(game)).toBe(true);
  });

  test('PAUSE_FRAMES is 60 (one second at 60 fps)', () => {
    expect(PAUSE_FRAMES).toBe(60);
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

  test('BALL_SPEED_MUL is greater than 1', () => {
    expect(BALL_SPEED_MUL).toBeGreaterThan(1);
  });

  test('MAX_DEFLECT_ANGLE is less than 90 degrees', () => {
    expect(MAX_DEFLECT_ANGLE).toBeLessThan(Math.PI / 2);
  });

  test('FLASH_FRAMES is a positive integer', () => {
    expect(FLASH_FRAMES).toBeGreaterThan(0);
    expect(Number.isInteger(FLASH_FRAMES)).toBe(true);
  });

  test('PAUSE_FRAMES is a positive integer equal to 60', () => {
    expect(PAUSE_FRAMES).toBe(60);
    expect(Number.isInteger(PAUSE_FRAMES)).toBe(true);
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

  test('uses angle-based ball velocity (angle and speed properties)', () => {
    expect(html).toMatch(/ball\.angle/);
    expect(html).toMatch(/ball\.speed/);
  });

  test('uses syncBallVelocity or equivalent (Math.cos/Math.sin for vx/vy)', () => {
    expect(html).toMatch(/Math\.cos/);
    expect(html).toMatch(/Math\.sin/);
  });

  test('references BALL_SPEED_MUL for speed multiplier', () => {
    expect(html).toMatch(/BALL_SPEED_MUL/);
  });

  test('references MAX_DEFLECT_ANGLE for deflection', () => {
    expect(html).toMatch(/MAX_DEFLECT_ANGLE/);
  });

  test('references rally.flashFrames for score flash effect', () => {
    expect(html).toMatch(/flashFrames/);
  });

  test('references rally.rallyCount for difficulty escalation', () => {
    expect(html).toMatch(/rallyCount/);
  });

  test('references AI_LERP_RALLY_INC for difficulty escalation', () => {
    expect(html).toMatch(/AI_LERP_RALLY_INC/);
  });

  // ── New game-over / score-object tests ──────────────────────────────────

  test('uses a score object with player and ai fields', () => {
    expect(html).toMatch(/score\.player/);
    expect(html).toMatch(/score\.ai/);
  });

  test('uses gameover as the win phase name', () => {
    expect(html).toMatch(/gameover/);
  });

  test('uses Space key to restart from gameover', () => {
    expect(html).toMatch(/Space/);
    expect(html).toMatch(/gameover/);
  });

  test('renders score via fillText', () => {
    expect(html).toMatch(/fillText/);
  });

  test('renders game-over overlay with semi-transparent fillRect', () => {
    // The overlay uses rgba with some alpha < 1
    expect(html).toMatch(/rgba\(/);
  });

  test('displays Press Space to Restart prompt on gameover', () => {
    expect(html).toMatch(/Press Space to Restart/);
  });

  test('uses PAUSE_FRAMES for inter-point pause', () => {
    expect(html).toMatch(/PAUSE_FRAMES/);
  });

  test('references pauseFrames counter (frame-based, not dt-based)', () => {
    expect(html).toMatch(/pauseFrames/);
  });

  test('game-over screen drawn entirely in canvas (no DOM overlay)', () => {
    // Verify the game-over text is drawn via ctx methods, not DOM elements
    expect(html).toMatch(/ctx\.fillText/);
    // No extra DOM elements (no <div id="gameover"> etc.)
    expect(html).not.toMatch(/<div[^>]*gameover/i);
  });
});
