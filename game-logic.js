'use strict';

const steadyPacing = require('./lib/pickup-pacings/steady');
const originalFourSet = require('./lib/power-up-sets/original-four');
const multiBallOn = require('./lib/multi-balls/on');
const obstructionsOn = require('./lib/add-random-obstructions-to-the-game-areas/on');

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
const BIG_PADDLE_FACTOR = 1.6;    // player paddle height multiplier while the Big Paddle pickup is active
const PICKUP_SIZE       = 24;     // px, side of a 'powerUps' pickup square
const SLOW_MO_FACTOR    = 0.5;    // ball time scale while Slow-Mo is active
const GHOST_NOISE       = 140;    // px, max offset of the AI's ghost target
const GHOST_REROLL_S    = 0.6;    // seconds the AI's ghost target stays stale before re-rolling

// The 'powerUps' mode's timed pickups (multiBall only spawns when its Trait is on). `colour` is the pickup and chip colour.
const POWER_UP_KINDS = {
  slowMo:    { name: 'Slow-Mo',     colour: '#4fc3f7' },
  ghostBall: { name: 'Ghost Ball',  colour: '#ce93d8' },
  bigPaddle: { name: 'Big Paddle',  colour: '#81c784' },
  freezeAi:  { name: 'Freeze AI',   colour: '#ffffff' },
  multiBall: { name: 'Multi-ball',  colour: '#ffb74d' },
};
const POWER_UP_KEYS = Object.keys(POWER_UP_KINDS);

// Pickup spawn rate and effect lengths: the default (steady) pacing. A pacing
// config of the same shape can be passed to any function below.
const DEFAULT_PACING = steadyPacing.clientConfig();

// Which pickups can spawn: the default (original-four) set. A set config of the
// same shape can be passed to spawnPickup and updatePowerUps.
const DEFAULT_POWER_UP_SET = originalFourSet.clientConfig();

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
    mode:       'normal',   // key of MODES
    extraBalls: [],         // balls besides the primary one (Multi-ball pickup)
    pickups:    [],         // pickups on the field ('powerUps')
    effects:    [],         // active timed effects ('powerUps')
    pickupTimer: 0,         // seconds until the next pickup spawns ('powerUps')
    obstructions: [],       // angled bars the ball bounces off ('powerUps' with random obstructions on)
    obstructionsPlaced: false,   // true once this point's obstructions have been placed
    funOption:  null,       // the option the fun button chose ('obstructions' or a pickup kind); null = every enabled option
  };
}

// ── Game modes ──────────────────────────────────────────────────────────────
//
// Each mode has a display name, whether the fun button may pick it, and a
// setup / teardown pair that act on a state object { game, playerPaddle,
// aiPaddle }. applyMode() always tears the previous mode down first, so any
// effect a mode adds is removed again when the next game starts in Normal.

// ── Power-Ups: pickups and timed effects ───────────────────────────────────
//
// Pure functions on a state object { game, playerPaddle, aiPaddle }. `rng`
// returns a float in [0, 1) and is injectable so tests can fix the outcome.
// game.pickups holds at most one pickup { kind, x, y, w, h, ttl }; game.effects
// holds at most one entry per kind { kind, remaining, ... }.

function findEffect(game, kind) {
  return ((game && game.effects) || []).find((e) => e.kind === kind) || null;
}

/** Time scale applied to every ball's movement: Slow-Mo halves it. */
function ballTimeScale(game) {
  return findEffect(game, 'slowMo') ? SLOW_MO_FACTOR : 1;
}

/** True while Freeze AI is active: the AI paddle does not move. */
function isAiFrozen(game) {
  return findEffect(game, 'freezeAi') !== null;
}

/**
 * Spawn one pickup at a random spot in the middle of the field. Does nothing
 * (returns null) when one is already on the field.
 */
