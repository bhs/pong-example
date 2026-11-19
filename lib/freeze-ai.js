'use strict';

/**
 * lib/freeze-ai.js — the one place the freeze-ai Trait is read.
 *
 * FREEZE_AI switches the Freeze AI pickup of the Power-Ups fun mode on or
 * off; it is one of the switches of "which pickups are in the game". Each
 * option's code lives in lib/freeze-ais/. The value is read per call (when
 * the server answers, never at build time); unset or unknown means 'off'.
 *
 * freezeAi(set) takes a power-up set config ({ set, kinds }) and returns it
 * with the Freeze AI pickup kept (on) or left out (off).
 */

const on = require('./freeze-ais/on');
const off = require('./freeze-ais/off');

function freezeAi(set, env = process.env) {
  switch (String(env.FREEZE_AI || '').trim().toLowerCase()) {
    case 'on':
      return on.applyTo(set);
    case 'off':
    default:
      return off.applyTo(set);
  }
}

module.exports = { freezeAi };
