'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const CANVAS_W          = 800;
const CANVAS_H          = 600;
const PADDLE_W          = 12;
const PADDLE_H          = 80;
const BALL_SIZE         = 12;
const PADDLE_SPEED      = 350;    // px / second
const BALL_SPEED_INIT   = 300;    // px / second (magnitude)
const BALL_SPEED_MAX    = 700;    // px / second
const BALL_SPEED_MUL    = 1.05;   // speed multiplier on each paddle hit
const AI_LERP           = 4.5;    // AI lerp factor (higher = faster)
const AI_LERP_RALLY_INC = 0.15;   // added to AI lerp per rally hit (difficulty escalation)
const MAX_DEFLECT_ANGLE = Math.PI * 75 / 180;  // 75° max deflection at paddle edge
const SCORE_WIN         = 7;      // first to this wins
const FLASH_FRAMES      = 3;      // number of frames for score-flash effect

/**
 * Returns a random float in [min, max).
 */
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Clamp value v between lo and hi (inclusive).
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Axis-aligned bounding-box overlap test.
 * Returns true when the two rectangles intersect.
 */
function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx &&
         ay < by + bh && ay + ah > by;
}

/**
 * Create a fresh ball state object centred on the canvas.
 *
 * Velocity is stored as a speed scalar plus an angle in radians so that
 * all deflection logic operates directly on the angle.
 *
 * dirSign: +1 launches toward the AI side, -1 toward the player side.
 * A seeded angle can be provided for deterministic tests.
 */
function makeBall(dirSign = 1, angle = null) {
  if (angle === null) {
    angle = rand(-Math.PI / 4, Math.PI / 4);
  }
  // When launching toward the player (dirSign = -1) flip the angle so the
  // ball travels left (angle in (π/2, 3π/2) range via Math.PI offset).
  const launchAngle = dirSign >= 0 ? angle : Math.PI - angle;
  return {
    x:     CANVAS_W / 2 - BALL_SIZE / 2,
    y:     CANVAS_H / 2 - BALL_SIZE / 2,
    speed: BALL_SPEED_INIT,
    angle: launchAngle,
    // Derived vx / vy kept in sync so collision / scoring code is unchanged.
    vx:    BALL_SPEED_INIT * Math.cos(launchAngle),
    vy:    BALL_SPEED_INIT * Math.sin(launchAngle),
    w:     BALL_SIZE,
    h:     BALL_SIZE,
  };
}

/**
 * Create a fresh player paddle state object.
 */
function makePlayerPaddle() {
  return {
    x: 30,
    y: CANVAS_H / 2 - PADDLE_H / 2,
    w: PADDLE_W,
    h: PADDLE_H,
    score: 0,
  };
}

/**
 * Create a fresh AI paddle state object.
 */
function makeAiPaddle() {
  return {
    x: CANVAS_W - 30 - PADDLE_W,
    y: CANVAS_H / 2 - PADDLE_H / 2,
    w: PADDLE_W,
    h: PADDLE_H,
    score: 0,
  };
}

/**
 * Create a fresh game-phase state object.
 */
function makeGame() {
  return {
    phase:      'scored',
    winner:     null,
    pauseTimer: 1.2,
  };
}

/**
 * Create a fresh rally state object.
 *
 * rallyCount is incremented on each paddle hit and reset each time a point is
 * scored.  It drives the AI difficulty escalation and the ball speed curve.
 *
 * flashFrames counts down from FLASH_FRAMES to 0 after a point is scored,
 * providing a brief tinted-screen flash to give visual feedback.
 */
function makeRally() {
  return {
    rallyCount:  0,
    flashFrames: 0,
  };
}

/**
 * Decrement the flash counter by one frame.
 * Returns true while the flash effect is still active (counter > 0 before
 * decrement), false once it has expired.
 */
function tickFlash(rally) {
  if (rally.flashFrames <= 0) return false;
  rally.flashFrames -= 1;
  return rally.flashFrames >= 0;
}

