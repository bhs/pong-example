'use strict';

/**
 * lib/ghost-balls/on.js — the "on" option of the ghost-ball Trait.
 *
 * Ghost Ball stays among the pickups the Power-Ups fun mode offers. Hitting it
 * makes the ball semi-transparent and flicker for the effect's few seconds
 * while it still collides normally: only how the ball is drawn changes
 * (ballAlpha), never its position, size or hit test. The effect's other part
 * (the AI chasing a stale, offset target) already lives in game-logic.js
 * (pickAiTarget) and index.html and is kept as it is behind the switch.
 *
 * The page loads this file as a plain script (PongGhostBallOn) and calls
 * ballAlpha from its draw loop; the server side calls applyTo().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PongGhostBallOn = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const OPTION = 'on';

  const ALPHA_HIGH = 0.5;    // flicker: brighter half of the cycle
  const ALPHA_LOW  = 0.15;   // flicker: dimmer half of the cycle
  const FLICKER_HZ = 8;      // full on/off cycles per second

  function applyTo(set) {
    return Object.assign({}, set, { kinds: set.kinds.slice() });
  }

  /**
   * Opacity (0..1) to draw the ball at while a Ghost Ball effect has
   * `remaining` seconds left; 1 (fully opaque) when no effect is active
   * (remaining null/undefined or <= 0).
   */
  function ballAlpha(remaining) {
    if (typeof remaining !== 'number' || !(remaining > 0)) return 1;
    const phase = Math.floor(remaining * FLICKER_HZ * 2) % 2;
    return phase === 0 ? ALPHA_HIGH : ALPHA_LOW;
  }

  return { OPTION, ALPHA_HIGH, ALPHA_LOW, FLICKER_HZ, applyTo, ballAlpha };
}));
