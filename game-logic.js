'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const CANVAS_W        = 800;
const CANVAS_H        = 600;
const PADDLE_W        = 12;
const PADDLE_H        = 80;
const BALL_SIZE       = 12;
const PADDLE_SPEED    = 350;   // px / second
const BALL_SPEED_INIT = 300;   // px / second (magnitude)
const BALL_SPEED_MAX  = 700;   // px / second
const BALL_SPEED_INC  = 25;    // speed added on each paddle hit
const AI_LERP         = 4.5;   // AI lerp factor (higher = faster)
const SCORE_WIN       = 7;     // first to this wins

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
 * dirSign: +1 launches toward the AI side, -1 toward the player side.
 * A seeded angle can be provided for deterministic tests.
 */
function makeBall(dirSign = 1, angle = null) {
  if (angle === null) {
    angle = rand(-Math.PI / 4, Math.PI / 4);
  }
  return {
    x:  CANVAS_W / 2 - BALL_SIZE / 2,
    y:  CANVAS_H / 2 - BALL_SIZE / 2,
    vx: dirSign * BALL_SPEED_INIT * Math.cos(angle),
    vy: BALL_SPEED_INIT * Math.sin(angle),
    w:  BALL_SIZE,
    h:  BALL_SIZE,
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
 * Mutates paddle in place; returns paddle.
 */
function moveAiPaddle(paddle, ball, dt) {
  const ballCentreY = ball.y + BALL_SIZE / 2;
  const aiCentreY   = paddle.y + PADDLE_H / 2;
  const diff        = ballCentreY - aiCentreY;
  const move        = clamp(diff * AI_LERP * dt, -PADDLE_SPEED * dt, PADDLE_SPEED * dt);
  paddle.y = clamp(paddle.y + move, 0, CANVAS_H - PADDLE_H);
  return paddle;
}

/**
 * Advance the ball one tick and resolve wall + paddle collisions.
 * Also checks for left/right exits and updates scores / game phase.
 *
 * @param {object} ball          - mutable ball state
 * @param {object} playerPaddle  - mutable player paddle state
 * @param {object} aiPaddle      - mutable AI paddle state
 * @param {object} game          - mutable game phase state
 * @param {number} dt            - delta-time in seconds
 */
function updateBall(ball, playerPaddle, aiPaddle, game, dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Top / bottom wall bounce
  if (ball.y <= 0) {
    ball.y  = 0;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y + BALL_SIZE >= CANVAS_H) {
    ball.y  = CANVAS_H - BALL_SIZE;
    ball.vy = -Math.abs(ball.vy);
  }

  // Ball vs player paddle
  if (
    ball.vx < 0 &&
    aabbOverlap(ball.x, ball.y, ball.w, ball.h,
                playerPaddle.x, playerPaddle.y, playerPaddle.w, playerPaddle.h)
  ) {
    ball.x = playerPaddle.x + playerPaddle.w;
    const relY  = (ball.y + BALL_SIZE / 2) - (playerPaddle.y + PADDLE_H / 2);
    const norm  = relY / (PADDLE_H / 2);
    const angle = norm * (Math.PI / 4);
    const speed = clamp(
      Math.hypot(ball.vx, ball.vy) + BALL_SPEED_INC,
      BALL_SPEED_INIT,
      BALL_SPEED_MAX
    );
    ball.vx = speed * Math.cos(angle);
    ball.vy = speed * Math.sin(angle);
  }

  // Ball vs AI paddle
  if (
    ball.vx > 0 &&
    aabbOverlap(ball.x, ball.y, ball.w, ball.h,
                aiPaddle.x, aiPaddle.y, aiPaddle.w, aiPaddle.h)
  ) {
    ball.x = aiPaddle.x - BALL_SIZE;
    const relY  = (ball.y + BALL_SIZE / 2) - (aiPaddle.y + PADDLE_H / 2);
    const norm  = relY / (PADDLE_H / 2);
    const angle = norm * (Math.PI / 4);
    const speed = clamp(
      Math.hypot(ball.vx, ball.vy) + BALL_SPEED_INC,
      BALL_SPEED_INIT,
      BALL_SPEED_MAX
    );
    ball.vx = -(speed * Math.cos(angle));
    ball.vy =   speed * Math.sin(angle);
  }

  // Ball exits left → AI scores
  if (ball.x + BALL_SIZE < 0) {
    aiPaddle.score += 1;
    if (aiPaddle.score >= SCORE_WIN) {
      game.phase  = 'won';
      game.winner = 'ai';
    } else {
      game.phase      = 'scored';
      game.pauseTimer = 1.2;
    }
  }

  // Ball exits right → player scores
  if (ball.x > CANVAS_W) {
    playerPaddle.score += 1;
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
  BALL_SPEED_INIT, BALL_SPEED_MAX, BALL_SPEED_INC,
  AI_LERP,
  SCORE_WIN,

  // Factory functions
  makeBall,
  makePlayerPaddle,
  makeAiPaddle,
  makeGame,

  // Pure helpers
  rand,
  clamp,
  aabbOverlap,

  // Update functions
  movePlayerPaddle,
  moveAiPaddle,
  updateBall,
  tickPause,
};
