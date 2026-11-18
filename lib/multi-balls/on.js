'use strict';

/**
 * lib/multi-balls/on.js — the "on" option of the multi-ball Trait.
 *
 * Adds the Multi-ball pickup to those the Power-Ups fun mode offers. Hitting
 * it spawns one extra ball, at the position of the ball that hit it and
 * launched at a slightly different angle, for the effect's few seconds. The
 * extra ball is flagged `bonus`: if it leaves the field it is simply removed
 * (it scores nothing), and when the effect ends it is removed too, so the
 * point goes on until the ordinary balls are resolved. The extra ball is kept
 * in game.extraBalls, so the existing multi-ball movement, AI targeting and
 * drawing in game-logic.js and index.html apply to it unchanged.
 *
 * The page loads this file as a plain script (PongMultiBallOn) and calls
 * makeBonusBall when the pickup is hit; the server side calls applyTo().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PongMultiBallOn = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const OPTION = 'on';
  const KIND = 'multiBall';

  const BONUS_ANGLE = 0.5;   // radians the extra ball's heading differs from the ball that hit the pickup

  /** The set with the Multi-ball pickup added (once). The input is not mutated. */
  function applyTo(set) {
    const kinds = set.kinds.slice();
    if (kinds.indexOf(KIND) === -1) kinds.push(KIND);
    return Object.assign({}, set, { kinds });
  }

  /**
   * A new extra ball at `primary`'s position and speed, heading BONUS_ANGLE
   * radians away from its angle. Flagged `bonus`.
   */
  function makeBonusBall(primary) {
    const angle = primary.angle + BONUS_ANGLE;
    return {
      x:     primary.x,
      y:     primary.y,
      speed: primary.speed,
      angle,
      vx:    primary.speed * Math.cos(angle),
      vy:    primary.speed * Math.sin(angle),
      w:     primary.w,
      h:     primary.h,
      bonus: true,
    };
  }

  return { OPTION, KIND, BONUS_ANGLE, applyTo, makeBonusBall };
}));
