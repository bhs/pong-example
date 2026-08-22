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
const BALL_SPEED_INC  = 25;    // |vx| added on each paddle hit
const MIN_VY          = 40;    // minimum |vy| so ball never travels perfectly horizontal
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
 * Swept-position collision helper.
 *
 * Computes the interpolation factor t ∈ [0,1] at which the ball's leading
 * horizontal edge first crosses the paddle's facing edge during this frame.
 * Returns 1 when the edge crossing did not occur within this frame
 * (i.e. t ∉ [0,1]).
 *
 * For vx < 0 (moving left):  leading edge = ball.x, target = paddle right face (bx+bw)
 * For vx > 0 (moving right): leading edge = ball.x+BALL_SIZE, equivalently ball.x target = bx−BALL_SIZE
 *
 * @param {number} px  - previous ball.x
 * @param {number} cx  - current  ball.x (end of this frame)
 * @param {number} bx  - paddle x
 * @param {number} bw  - paddle w
 * @param {number} vx  - ball vx (sign selects which face to test)
 * @returns {number}   t ∈ [0,1] at edge crossing, or 1 if none
 */
function sweepT(px, cx, bx, bw, vx) {
  const edgeX = vx < 0
    ? bx + bw          // ball moving left  → paddle's right face
    : bx - BALL_SIZE;  // ball moving right → paddle's left  face (ball.x = bx - BALL_SIZE)

  const dx = cx - px;
  if (Math.abs(dx) < 1e-10) return 1;

  const t = (edgeX - px) / dx;
  return (t >= 0 && t <= 1) ? t : 1;
}

/**
 * Full swept paddle collision check.
 *
 * Determines whether the ball hit the paddle during this frame, using the
 * previous (px,py) and current (cx,cy) ball positions.  Two paths are tried:
 *
 * 1. Sweep: find the t at which the ball's leading x edge crosses the paddle's
 *    facing edge, then confirm the y position at that t overlaps the paddle.
 * 2. AABB fallback: if the final position overlaps the paddle (e.g. the ball
 *    started already inside the paddle rect in test setups).
 *
 * Returns { hit: boolean, t: number } where t is used to interpolate hitY.
 *
 * @param {number} px   - previous ball.x
 * @param {number} py   - previous ball.y
 * @param {number} cx   - current  ball.x
 * @param {number} cy   - current  ball.y
 * @param {number} vx   - ball vx (sign matters for face selection)
 * @param {object} pad  - paddle {x, y, w, h}
 * @returns {{ hit: boolean, t: number }}
 */