function spawnPickup(game, rng = Math.random, pacing = DEFAULT_PACING, set = DEFAULT_POWER_UP_SET) {
  if (!game.pickups) game.pickups = [];
  if (game.pickups.length > 0) return null;
  let kinds = set.kinds.filter((k) => POWER_UP_KINDS[k]);
  if (game.funOption) kinds = kinds.filter((k) => k === game.funOption);
  if (kinds.length === 0) return null;
  const pick = clamp(Math.floor(rng() * kinds.length), 0, kinds.length - 1);
  const pickup = {
    kind: kinds[pick],
    x:    Math.round(200 + rng() * (CANVAS_W - 400 - PICKUP_SIZE)),
    y:    Math.round(60 + rng() * (CANVAS_H - 120 - PICKUP_SIZE)),
    w:    PICKUP_SIZE,
    h:    PICKUP_SIZE,
    ttl:  pacing.pickupLifetimeS,
  };
  game.pickups.push(pickup);
  return pickup;
}

/**
 * Collect the first pickup the ball overlaps: removes it from the field and
 * returns it, or returns null when the ball touches none.
 */
function collectPickup(game, ball) {
  const pickups = game.pickups || [];
  const i = pickups.findIndex((p) => aabbOverlap(ball.x, ball.y, ball.w, ball.h, p.x, p.y, p.w, p.h));
  return i === -1 ? null : pickups.splice(i, 1)[0];
}

/**
 * Undo one effect's side effect: Big Paddle restores the
 * paddle height, Multi-ball removes the extra ball it added (if still in play).
 */
function endEffect(state, effect) {
  if (effect.kind === 'multiBall') {
    state.game.extraBalls = (state.game.extraBalls || []).filter((b) => b !== effect.ball);
  }
  if (effect.kind === 'bigPaddle') {
    const paddle = state.playerPaddle;
    const centre = paddle.y + paddle.h / 2;
    paddle.h = PADDLE_H;
    paddle.y = clamp(centre - PADDLE_H / 2, 0, CANVAS_H - PADDLE_H);
  }
}

/**
 * Start (or refresh) the effect of a collected pickup of `kind`. Returns the
 * effect entry, or null for an unknown kind. `ball` is the ball that hit the
 * pickup; Multi-ball spawns its extra ball from it (from a fresh serve ball
 * when none is given).
 */
function applyEffect(state, kind, rng = Math.random, pacing = DEFAULT_PACING, ball = null) {
  if (!POWER_UP_KINDS[kind]) return null;
  const game = state.game;
  if (!game.effects) game.effects = [];
  const duration = pacing.effectDurationsS[kind];

  const existing = findEffect(game, kind);
  if (existing) {
    existing.remaining = duration;
    return existing;
  }

  const effect = { kind, remaining: duration };
  if (kind === 'bigPaddle') {
    const paddle = state.playerPaddle;
    const centre = paddle.y + paddle.h / 2;
    paddle.h = Math.round(PADDLE_H * BIG_PADDLE_FACTOR);
    paddle.y = clamp(centre - paddle.h / 2, 0, CANVAS_H - paddle.h);
  } else if (kind === 'ghostBall') {
    effect.offset = (rng() * 2 - 1) * GHOST_NOISE;
    effect.rerollIn = GHOST_REROLL_S;
  } else if (kind === 'multiBall') {
    // The extra ball joins game.extraBalls for the effect's few seconds.
    effect.ball = multiBallOn.makeBonusBall(ball || makeBall(1));
    if (!game.extraBalls) game.extraBalls = [];
    game.extraBalls.push(effect.ball);
  }
  game.effects.push(effect);
  return effect;
}

/**
 * An extra ball from a Multi-ball pickup left the field: remove it and end its
 * effect without scoring, so the point goes on with the remaining balls.
 */
function resolveBonusBall(game, ball) {
  game.extraBalls = (game.extraBalls || []).filter((b) => b !== ball);
  game.effects = (game.effects || []).filter((e) => e.ball !== ball);
}

/**
 * Advance every effect by dt seconds; expired effects are removed and undone.
 * Ghost Ball's target offset is re-rolled every GHOST_REROLL_S, so the AI's
 * target is stale between rolls.
 */
function tickEffects(state, dt, rng = Math.random) {
  const game = state.game;
  const active = [];
  for (const effect of game.effects || []) {
    effect.remaining -= dt;
    if (effect.remaining <= 0) {
      endEffect(state, effect);
      continue;
    }
    if (effect.kind === 'ghostBall') {
      effect.rerollIn -= dt;
      if (effect.rerollIn <= 0) {
        effect.offset = (rng() * 2 - 1) * GHOST_NOISE;
        effect.rerollIn = GHOST_REROLL_S;
      }
    }
    active.push(effect);
  }
  game.effects = active;
}

