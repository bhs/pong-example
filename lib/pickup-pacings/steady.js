'use strict';

/**
 * lib/pickup-pacings/steady.js — the pickup pacing of the Power-Ups fun mode.
 *
 * One pickup spawns about every 6 seconds, at most one on the field, and it
 * vanishes after about 8 seconds if no ball hits it. Slow-Mo and Ghost Ball
 * last about 5 seconds, Big Paddle about 5 seconds and Freeze AI about 2
 * seconds. game-logic.js applies these numbers; index.html reads them from
 * GET /api/config.
 */

const PACING = 'steady';

const SPAWN_INTERVAL_S = 6;
const PICKUP_LIFETIME_S = 8;
const EFFECT_DURATIONS_S = Object.freeze({
  slowMo:    5,
  ghostBall: 5,
  bigPaddle: 5,
  freezeAi:  2,
  multiBall: 5,
});

function clientConfig() {
  return {
    pacing: PACING,
    spawnIntervalS: SPAWN_INTERVAL_S,
    pickupLifetimeS: PICKUP_LIFETIME_S,
    effectDurationsS: Object.assign({}, EFFECT_DURATIONS_S),
  };
}

module.exports = {
  PACING, SPAWN_INTERVAL_S, PICKUP_LIFETIME_S, EFFECT_DURATIONS_S, clientConfig,
};
