'use strict';

/**
 * preferences-logic.js — Pure, dependency-free helpers for the user style
 * preferences feature (paddle / ball / background colors).
 *
 * Mirrors the pattern established by game-logic.js: the same constants and
 * validation rules are duplicated inline in index.html's <script> (which
 * ships as a single static file with no bundler/module loader), while this
 * module exists so the logic is independently unit-testable under Jest.
 */

// Defaults match the game's original monochrome look (white paddles/ball on
// a black background) — guests, and any signed-in user who has never saved
// preferences, see exactly this.
const DEFAULT_PREFERENCES = Object.freeze({
  paddleColor: '#ffffff',
  ballColor:   '#ffffff',
  bgColor:     '#000000',
});

// Preset-style buttons offered in the preferences modal.
const PRESET_CLASSIC = Object.freeze({
  paddleColor: '#ffffff',
  ballColor:   '#ffffff',
  bgColor:     '#000000',
});

const PRESET_NEON = Object.freeze({
  paddleColor: '#39ff14',
  ballColor:   '#ff00ff',
  bgColor:     '#0d0221',
});

const PRESETS = Object.freeze({
  classic: PRESET_CLASSIC,
  neon:    PRESET_NEON,
});

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * True when `value` is a string of the form "#rrggbb".
 */
function isValidHexColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/**
 * Validate a preferences payload (as sent to PUT /api/preferences).
 *
 * @param {*} body - the parsed request body
 * @returns {{valid: true, preferences: {paddleColor, ballColor, bgColor}} |
 *           {valid: false, error: string}}
 */
function validatePreferencesPayload(body) {
  const b = body || {};
  const { paddleColor, ballColor, bgColor } = b;

  if (!isValidHexColor(paddleColor) || !isValidHexColor(ballColor) || !isValidHexColor(bgColor)) {
    return {
      valid: false,
      error: 'paddleColor, ballColor, and bgColor must each be a 6-digit hex color (e.g. #ff00ff)',
    };
  }

  return { valid: true, preferences: { paddleColor, ballColor, bgColor } };
}

module.exports = {
  DEFAULT_PREFERENCES,
  PRESET_CLASSIC,
  PRESET_NEON,
  PRESETS,
  isValidHexColor,
  validatePreferencesPayload,
};