/**
 * Move the player paddle based on the current key map.
 * Mutates paddle in place; returns paddle.
 */
function movePlayerPaddle(paddle, keys, dt) {
  if (keys['KeyW'] || keys['ArrowUp']) {
    paddle.y -= PADDLE_SPEED * dt;
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    paddle.y += PADDLE_SPEED * dt;
  }
  paddle.y = clamp(paddle.y, 0, CANVAS_H - PADDLE_H);
  return paddle;
}

/**
 * Move the AI paddle using linear interpolation toward the ball's Y centre.
 *
 * The effective lerp speed increases slightly with rallyCount to model a
 * difficulty escalation as the rally extends.
 *
 * Mutates paddle in place; returns paddle.
 *
 * @param {object} paddle
 * @param {object} ball
 * @param {number} dt
 * @param {number} [rallyCount=0] - current rally hit count for difficulty scaling
 */
function moveAiPaddle(paddle, ball, dt, rallyCount = 0) {
  const ballCentreY  = ball.y + BALL_SIZE / 2;
  const aiCentreY    = paddle.y + PADDLE_H / 2;
  const diff         = ballCentreY - aiCentreY;
  const effectiveLerp = AI_LERP + rallyCount * AI_LERP_RALLY_INC;
  const move = clamp(diff * effectiveLerp * dt, -PADDLE_SPEED * dt, PADDLE_SPEED * dt);
  paddle.y = clamp(paddle.y + move, 0, CANVAS_H - PADDLE_H);
  return paddle;
}

/**
 * Reflect an angle across the horizontal axis (for top/bottom wall bounces).
 * Equivalent to negating the vertical component: angle → -angle.
 */
function reflectAngleVertical(angle) {
  return -angle;
}

/**
 * Compute the deflection angle when the ball hits a paddle face.
 *
 * relY is the signed distance from the paddle's centre to the ball's centre
 * (positive = ball hit below paddle centre).
 * The returned angle is always in the range [-MAX_DEFLECT_ANGLE, +MAX_DEFLECT_ANGLE].
 */
function deflectAngle(relY) {
  const norm = clamp(relY / (PADDLE_H / 2), -1, 1);
  return norm * MAX_DEFLECT_ANGLE;
}

/**
 * Apply a speed multiplier on paddle hit and clamp to BALL_SPEED_MAX.
 */
function incrementSpeed(speed) {
  return clamp(speed * BALL_SPEED_MUL, BALL_SPEED_INIT, BALL_SPEED_MAX);
}

/**
 * Synchronise ball.vx / ball.vy from ball.speed and ball.angle.
 * Call this after any mutation of speed or angle.
 */
function syncBallVelocity(ball) {
  ball.vx = ball.speed * Math.cos(ball.angle);
  ball.vy = ball.speed * Math.sin(ball.angle);
}

/**
 * Advance the ball one tick and resolve wall + paddle collisions.
 * Also checks for left/right exits and updates scores / game phase.
 *
 * Uses angle-based trigonometry:
 *   - Top/bottom wall: reflect angle across the horizontal axis (negate angle).
 *   - Paddle: compute deflection angle from hit position; multiply speed by
 *     BALL_SPEED_MUL, capped at BALL_SPEED_MAX.
 *
 * When a point is scored, rally.rallyCount resets to 0 and
 * rally.flashFrames is set to FLASH_FRAMES for the screen-flash effect.
 *
 * @param {object} ball          - mutable ball state
 * @param {object} playerPaddle  - mutable player paddle state
 * @param {object} aiPaddle      - mutable AI paddle state
 * @param {object} game          - mutable game phase state
 * @param {number} dt            - delta-time in seconds
 * @param {object} [rally]       - mutable rally state (optional; created if omitted)
 */
