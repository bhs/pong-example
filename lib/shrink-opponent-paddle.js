'use strict';

/**
 * lib/shrink-opponent-paddle.js — the one place the shrink-opponent-paddle
 * Trait is read.
 *
 * SHRINK_OPPONENT_PADDLE switches the Shrink opponent paddle pickup of the
 * Power-Ups fun mode on or off; it is one of the switches of "which pickups
 * are in the game". Each option's code lives in lib/shrink-opponent-paddles/.
 * The value is read per call (when the server answers, never at build time);
 * unset or unknown means 'off'.
 *
 * shrinkOpponentPaddle(set) takes a power-up set config ({ set, kinds }) and
 * returns it with the Shrink opponent paddle pickup added (on) or left out
 * (off).
 */

const on = require('./shrink-opponent-paddles/on');
const off = require('./shrink-opponent-paddles/off');

function shrinkOpponentPaddle(set, env = process.env) {
  switch (String(env.SHRINK_OPPONENT_PADDLE || '').trim().toLowerCase()) {
    case 'on':
      return on.applyTo(set);
    case 'off':
    default:
      return off.applyTo(set);
  }
}

module.exports = { shrinkOpponentPaddle };