/**
 * Remove every pickup and effect, restoring paddle heights, and restart the
 * spawn timer. Used at point end, game end and on every mode change.
 */
function clearPowerUps(state, pacing = DEFAULT_PACING) {
  const game = state.game;
  for (const effect of game.effects || []) endEffect(state, effect);
  game.effects = [];
  game.pickups = [];
  game.obstructions = [];
  game.obstructionsPlaced = false;
  game.pickupTimer = pacing.spawnIntervalS;
}

/**
 * One tick of the Power-Ups mode while a point is being played: advance the
 * effects, age and expire the pickup, spawn the next one when due, and apply
 * the effect of any pickup a ball hits. `balls` is every ball in play.
 */
function updatePowerUps(state, balls, dt, rng = Math.random, pacing = DEFAULT_PACING, set = DEFAULT_POWER_UP_SET) {
  const game = state.game;

  // Random obstructions (when that option is on): placed once at the start of each point.
  if (set.obstructions && (!game.funOption || game.funOption === 'obstructions') && !game.obstructionsPlaced) {
    game.obstructions = obstructionsOn.makeObstructions(rng);
    game.obstructionsPlaced = true;
  }

  tickEffects(state, dt, rng);

  game.pickups = (game.pickups || []).filter((p) => { p.ttl -= dt; return p.ttl > 0; });

  game.pickupTimer -= dt;
  if (game.pickupTimer <= 0 && spawnPickup(game, rng, pacing, set)) {
    game.pickupTimer = pacing.spawnIntervalS;
  }

  for (const ball of balls) {
    const pickup = collectPickup(game, ball);
    if (pickup) applyEffect(state, pickup.kind, rng, pacing, ball);
  }
}

const MODES = {
  normal: {
    name: 'Normal',
    fun:  false,
    setup() {},
    teardown() {},
  },
  powerUps: {
    name: 'Power-Ups',
    fun:  true,
    setup(state, funOption = null) {
      state.game.funOption = funOption;
      clearPowerUps(state);
    },
    teardown(state) {
      state.game.funOption = null;
      clearPowerUps(state);
      // Belt and braces: both paddles are back to full-size defaults.
      state.playerPaddle.h = PADDLE_H;
      state.aiPaddle.h = PADDLE_H;
    },
  },
};

const FUN_MODE_KEYS = Object.keys(MODES).filter((key) => MODES[key].fun);

/**
 * The fun button always starts Power-Ups, the only fun mode. `rng` is accepted
 * for call compatibility and ignored.
 */
function pickFunMode() {
  return 'powerUps';
}

/**
 * Every option of the Power-Ups mode that is enabled in `set`: the random
 * obstructions (when on) and each pickup kind the set offers.
 */
function funOptions(set = DEFAULT_POWER_UP_SET) {
  const options = set.kinds.filter((k) => POWER_UP_KINDS[k]);
  if (set.obstructions) options.unshift('obstructions');
  return options;
}

/**
 * The option one press of the fun button starts the game with: one of the
 * enabled options, chosen with `rng` (a float in [0, 1)). Null when none is.
 */
function pickFunOption(set = DEFAULT_POWER_UP_SET, rng = Math.random) {
  const options = funOptions(set);
  if (options.length === 0) return null;
  return options[clamp(Math.floor(rng() * options.length), 0, options.length - 1)];
}

const SPLASH_MS = 1500;   // how long the mode name is shown large at game start

/**
 * The 'splash-then-badge' announcement of a mode: its name large in the centre
 * of the screen for SPLASH_MS, then a small corner badge for the rest of the
 * game. Normal play is not announced: no splash and no badge.
 */
function splashThenBadge(modeKey) {
  const mode = MODES[modeKey];
  if (!mode || !mode.fun) return { splashText: null, splashMs: 0, badgeText: null };
  return { splashText: mode.name, splashMs: SPLASH_MS, badgeText: mode.name };
}

/**
 * Switch the game to `modeKey` (unknown keys fall back to 'normal'): tear down
 * the current mode, then set up the new one (Power-Ups starts with `funOption`
 * only, or every enabled option when none is given). Mutates and returns state.game.
 */
