'use strict';

/**
 * lib/ghost-ball.js — the one place the ghost-ball Trait is read.
 *
 * GHOST_BALL switches the Ghost Ball pickup of the Power-Ups fun mode on or
 * off; it is one of the switches of "which pickups are in the game". Each
 * option's code lives in lib/ghost-balls/. The value is read per call (when
 * the server answers, never at build time); unset or unknown means 'on'.
 *
 * ghostBall(set) takes a power-up set config ({ set, kinds }) and returns it
 * with the Ghost Ball pickup kept (on) or left out (off).
 */

const on = require('./ghost-balls/on');
const off = require('./ghost-balls/off');

function ghostBall(set, env = process.env) {
  switch (String(env.GHOST_BALL || '').trim().toLowerCase()) {
    case 'off':
      return off.applyTo(set);
    case 'on':
    default:
      return on.applyTo(set);
  }
}

module.exports = { ghostBall };
