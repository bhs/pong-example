'use strict';

/**
 * lib/multi-ball.js — the one place the multi-ball Trait is read.
 *
 * MULTI_BALL switches the Multi-ball pickup of the Power-Ups fun mode on or
 * off; it is one of the switches of "which pickups are in the game". Each
 * option's code lives in lib/multi-balls/. The value is read per call (when
 * the server answers, never at build time); unset or unknown means 'on'.
 *
 * multiBall(set) takes a power-up set config ({ set, kinds }) and returns it
 * with the Multi-ball pickup added (on) or left out (off).
 */

const on = require('./multi-balls/on');
const off = require('./multi-balls/off');

function multiBall(set, env = process.env) {
  switch (String(env.MULTI_BALL || '').trim().toLowerCase()) {
    case 'off':
      return off.applyTo(set);
    case 'on':
    default:
      return on.applyTo(set);
  }
}

module.exports = { multiBall };
