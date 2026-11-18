'use strict';

/**
 * lib/pickup-pacing.js — the one place the pickup-pacing Trait is read.
 *
 * PICKUP_PACING chooses how fast Power-Ups pickups spawn and how long their
 * effects last. Each option's code lives in lib/pickup-pacings/. The value is
 * read per call (not at build time); unset or unknown means 'steady'.
 */

const steady = require('./pickup-pacings/steady');

function pickupPacing(env = process.env) {
  switch (String(env.PICKUP_PACING || '').trim().toLowerCase()) {
    case 'steady':
    default:
      return steady.clientConfig();
  }
}

module.exports = { pickupPacing };