function applyMode(state, modeKey, funOption = null) {
  const next = MODES[modeKey] ? modeKey : 'normal';
  MODES[state.game.mode || 'normal'].teardown(state);
  state.game.mode = next;
  MODES[next].setup(state, funOption);
  return state.game;
}

/**
 * Serve: reset the primary ball to the centre. Extra balls only exist while a
 * Multi-ball pickup is active, and none survive a point, so none are kept.
 */
function serveBalls(ball, game, dirSign) {
  Object.assign(ball, makeBall(dirSign));
  game.extraBalls = [];
}

/**
 * Create a fresh rally state object.
 *
 * rallyCount is incremented on each paddle hit and reset each time a point is
 * scored.  It drives the AI difficulty escalation and the ball speed curve.
 *
 * maxRally tracks the highest rallyCount reached at any point during the
 * current game — unlike rallyCount it is never reset by a miss, only by
 * starting a brand-new game (makeRally()). This is the "longest rally"
 * value reported to the high-score endpoint at game-over.
 *
 * flashFrames counts down from FLASH_FRAMES to 0 after a point is scored,
 * providing a brief tinted-screen flash to give visual feedback.
 */
function makeRally() {
  return {
    rallyCount:  0,
    maxRally:    0,
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
function paddleHeight(paddle) {
  return paddle.h === undefined ? PADDLE_H : paddle.h;
}

function movePlayerPaddle(paddle, keys, dt) {
  if (keys['KeyW'] || keys['ArrowUp']) {
    paddle.y -= PADDLE_SPEED * dt;
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    paddle.y += PADDLE_SPEED * dt;
  }
  paddle.y = clamp(paddle.y, 0, CANVAS_H - paddleHeight(paddle));
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
 * @param {object} [game] - when Freeze AI is active in it, the paddle stays put
 */
function moveAiPaddle(paddle, ball, dt, rallyCount = 0, game = null) {
  if (game && isAiFrozen(game)) return paddle;   // Freeze AI power-up
  const ballCentreY  = ball.y + BALL_SIZE / 2;
  const aiCentreY    = paddle.y + paddleHeight(paddle) / 2;
  const diff         = ballCentreY - aiCentreY;
  const effectiveLerp = AI_LERP + rallyCount * AI_LERP_RALLY_INC;
  const move = clamp(diff * effectiveLerp * dt, -PADDLE_SPEED * dt, PADDLE_SPEED * dt);
  paddle.y = clamp(paddle.y + move, 0, CANVAS_H - paddleHeight(paddle));
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
 * paddleH is the height of the paddle that was hit (a big paddle deflects over
 * its whole face).
 * The returned angle is always in the range [-MAX_DEFLECT_ANGLE, +MAX_DEFLECT_ANGLE].
 */
function deflectAngle(relY, paddleH = PADDLE_H) {
  const norm = clamp(relY / (paddleH / 2), -1, 1);
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

  // ── Ball vs random obstructions (empty unless 'powerUps' places them) ─────
  obstructionsOn.bounceOffObstructions(ball, game.obstructions);

  // ── Ball vs player paddle ─────────────────────────────────────────────────
  if (
    ball.vx < 0 &&
    aabbOverlap(ball.x, ball.y, ball.w, ball.h,
                playerPaddle.x, playerPaddle.y, playerPaddle.w, paddleHeight(playerPaddle))
  ) {
    ball.x  = playerPaddle.x + playerPaddle.w;
    const playerH = paddleHeight(playerPaddle);
    const relY    = (ball.y + BALL_SIZE / 2) - (playerPaddle.y + playerH / 2);
    ball.angle    = deflectAngle(relY, playerH);      // positive angle → launches right + down/up
    ball.speed    = incrementSpeed(ball.speed);
    syncBallVelocity(ball);
    rally.rallyCount += 1;
    if (rally.maxRally === undefined || rally.rallyCount > rally.maxRally) {
      rally.maxRally = rally.rallyCount;
    }
  }

  // ── Ball vs AI paddle ─────────────────────────────────────────────────────
  if (
    ball.vx > 0 &&
    aabbOverlap(ball.x, ball.y, ball.w, ball.h,
                aiPaddle.x, aiPaddle.y, aiPaddle.w, paddleHeight(aiPaddle))
  ) {
    ball.x  = aiPaddle.x - BALL_SIZE;
    const aiH     = paddleHeight(aiPaddle);
    const relY    = (ball.y + BALL_SIZE / 2) - (aiPaddle.y + aiH / 2);
    // Reflect back toward the player: π - deflectAngle puts it in the left hemisphere
    ball.angle    = Math.PI - deflectAngle(relY, aiH);
    ball.speed    = incrementSpeed(ball.speed);
    syncBallVelocity(ball);
    rally.rallyCount += 1;
    if (rally.maxRally === undefined || rally.rallyCount > rally.maxRally) {
      rally.maxRally = rally.rallyCount;
    }
  }

  // ── Extra ball from a Multi-ball pickup leaves: resolved, no score ────────
  if (ball.bonus && (ball.x + BALL_SIZE < 0 || ball.x > CANVAS_W)) {
    resolveBonusBall(game, ball);
    return;
  }

  // ── Ball exits ────────────────────────────────────────────────────────────
  const exited = ball.x + BALL_SIZE < 0 ? 'left' : (ball.x > CANVAS_W ? 'right' : null);
  if (!exited) return;

  scorePoint(exited, playerPaddle, aiPaddle, game, rally);
}

/**
 * A ball left the field on `side`: the other side scores. Runs the score
 * flash, win check, serve pause and clearing of power-ups and effects.
 * Exiting left means the player missed, so the AI scores; right the reverse.
 */
function scorePoint(side, playerPaddle, aiPaddle, game, rally) {
  const state = { game, playerPaddle, aiPaddle };
  const scorer = side === 'left' ? aiPaddle : playerPaddle;
  scorer.score += 1;
  rally.rallyCount  = 0;
  rally.flashFrames = FLASH_FRAMES;
  if (scorer.score >= SCORE_WIN) {
    game.phase  = 'won';
    game.winner = side === 'left' ? 'ai' : 'player';
  } else {
    game.phase      = 'scored';
    game.pauseTimer = 1.2;
  }
  clearPowerUps(state);
}

/**
 * Advance the primary ball and every extra ball (Multi-ball pickup) one tick.
 * An extra ball that leaves the field is resolved without a point; the point
 * ends when the primary ball leaves.
 */
function updateBalls(ball, playerPaddle, aiPaddle, game, dt, rally) {
  if (!rally) rally = makeRally();
  const balls = [ball].concat(game.extraBalls || []);
  const ballDt = dt * ballTimeScale(game);   // Slow-Mo slows the balls only
  for (const b of balls) {
    if (game.phase !== 'playing') break;
    updateBall(b, playerPaddle, aiPaddle, game, ballDt, rally);
  }
}

/**
 * The ball the AI should chase: the incoming ball closest to its paddle, or
 * the primary ball when none is heading its way.
 */
function pickAiTarget(ball, extraBalls, game = null) {
  const live = [ball].concat(extraBalls || []);
  const incoming = live.filter((b) => b.vx > 0);
  const target = incoming.length > 0
    ? incoming.reduce((best, b) => (b.x > best.x ? b : best))
    : ball;
  // Ghost Ball: the AI chases a stale, offset copy of the ball's position.
  const ghost = findEffect(game, 'ghostBall');
  if (!ghost) return target;
  return Object.assign({}, target, { y: target.y + ghost.offset });
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
  BIG_PADDLE_FACTOR,
  PICKUP_SIZE, SLOW_MO_FACTOR, GHOST_NOISE, GHOST_REROLL_S,
  POWER_UP_KINDS, POWER_UP_KEYS, DEFAULT_PACING, DEFAULT_POWER_UP_SET,

  // Game modes
  MODES, FUN_MODE_KEYS, SPLASH_MS,
  splashThenBadge,
  pickFunMode, funOptions, pickFunOption,
  applyMode,
  serveBalls,

  // Power-Ups
  spawnPickup, collectPickup, applyEffect, tickEffects, clearPowerUps, resolveBonusBall,
  updatePowerUps, ballTimeScale, isAiFrozen,

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
  updateBalls,
  pickAiTarget,
  tickPause,
  tickFlash,
};
