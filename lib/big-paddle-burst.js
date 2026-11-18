'use strict';

/**
 * lib/big-paddle-burst.js — the one place the big-paddle-burst Trait is read.
 *
 * BIG_PADDLE_BURST switches the Big Paddle pickup of the Power-Ups fun mode on
 * or off; it is one of the switches of "which pickups are in the game". Each
 * option's code lives in lib/big-paddle-bursts/. The value is read per call
 * (when the server answers, never at build time); unset or unknown means 'on'.
 *
 * bigPaddleBurst(set) takes a power-up set config ({ set, kinds }) and returns
 * it with the Big Paddle pickup kept (on) or left out (off).
 */

const on = require('./big-paddle-bursts/on');
const off = require('./big-paddle-bursts/off');

function bigPaddleBurst(set, env = process.env) {
  switch (String(env.BIG_PADDLE_BURST || '').trim().toLowerCase()) {
    case 'off':
      return off.applyTo(set);
    case 'on':
    default:
      return on.applyTo(set);
  }
}

module.exports = { bigPaddleBurst };