function updateBall(ball, playerPaddle, aiPaddle, game, dt, rally) {
  if (!rally) rally = makeRally();

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // ── Top / bottom wall bounce ──────────────────────────────────────────────
  if (ball.y <= 0) {
    ball.y  = 0;
    ball.angle = reflectAngleVertical(ball.angle);
    syncBallVelocity(ball);
  } else if (ball.y + BALL_SIZE >= CANVAS_H) {
    ball.y  = CANVAS_H - BALL_SIZE;
    ball.angle = reflectAngleVertical(ball.angle);
    syncBallVelocity(ball);
  }

  // ── Ball vs player paddle ─────────────────────────────────────────────────
  if (
    ball.vx < 0 &&
    aabbOverlap(ball.x, ball.y, ball.w, ball.h,
                playerPaddle.x, playerPaddle.y, playerPaddle.w, playerPaddle.h)
  ) {
    ball.x  = playerPaddle.x + playerPaddle.w;
    const relY    = (ball.y + BALL_SIZE / 2) - (playerPaddle.y + PADDLE_H / 2);
    ball.angle    = deflectAngle(relY);      // positive angle → launches right + down/up
    ball.speed    = incrementSpeed(ball.speed);
    syncBallVelocity(ball);
    rally.rallyCount += 1;
  }

  // ── Ball vs AI paddle ─────────────────────────────────────────────────────
  if (
    ball.vx > 0 &&
    aabbOverlap(ball.x, ball.y, ball.w, ball.h,
                aiPaddle.x, aiPaddle.y, aiPaddle.w, aiPaddle.h)
  ) {
    ball.x  = aiPaddle.x - BALL_SIZE;
    const relY    = (ball.y + BALL_SIZE / 2) - (aiPaddle.y + PADDLE_H / 2);
    // Reflect back toward the player: π - deflectAngle puts it in the left hemisphere
    ball.angle    = Math.PI - deflectAngle(relY);
    ball.speed    = incrementSpeed(ball.speed);
    syncBallVelocity(ball);
    rally.rallyCount += 1;
  }

  // ── Ball exits left → AI scores ───────────────────────────────────────────
  if (ball.x + BALL_SIZE < 0) {
    aiPaddle.score += 1;
    rally.rallyCount  = 0;
    rally.flashFrames = FLASH_FRAMES;
    if (aiPaddle.score >= SCORE_WIN) {
      game.phase  = 'won';
      game.winner = 'ai';
    } else {
      game.phase      = 'scored';
      game.pauseTimer = 1.2;
    }
  }

  // ── Ball exits right → player scores ─────────────────────────────────────
  if (ball.x > CANVAS_W) {
    playerPaddle.score += 1;
    rally.rallyCount  = 0;
    rally.flashFrames = FLASH_FRAMES;
    if (playerPaddle.score >= SCORE_WIN) {
      game.phase  = 'won';
      game.winner = 'player';
    } else {
      game.phase      = 'scored';
      game.pauseTimer = 1.2;
    }
  }
}

/**
 * Tick the scored-phase pause timer.
 * Returns true when the pause has expired (caller should serve the ball).
 */
function tickPause(game, dt) {
  game.pauseTimer -= dt;
  return game.pauseTimer <= 0;
}

module.exports = {
  // Constants (exported for test assertions)
  CANVAS_W, CANVAS_H,
  PADDLE_W, PADDLE_H,
  BALL_SIZE,
  PADDLE_SPEED,
  BALL_SPEED_INIT, BALL_SPEED_MAX, BALL_SPEED_MUL,
  AI_LERP, AI_LERP_RALLY_INC,
  MAX_DEFLECT_ANGLE,
  SCORE_WIN,
  FLASH_FRAMES,

  // Factory functions
  makeBall,
  makePlayerPaddle,
  makeAiPaddle,
  makeGame,
  makeRally,

  // Pure helpers
  rand,
  clamp,
  aabbOverlap,
  reflectAngleVertical,
  deflectAngle,
  incrementSpeed,
  syncBallVelocity,

  // Update functions
  movePlayerPaddle,
  moveAiPaddle,
  updateBall,
  tickPause,
  tickFlash,
};
