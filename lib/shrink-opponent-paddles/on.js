'use strict';

/**
 * lib/shrink-opponent-paddles/on.js — the "on" option of the
 * shrink-opponent-paddle Trait.
 *
 * Adds the Shrink opponent paddle pickup to those the Power-Ups fun mode
 * offers. Hitting it shrinks the AI paddle by about a third (SHRINK_FACTOR) for
 * the effect's few seconds, around its centre, then returns it to normal size.
 * game-logic.js (applyEffect, endEffect) and index.html call shrunkHeight()
 * and the existing effect, badge and clearing code handles the rest.
 *
 * The page loads this file as a plain script (PongShrinkOpponentPaddleOn); the
 * server side calls applyTo().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PongShrinkOpponentPaddleOn = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const OPTION = 'on';
  const KIND = 'shrinkOpponent';

  const SHRINK_FACTOR = 2 / 3;   // the AI paddle's height while shrunk, as a share of normal

  /** The set with the Shrink opponent paddle pickup added (once). The input is not mutated. */
  function applyTo(set) {
    const kinds = set.kinds.slice();
    if (kinds.indexOf(KIND) === -1) kinds.push(KIND);
    return Object.assign({}, set, { kinds });
  }

  /** The AI paddle's height while shrunk, for a normal height of `normalH`. */
  function shrunkHeight(normalH) {
    return Math.round(normalH * SHRINK_FACTOR);
  }

  return { OPTION, KIND, SHRINK_FACTOR, applyTo, shrunkHeight };
}));
