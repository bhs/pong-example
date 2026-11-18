'use strict';

/**
 * lib/add-random-obstructions-to-the-game-areas/on.js — the "on" option of the
 * add-random-obstructions-to-the-game-area Trait (the default).
 *
 * Adds random obstructions to the Power-Ups fun mode's field. Each point
 * starts with a few bars roughly paddle-sized (OBSTRUCTION_LENGTH x
 * OBSTRUCTION_THICKNESS) at random spots and at any angle, not necessarily
 * parallel or perpendicular to the walls. The ball bounces off them in the
 * usual equal/opposite way: its velocity is mirrored about the surface normal
 * at the point of contact, so the angle out equals the angle in and the speed
 * is unchanged. They are cleared with the other Power-Ups state at point end,
 * game end and on every mode change.
 *
 * The page loads this file as a plain script (PongAddRandomObstructionsOn);
 * game-logic.js requires it. The server side calls applyTo().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PongAddRandomObstructionsOn = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const OPTION = 'on';

  const OBSTRUCTION_COUNT     = 3;
  const OBSTRUCTION_LENGTH    = 80;    // px, the same as a paddle
  const OBSTRUCTION_THICKNESS = 12;    // px, the same as a paddle
  const AREA = { x1: 170, x2: 630, y1: 60, y2: 540 };   // where centres may fall (clear of the paddles)
  const SPAWN_CLEARANCE = 90;          // px kept clear around the centre serve point
  const MIN_SPACING     = 120;         // px between obstruction centres
  const MAX_ATTEMPTS    = 50;          // placement tries per obstruction
  const CENTRE = { x: 400, y: 300 };

  /** The set with random obstructions switched on. The input is not mutated. */
  function applyTo(set) {
    return Object.assign({}, set, { obstructions: true });
  }

  /**
   * A fresh list of obstructions { cx, cy, w, h, angle }; `angle` is the
   * rotation in radians, anywhere in [0, PI). `rng` returns [0, 1) and is
   * injectable so tests can fix the layout.
   */
  function makeObstructions(rng = Math.random) {
    const placed = [];
    for (let i = 0; i < OBSTRUCTION_COUNT; i++) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const cx = AREA.x1 + rng() * (AREA.x2 - AREA.x1);
        const cy = AREA.y1 + rng() * (AREA.y2 - AREA.y1);
        const angle = rng() * Math.PI;
        if (Math.hypot(cx - CENTRE.x, cy - CENTRE.y) < SPAWN_CLEARANCE) continue;
        if (placed.some((o) => Math.hypot(cx - o.cx, cy - o.cy) < MIN_SPACING)) continue;
        placed.push({ cx, cy, w: OBSTRUCTION_LENGTH, h: OBSTRUCTION_THICKNESS, angle });
        break;
      }
    }
    return placed;
  }

  /**
   * Bounce `ball` ({ x, y, w, h, vx, vy, angle }) off any obstruction it
   * touches. The ball is treated as a circle through its box's centre. The
   * velocity is mirrored about the contact normal (angle of incidence = angle
   * of reflection) and the ball is pushed back out; a ball already moving away
   * from the surface is left alone so it cannot get stuck. Returns true when a
   * bounce happened.
   */
  function bounceOffObstructions(ball, obstructions) {
    let bounced = false;
    const r = ball.w / 2;
    for (const o of obstructions || []) {
      const cos = Math.cos(o.angle);
      const sin = Math.sin(o.angle);
      const dx = ball.x + ball.w / 2 - o.cx;
      const dy = ball.y + ball.h / 2 - o.cy;
      // Ball centre in the obstruction's own (rotated) frame.
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const hx = o.w / 2;
      const hy = o.h / 2;
      const qx = Math.max(-hx, Math.min(hx, lx));
      const qy = Math.max(-hy, Math.min(hy, ly));
      const ex = lx - qx;
      const ey = ly - qy;
      const dist = Math.hypot(ex, ey);
      if (dist >= r) continue;

      let nlx;
      let nly;
      let push;
      if (dist > 0) {
        nlx = ex / dist; nly = ey / dist; push = r - dist;
      } else if (hx - Math.abs(lx) < hy - Math.abs(ly)) {   // centre inside: leave by the nearest face
        nlx = lx < 0 ? -1 : 1; nly = 0; push = hx - Math.abs(lx) + r;
      } else {
        nlx = 0; nly = ly < 0 ? -1 : 1; push = hy - Math.abs(ly) + r;
      }
      // Normal in field coordinates.
      const nx = nlx * cos - nly * sin;
      const ny = nlx * sin + nly * cos;

      const dot = ball.vx * nx + ball.vy * ny;
      if (dot >= 0) continue;
      ball.vx -= 2 * dot * nx;
      ball.vy -= 2 * dot * ny;
      ball.angle = Math.atan2(ball.vy, ball.vx);
      ball.x += nx * push;
      ball.y += ny * push;
      bounced = true;
    }
    return bounced;
  }

  return {
    OPTION, OBSTRUCTION_COUNT, OBSTRUCTION_LENGTH, OBSTRUCTION_THICKNESS,
    applyTo, makeObstructions, bounceOffObstructions,
  };
}));