function sweepPaddleT(px, py, cx, cy, vx, pad) {
  // ── Path 1: swept edge crossing ─────────────────────────────────────────
  const t = sweepT(px, cx, pad.x, pad.w, vx);
  if (t < 1) {
    const hitY = py + (cy - py) * t;
    if (hitY + BALL_SIZE > pad.y && hitY < pad.y + pad.h) {
      return { hit: true, t }; // valid swept collision
    }
  }

  // ── Path 2: AABB fallback (ball started inside or on boundary) ──────────
  if (aabbOverlap(cx, cy, BALL_SIZE, BALL_SIZE, pad.x, pad.y, pad.w, pad.h)) {
    return { hit: true, t: 1 };
  }

  return { hit: false, t: 1 };
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
 * Clamps movement to canvas bounds each frame.
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
 * Clamps movement to canvas bounds each frame.
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
 * Advance the ball one tick and resolve wall + paddle collisions using
 * a swept-position (AABB + interpolation) approach to prevent tunneling.
 *
 * Collision rules:
 *  - Top/bottom wall: negate vy; clamp y.
 *  - Paddle hit: negate vx; nudge ball outside paddle rect; adjust vy
 *    proportionally to how far off-centre the hit landed (±0.5 vy range);
 *    increase |vx| by BALL_SPEED_INC (capped at BALL_SPEED_MAX).
 *  - Minimum |vy| guard applied after each frame so the ball never travels
 *    perfectly horizontally.
 *
 * Also checks for left/right exits and updates scores / game phase.
 *
 * @param {object} ball          - mutable ball state
 * @param {object} playerPaddle  - mutable player paddle state
 * @param {object} aiPaddle      - mutable AI paddle state
 * @param {object} game          - mutable game phase state
 * @param {number} dt            - delta-time in seconds
 */
function updateBall(ball, playerPaddle, aiPaddle, game, dt) {
  // Record previous position for swept collision
  const prevX = ball.x;
  const prevY = ball.y;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // ── Top / bottom wall bounce ───────────────────────────────────────────
  if (ball.y <= 0) {
    ball.y  = 0;
    ball.vy = -ball.vy;          // negate vy
  } else if (ball.y + BALL_SIZE >= CANVAS_H) {
    ball.y  = CANVAS_H - BALL_SIZE;
    ball.vy = -ball.vy;          // negate vy
  }

  // ── Ball vs player paddle (ball moving left) ───────────────────────────
  if (ball.vx < 0) {
    const { hit, t } = sweepPaddleT(prevX, prevY, ball.x, ball.y, ball.vx, playerPaddle);
    if (hit) {
      // Interpolated y position at contact moment
      const hitY = prevY + (ball.y - prevY) * t;

      // Nudge ball outside the paddle rect (prevent tunneling)
      ball.x = playerPaddle.x + playerPaddle.w;

      // Negate vx and increase its magnitude
      const newVxMag = clamp(Math.abs(ball.vx) + BALL_SPEED_INC, BALL_SPEED_INIT, BALL_SPEED_MAX);
      ball.vx = newVxMag;          // now positive (moving right)

      // Adjust vy proportional to off-centre offset (±0.5 * current |vy| range)
      const ballCentreY   = hitY + BALL_SIZE / 2;
      const paddleCentreY = playerPaddle.y + PADDLE_H / 2;
      const norm          = clamp((ballCentreY - paddleCentreY) / (PADDLE_H / 2), -1, 1);
      ball.vy += norm * 0.5 * Math.abs(ball.vy);
    }
  }

  // ── Ball vs AI paddle (ball moving right) ─────────────────────────────
  if (ball.vx > 0) {
    const { hit, t } = sweepPaddleT(prevX, prevY, ball.x, ball.y, ball.vx, aiPaddle);
    if (hit) {
      // Interpolated y position at contact moment
      const hitY = prevY + (ball.y - prevY) * t;

      // Nudge ball outside the paddle rect
      ball.x = aiPaddle.x - BALL_SIZE;

      // Negate vx and increase its magnitude
      const newVxMag = clamp(Math.abs(ball.vx) + BALL_SPEED_INC, BALL_SPEED_INIT, BALL_SPEED_MAX);
      ball.vx = -newVxMag;         // now negative (moving left)

      // Adjust vy proportional to off-centre offset
      const ballCentreY   = hitY + BALL_SIZE / 2;
      const paddleCentreY = aiPaddle.y + PADDLE_H / 2;
      const norm          = clamp((ballCentreY - paddleCentreY) / (PADDLE_H / 2), -1, 1);
      ball.vy += norm * 0.5 * Math.abs(ball.vy);
    }
  }

  // ── Minimum |vy| guard ─────────────────────────────────────────────────
  // Prevent the ball from travelling perfectly horizontally.
  if (Math.abs(ball.vy) < MIN_VY) {
    ball.vy = ball.vy >= 0 ? MIN_VY : -MIN_VY;
  }

  // ── Ball exits left → AI scores ────────────────────────────────────────
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

  // ── Ball exits right → player scores ───────────────────────────────────
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
  MIN_VY,
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
  sweepT,
  sweepPaddleT,

  // Update functions
  movePlayerPaddle,
  moveAiPaddle,
  updateBall,
  tickPause,
};
