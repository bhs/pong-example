'use strict';

/**
 * lib/add-random-obstructions-to-the-game-area.js — the one place the
 * add-random-obstructions-to-the-game-area Trait is read.
 *
 * ADD_RANDOM_OBSTRUCTIONS_TO_THE_GAME_AREA switches the random obstructions of
 * the Power-Ups fun mode on or off; it is one of the switches of "which
 * pickups are in the game". Each option's code lives in
 * lib/add-random-obstructions-to-the-game-areas/. The value is read per call
 * (when the server answers, never at build time); unset or unknown means 'on'.
 *
 * addRandomObstructionsToTheGameArea(set) takes a power-up set config
 * ({ set, kinds }) and returns it with `obstructions` true (on) or false (off).
 */

const on = require('./add-random-obstructions-to-the-game-areas/on');
const off = require('./add-random-obstructions-to-the-game-areas/off');

function addRandomObstructionsToTheGameArea(set, env = process.env) {
  switch (String(env.ADD_RANDOM_OBSTRUCTIONS_TO_THE_GAME_AREA || '').trim().toLowerCase()) {
    case 'off':
      return off.applyTo(set);
    case 'on':
    default:
      return on.applyTo(set);
  }
}

module.exports = { addRandomObstructionsToTheGameArea };
