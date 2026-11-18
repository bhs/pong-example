'use strict';

/**
 * lib/pickup-pacings/rare-and-long.js — the "rare-and-long" option of the
 * pickup-pacing Trait for the Power-Ups fun mode.
 *
 * One pickup spawns about every 10 seconds, at most one on the field, and it
 * vanishes after about 8 seconds if no ball hits it. Effects last about 1.5
 * times as long as in 'steady': Slow-Mo, Ghost Ball and Big Paddle about 7.5
 * seconds and Freeze AI about 3 seconds, so each pickup is an event. The
 * shape matches steady.clientConfig(), so game-logic.js and index.html apply
 * it unchanged.
 */

const PACING = 'rare-and-long';

const SPAWN_INTERVAL_S = 10;
const PICKUP_LIFETIME_S = 8;
const EFFECT_DURATIONS_S = Object.freeze({
  slowMo:    7.5,
  ghostBall: 7.5,
  bigPaddle: 7.5,
  freezeAi:  3,
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
