'use strict';

/**
 * lib/slow-mo.js — the one place the slow-mo Trait is read.
 *
 * SLOW_MO switches the Slow-Mo pickup of the Power-Ups fun mode on or off; it
 * is one of the switches of "which pickups are in the game". Each option's code
 * lives in lib/slow-mos/. The value is read per call (when the server answers,
 * never at build time); unset or unknown means 'on'.
 *
 * slowMo(set) takes a power-up set config ({ set, kinds }) and returns it with
 * the Slow-Mo pickup kept (on) or left out (off).
 */

const on = require('./slow-mos/on');
const off = require('./slow-mos/off');

function slowMo(set, env = process.env) {
  switch (String(env.SLOW_MO || '').trim().toLowerCase()) {
    case 'off':
      return off.applyTo(set);
    case 'on':
    default:
      return on.applyTo(set);
  }
}

module.exports = { slowMo };
